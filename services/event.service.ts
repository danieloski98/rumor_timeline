import { clickhouse } from "../utils/clickhouse";

export type InviteEventsCursor = {
  cursor_occurred_at: string;
  cursor_event_id: string;
};

export type ListInviteEventsInput = {
  inviteId: string;
  limit: number;
  cursor?: InviteEventsCursor;
};

export type ListInviteEventsOutput = {
  rows: unknown[];
  next_cursor: InviteEventsCursor | null;
};

export class EventsService {
  async listInviteEvents(input: ListInviteEventsInput): Promise<ListInviteEventsOutput> {
    const { inviteId, limit, cursor } = input;

    // NOTE: table name requested in query is activity_events.
    const table = "activity_events";

    const whereParts = ["entity_id = {inviteId:String}", "entity_type = 'invite'"];
    if (cursor) {
      whereParts.push(
        "(occurred_at, event_id) < (parseDateTime64BestEffort({cursorOccurredAt:String}, 3, 'UTC'), {cursorEventId:UUID})",
      );
    }
    const where = whereParts.join(" AND ");

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
      next_cursor:
        data.length === limit && last?.occurred_at && last?.event_id
          ? { cursor_occurred_at: last.occurred_at, cursor_event_id: last.event_id }
          : null,
    };
  }
}

