import type { Request, Response } from "express";
import { EventsService, type InviteEventsCursor } from "../services/event.service";
import type { InviteTimelineEventMessage } from "../common/inviteTimelineEventMessage";

function parsePositiveInt(value: unknown, fallback: number): number {
  const raw = String(value ?? "").trim();
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function getStringQueryParam(req: Request, name: string): string | undefined {
  const v = req.query[name];
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s === "" ? undefined : s;
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

export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  async listInviteEvents(req: Request, res: Response): Promise<void> {
    const inviteId = getStringQueryParam(req, "invite_id");
    const cursorOccurredAt = getStringQueryParam(req, "cursor_occurred_at");
    const cursorEventId = getStringQueryParam(req, "cursor_event_id");

    if (!inviteId) {
      res.status(400).json({ error: "invite_id is required" });
      return;
    }

    if ((cursorOccurredAt && !cursorEventId) || (!cursorOccurredAt && cursorEventId)) {
      res.status(400).json({ error: "cursor_occurred_at and cursor_event_id must be provided together" });
      return;
    }

    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 250);
    const cursor: InviteEventsCursor | undefined =
      cursorOccurredAt && cursorEventId
        ? { cursor_occurred_at: cursorOccurredAt, cursor_event_id: cursorEventId }
        : undefined;

    const result = await this.eventsService.listInviteEvents({ inviteId, limit, cursor });

    res.status(200).json({
      limit,
      total: result.total,
      next_cursor: result.next_cursor,
      rows: result.rows,
    });
  }

  /**
   * Receives the same payload you would enqueue on SQS (InviteTimelineEventMessage),
   * but over HTTP, and writes it to ClickHouse.
   *
   * POST /events/v1/invite-events/ingest
   * Body: InviteTimelineEventMessage OR { message: InviteTimelineEventMessage } OR { MessageBody: string }
   */
  async ingestInviteTimelineEvent(req: Request, res: Response): Promise<void> {
    const body = req.body as unknown;

    let candidate: unknown = body;
    if (body && typeof body === "object") {
      const o = body as Record<string, unknown>;
      if (o.message != null) candidate = o.message;
      if (typeof o.MessageBody === "string") {
        try {
          candidate = JSON.parse(o.MessageBody);
        } catch {
          res.status(400).json({ error: "MessageBody must be valid JSON" });
          return;
        }
      }
    }

    if (!isInviteTimelineEventMessage(candidate)) {
      res.status(400).json({ error: "Invalid InviteTimelineEventMessage payload" });
      return;
    }

    const result = await this.eventsService.ingestInviteTimelineEvent(candidate);
    res.status(200).json({ ok: true, ...result });
  }
}

