import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { config } from "../config";
import type { InviteTimelineEventMessage } from "../common/inviteTimelineEventMessage";
import { EventsController } from "../controllers/events.controller";
import { EventsService } from "../services/event.service";

const router = Router();

const eventsController = new EventsController(new EventsService());

const sqs = new SQSClient({
  region: config.sqs.region,
  endpoint: config.sqs.endpoint,
});

router.get("/invite-events", async (_req: Request, res: Response) => {
  // Query params:
  // - invite_id (required)
  // - cursor_occurred_at (optional; use with cursor_event_id)
  // - cursor_event_id (optional; use with cursor_occurred_at)
  // - limit (optional, default 50)
  await eventsController.listInviteEvents(_req, res);
});

router.post("/invite-events/ingest", async (req: Request, res: Response) => {
  await eventsController.ingestInviteTimelineEvent(req, res);
});

function buildTestMessage(overrides: Partial<InviteTimelineEventMessage> = {}): InviteTimelineEventMessage {
  const now = new Date().toISOString();

  // If caller provided metadata as an object, stringify it.
  const rawMetadata = (overrides as unknown as { metadata?: unknown }).metadata;
  const metadata =
    typeof rawMetadata === "string"
      ? rawMetadata
      : rawMetadata == null
        ? JSON.stringify({ note: "test message", generated_at: now })
        : JSON.stringify(rawMetadata);

  return {
    event_id: overrides.event_id ?? randomUUID(),
    event_type: overrides.event_type ?? "guest.checked_in",
    event_version: overrides.event_version ?? 1,
    occurred_at: overrides.occurred_at ?? now,
    ingested_at: overrides.ingested_at ?? now,
    entity_type: "invite",
    entity_id: overrides.entity_id ?? "test-invite-id",
    event_idempotency_key: overrides.event_idempotency_key,

    actor_type: overrides.actor_type ?? "system",
    actor_id: overrides.actor_id ?? null,
    actor_display_name: overrides.actor_display_name ?? null,

    target_type: overrides.target_type ?? "guest",
    target_id: overrides.target_id ?? "test-guest-id",
    target_display_name: overrides.target_display_name ?? "Test Guest",

    source_type: overrides.source_type ?? "system",
    source_value: overrides.source_value ?? "test-endpoint",

    metadata,
  };
}

/**
 * Testing endpoint: enqueue a message in the same format the worker expects.
 *
 * POST /events/v1/test/enqueue
 * Body: Partial<InviteTimelineEventMessage> (any fields you provide override defaults)
 */
router.post("/test/enqueue", async (req: Request, res: Response) => {
  const overrides = (req.body ?? {}) as Partial<InviteTimelineEventMessage>;
  const message = buildTestMessage(overrides);

  const isFifoQueue = config.sqs.queueUrl.toLowerCase().endsWith(".fifo");
  const messageGroupId = config.sqs.fifoMessageGroupId ?? "test";

  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: config.sqs.queueUrl,
      MessageBody: JSON.stringify(message),
      ...(isFifoQueue
        ? {
            MessageGroupId: messageGroupId,
            // Provide a stable dedup id so FIFO queues without ContentBasedDeduplication still work.
            MessageDeduplicationId: message.event_idempotency_key ?? message.event_id,
          }
        : {}),
    }),
  );

  res.status(200).json({
    ok: true,
    queueUrl: config.sqs.queueUrl,
    isFifoQueue,
    messageId: result.MessageId,
    body: message,
  });
});

export default router;