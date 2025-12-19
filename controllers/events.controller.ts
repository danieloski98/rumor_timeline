import type { Request, Response } from "express";
import { EventsService, type InviteEventsCursor } from "../services/event.service";

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

    const limit = Math.min(parsePositiveInt(req.query.limit, 5), 250);
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
}

