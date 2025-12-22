import { SQSClient, ReceiveMessageCommand, DeleteMessageBatchCommand } from "@aws-sdk/client-sqs";
import { clickhouse } from "../utils/clickhouse";
import { config } from "../config";
import type { InviteTimelineEventMessage } from "../common/inviteTimelineEventMessage";

type InviteTimelineEventRow = {
  // Core event identity
  event_id: string;
  event_type: string;
  event_version: number;

  // Timestamps
  occurred_at: string;
  ingested_at: string;

  // Entity
  entity_type: string;
  entity_id: string;

  // Actor
  actor_type: string;
  actor_id?: string | null;
  actor_display_name?: string | null;

  // Target
  target_type: string;
  target_id?: string | null;
  target_display_name: string;

  // Source
  source_type?: string | null;
  source_value?: string | null;

  // Idempotency / deduplication
  idempotency_key?: string | null;

  // Extra data (JSON blob)
  metadata: unknown;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("Aborted"));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

async function ensureTableExists(): Promise<void> {
  const table = config.clickhouse.inviteTimelineTable;
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${table} (
        event_id UUID,
        event_type LowCardinality(String),
        event_version UInt16,
        occurred_at DateTime64(3, 'UTC'),
        ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
        entity_type LowCardinality(String),
        entity_id String,
        actor_type LowCardinality(String),
        actor_id Nullable(String),
        actor_display_name Nullable(String),

        target_type LowCardinality(String),
        target_id Nullable(String),
        target_display_name String,

        source_type Nullable(String),
        source_value Nullable(String),

        idempotency_key Nullable(String),
        metadata String
      )
      ENGINE = MergeTree
      ORDER BY (occurred_at, event_id)
    `,
  });
}

async function getMetadataColumnType(): Promise<string | undefined> {
  const table = config.clickhouse.inviteTimelineTable;
  const result = await clickhouse.query({
    query: `
      SELECT type
      FROM system.columns
      WHERE database = {db:String} AND table = {table:String} AND name = 'metadata'
      LIMIT 1
    `,
    query_params: { db: config.clickhouse.database, table },
  });
  const json = await result.json<{ type: string }>();
  return json.data?.[0]?.type;
}

function parseMetadataForClickHouse(metadata: string, metadataColumnType: string | undefined): unknown {
  // If the column is ClickHouse JSON / Object('json'), it expects a JSON object (not a quoted string).
  const t = (metadataColumnType ?? "").toLowerCase();
  const expectsJsonObject = t === "json" || t.startsWith("object(") || t.startsWith("json");

  if (!expectsJsonObject) return metadata;

  try {
    return JSON.parse(metadata);
  } catch {
    return { raw: metadata };
  }
}

function isInviteTimelineEventMessage(v: unknown): v is InviteTimelineEventMessage {
  if (v == null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.event_id === "string" &&
    typeof o.event_type === "string" &&
    typeof o.event_version === "number" &&
    typeof o.occurred_at === "string" &&
    typeof o.ingested_at === "string" &&
    o.entity_type === "invite" &&
    typeof o.entity_id === "string" &&
    typeof o.actor_type === "string" &&
    (typeof o.actor_id === "string" || o.actor_id === null) &&
    (typeof o.actor_display_name === "string" || o.actor_display_name === null) &&
    typeof o.target_type === "string" &&
    (typeof o.target_id === "string" || o.target_id === null) &&
    typeof o.target_display_name === "string" &&
    (typeof o.source_type === "string" || o.source_type === null) &&
    (typeof o.source_value === "string" || o.source_value === null) &&
    typeof o.metadata === "string"
  );
}

export async function runSqsToClickhouseWorker(options?: { signal?: AbortSignal }): Promise<void> {
  const { signal } = options ?? {};

  await ensureTableExists();
  const metadataColumnType = await getMetadataColumnType();

  const sqs = new SQSClient({
    region: config.sqs.region,
    endpoint: config.sqs.endpoint,
  });

  // eslint-disable-next-line no-console
  console.log(
    `SQS→ClickHouse worker started (queue=${config.sqs.queueUrl}, table=${config.clickhouse.inviteTimelineTable})`,
  );

  while (!signal?.aborted) {
    try {
      const resp = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: config.sqs.queueUrl,
          MaxNumberOfMessages: Math.max(1, Math.min(10, config.sqs.maxNumberOfMessages)),
          WaitTimeSeconds: Math.max(0, Math.min(20, config.sqs.waitTimeSeconds)),
          VisibilityTimeout: config.sqs.visibilityTimeoutSeconds,
          AttributeNames: ["All"],
          MessageAttributeNames: ["All"],
        }),
      );

      const messages = resp.Messages ?? [];
      if (messages.length === 0) {
        await sleep(config.sqs.pollIntervalMs, signal);
        continue;
      }

      const parsed: Array<{
        msgIdx: number;
        sqsMessageId: string;
        receiptHandle: string;
        event: InviteTimelineEventMessage;
      }> = [];

      // If any message is malformed, we fail the whole batch so SQS retries (better than silently dropping).
      for (let i = 0; i < messages.length; i += 1) {
        const m = messages[i];
        const receiptHandle = m.ReceiptHandle;
        if (!receiptHandle) throw new Error("SQS message missing ReceiptHandle");
        const body = m.Body ?? "";
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch (e) {
          throw new Error(`Invalid JSON in SQS message body (messageId=${m.MessageId ?? "unknown"}): ${String(e)}`);
        }
        if (!isInviteTimelineEventMessage(json)) {
          throw new Error(`Unexpected message shape (messageId=${m.MessageId ?? "unknown"})`);
        }
        parsed.push({
          msgIdx: i,
          sqsMessageId: m.MessageId ?? "",
          receiptHandle,
          event: json,
        });
      }

      const rows: InviteTimelineEventRow[] = parsed.map(({ sqsMessageId, event }) => ({
        event_id: event.event_id,
        event_type: event.event_type,
        event_version: event.event_version,
        occurred_at: event.occurred_at,
        ingested_at: event.ingested_at,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        actor_type: event.actor_type,
        actor_id: event.actor_id,
        actor_display_name: event.actor_display_name,
        target_type: event.target_type,
        target_id: event.target_id,
        target_display_name: event.target_display_name,
        source_type: event.source_type,
        source_value: event.source_value,
        idempotency_key: event.event_idempotency_key ?? null,
        metadata: parseMetadataForClickHouse(event.metadata, metadataColumnType),
      }));

      console.log(rows)

      // 1) Insert batch into ClickHouse. If this fails, we do NOT delete from SQS (so they retry).
      const data = await clickhouse.insert({
        table: config.clickhouse.inviteTimelineTable,
        values: rows,
        format: "JSONEachRow",
      });

      console.log('Insert Resutt', data);

      // 2) Delete batch from SQS (max 10 per batch).
      const deleteEntries = parsed.map((p) => ({
        Id: String(p.msgIdx),
        ReceiptHandle: p.receiptHandle,
      }));

      if (deleteEntries.length > 0) {
        await sqs.send(
          new DeleteMessageBatchCommand({
            QueueUrl: config.sqs.queueUrl,
            Entries: deleteEntries,
          }),
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Worker loop error:", err);
      await sleep(Math.max(250, config.sqs.pollIntervalMs), signal);
    }
  }

  // eslint-disable-next-line no-console
  console.log("SQS→ClickHouse worker stopped");
}

