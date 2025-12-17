export type ActorType = "host_ec" | "guest" | "system";

export type SourceType = "user" | "form" | "primary_form" | "in_app_request" | "system" | null;

export type TargetType = "guest" | "invite" | string;

export type InviteTimelineEventType =
  | "invite.added_to_status"
  | "invite.request_approved"
  | "invite.request_declined"
  | "invite.plus_one_updated"
  | "invite.ticket_type_updated"
  | "guest.invite_accepted"
  | "guest.invite_declined"
  | "guest.plus_one_details_updated"
  | "guest.checked_in"
  | "guest.checked_out"
  | "guest.requested_access"
  | "guest.signed_terms";

export interface InviteTimelineEventMessage {
  // Required envelope keys
  event_id: string; // UUID
  event_type: InviteTimelineEventType;
  event_version: number; // UInt16
  occurred_at: string; // ISO-8601 UTC (DateTime64 UTC)
  ingested_at: string; // ISO-8601 UTC (DateTime64 UTC)
  entity_type: "invite";
  entity_id: string; // invite_id
  event_idempotency_key?: string;

  // Actor / target / source / metadata
  actor_type: ActorType;
  actor_id: string | null;
  actor_display_name: string | null;

  target_type: TargetType; // typically 'guest'
  target_id: string | null;
  target_display_name: string;

  source_type: SourceType;
  source_value: string | null;

  metadata: string; // JSON string
}


