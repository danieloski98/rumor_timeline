import { clickhouse } from "../utils/clickhouse";
import { config } from "../config";
import type { InviteTimelineEventMessage } from "../common/inviteTimelineEventMessage";

export type InviteEventsCursor = {
  cursor_occurred_at: string;
  cursor_event_id: string;
};

export type ListInviteEventsInput = {
  inviteId: string;
  limit?: number;
  cursor?: InviteEventsCursor;
};

export type ListInviteEventsOutput = {
  rows: unknown[];
  next_cursor: InviteEventsCursor | null;
  total: number;
};

export type IngestInviteTimelineEventOutput = {
  inserted: number;
};

export class EventsService {
  private parseDbAndTable(qualifiedOrTable: string): { database: string; table: string; fullName: string } {
    const raw = qualifiedOrTable.trim();
    const parts = raw.split(".");
    const database = parts.length === 2 ? parts[0] : config.clickhouse.database;
    const table = parts.length === 2 ? parts[1] : raw;

    const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (!ident.test(database)) throw new Error(`Invalid ClickHouse database name: ${database}`);
    if (!ident.test(table)) throw new Error(`Invalid ClickHouse table name: ${table}`);

    return { database, table, fullName: `${database}.${table}` };
  }

  private async tableExists(qualifiedOrTable: string): Promise<boolean> {
    const { database, table } = this.parseDbAndTable(qualifiedOrTable);
    const result = await clickhouse.query({
      query: `
        SELECT count() AS c
        FROM system.tables
        WHERE database = {db:String} AND name = {table:String}
      `,
      query_params: { db: database, table },
    });
    const json = await result.json<{ c: string }>();
    return Number(json.data?.[0]?.c ?? 0) > 0;
  }

