import { clickhouse } from "../utils/clickhouse";
import { config } from "../config";

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

export class EventsService {
  async listInviteEvents(input: ListInviteEventsInput): Promise<ListInviteEventsOutput> {
    const { inviteId, limit = 5, cursor } = input;

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
        ORDER BY occurred_at ASC, event_id ASC
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
}