  private async ensureInviteTimelineTableExists(): Promise<void> {
    const { fullName } = this.parseDbAndTable(config.clickhouse.inviteTimelineTable);
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${fullName} (
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

  private async getInviteTimelineMetadataColumnType(): Promise<string | undefined> {
    const { database, table } = this.parseDbAndTable(config.clickhouse.inviteTimelineTable);
    const result = await clickhouse.query({
      query: `
        SELECT type
        FROM system.columns
        WHERE database = {db:String} AND table = {table:String} AND name = 'metadata'
        LIMIT 1
      `,
      query_params: { db: database, table },
    });
    const json = await result.json<{ type: string }>();
    return json.data?.[0]?.type;
  }

  private parseMetadataForClickHouse(metadata: string, metadataColumnType: string | undefined): unknown {
    const t = (metadataColumnType ?? "").toLowerCase();
    const expectsJsonObject = t === "json" || t.startsWith("object(") || t.startsWith("json");
    if (!expectsJsonObject) return metadata;
    try {
      return JSON.parse(metadata);
    } catch {
      return { raw: metadata };
    }
  }

  async listInviteEvents(input: ListInviteEventsInput): Promise<ListInviteEventsOutput> {
    const { inviteId, limit = 50, cursor } = input;

    const table = `${config.clickhouse.database}.${config.clickhouse.eventsTable}`;

    const whereParts = ["entity_id = {inviteId:String}", "entity_type = 'invite'"];
    if (cursor) {
      whereParts.push(
        "(occurred_at, event_id) > (parseDateTime64BestEffort({cursorOccurredAt:String}, 3, 'UTC'), {cursorEventId:UUID})",
      );
    }
    const where = whereParts.join(" AND ");

    // Total count for this invite (independent of cursor)
    const countResult = await clickhouse.query({
      query: `
        SELECT count() AS total
        FROM ${table}
        WHERE entity_id = {inviteId:String} AND entity_type = 'invite'
      `,
      query_params: { inviteId },
    });
    const countJson = await countResult.json<{ total: string }>();
    const total = Number(countJson.data?.[0]?.total ?? 0);

    const dataResult = await clickhouse.query({
      query: `
        SELECT
          event_id,
          event_type,
          event_version,
          occurred_at,
          ingested_at,
          entity_type,
          entity_id,
          actor_type,
          actor_id,
          actor_display_name,
          target_type,
          target_id,
          target_display_name,
          source_type,
          source_value,
          idempotency_key,
          metadata
        FROM ${table}
        WHERE ${where}
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        inviteId,
        ...(cursor
          ? { cursorOccurredAt: cursor.cursor_occurred_at, cursorEventId: cursor.cursor_event_id }
          : {}),
        limit,
      },
    });

    const json = await dataResult.json();
    const data = json.data as Array<{ occurred_at?: string; event_id?: string }>;
    const last = data.length > 0 ? data[data.length - 1] : undefined;

    return {
      rows: json.data,
      total,
      next_cursor:
        last?.occurred_at && last?.event_id
          ? { cursor_occurred_at: last.occurred_at, cursor_event_id: last.event_id }
          : null,
    };
  }

  /**
   * Chronological pagination (oldest -> newest), so the latest comes last.
   * Cursor semantics flip to ">" because ordering is ASC.
   */
  async listInviteEventsChronological(input: ListInviteEventsInput): Promise<ListInviteEventsOutput> {
    const { inviteId, limit = 50, cursor } = input;

    const table = `${config.clickhouse.database}.${config.clickhouse.eventsTable}`;

    const whereParts = ["entity_id = {inviteId:String}", "entity_type = 'invite'"];
    if (cursor) {
      whereParts.push(
        "(occurred_at, event_id) < (parseDateTime64BestEffort({cursorOccurredAt:String}, 3, 'UTC'), {cursorEventId:UUID})",
      );
    }
    const where = whereParts.join(" AND ");

    // Total count for this invite (independent of cursor)
    const countResult = await clickhouse.query({
      query: `
        SELECT count() AS total
        FROM ${table}
        WHERE entity_id = {inviteId:String} AND entity_type = 'invite'
      `,
      query_params: { inviteId },
    });
    const countJson = await countResult.json<{ total: string }>();
    const total = Number(countJson.data?.[0]?.total ?? 0);

    const dataResult = await clickhouse.query({
      query: `
        SELECT
          event_id,
          event_type,
          event_version,
          occurred_at,
          ingested_at,
          entity_type,
          entity_id,
          actor_type,
          actor_id,
          actor_display_name,
          target_type,
          target_id,
          target_display_name,
          source_type,
          source_value,
          idempotency_key,
          metadata
        FROM ${table}
        WHERE ${where}
        ORDER BY occurred_at DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        inviteId,
        ...(cursor
          ? { cursorOccurredAt: cursor.cursor_occurred_at, cursorEventId: cursor.cursor_event_id }
          : {}),
        limit,
      },
    });

    const json = await dataResult.json();
    const data = json.data as Array<{ occurred_at?: string; event_id?: string }>;
    const last = data.length > 0 ? data[data.length - 1] : undefined;

    return {
      rows: json.data,
      total,
      next_cursor:
        last?.occurred_at && last?.event_id
          ? { cursor_occurred_at: last.occurred_at, cursor_event_id: last.event_id }
          : null,
    };
  }

  /**
   * Ingest an InviteTimelineEventMessage via HTTP (same shape as SQS message body).
   * Writes into CLICKHOUSE_INVITE_TIMELINE_TABLE.
   */
  async ingestInviteTimelineEvent(message: InviteTimelineEventMessage): Promise<IngestInviteTimelineEventOutput> {
    await this.ensureInviteTimelineTableExists();
    const exists = await this.tableExists(config.clickhouse.inviteTimelineTable);
    if (!exists) {
      throw new Error(`ClickHouse table not found: ${config.clickhouse.inviteTimelineTable}`);
    }

    const metadataColumnType = await this.getInviteTimelineMetadataColumnType();
    const { fullName } = this.parseDbAndTable(config.clickhouse.inviteTimelineTable);

    const row = {
      event_id: message.event_id,
      event_type: message.event_type,
      event_version: message.event_version,
      occurred_at: message.occurred_at,
      ingested_at: message.ingested_at,
      entity_type: message.entity_type,
      entity_id: message.entity_id,
      actor_type: message.actor_type,
      actor_id: message.actor_id,
      actor_display_name: message.actor_display_name,
      target_type: message.target_type,
      target_id: message.target_id,
      target_display_name: message.target_display_name,
      source_type: message.source_type,
      source_value: message.source_value,
      idempotency_key: message.event_idempotency_key ?? null,
      metadata: this.parseMetadataForClickHouse(message.metadata, metadataColumnType),
    };

    await clickhouse.insert({
      table: fullName,
      values: [row],
      format: "JSONEachRow",
    });

    return { inserted: 1 };
  }
}

