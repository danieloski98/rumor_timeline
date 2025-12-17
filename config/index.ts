import { loadEnv, type AppEnv } from "./env";

// Load env files once, as early as possible.
loadEnv();

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`${name} must be a number`);
  return n;
}

function optionalNumberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`${name} must be a number`);
  return n;
}

function stringFromEnv(name: string, fallback?: string): string | undefined {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return raw;
}

function requiredStringFromEnv(name: string): string {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") throw new Error(`${name} is required`);
  return raw;
}

const env = (process.env.APP_ENV as AppEnv | undefined) ?? "local";

export const config = {
  env,
  isProduction: env === "production",

  // server
  port: numberFromEnv("PORT", 3000),

  // http/security/logging defaults (override via env if you want)
  corsOrigin: stringFromEnv("CORS_ORIGIN", "*")!,
  logFormat: stringFromEnv("LOG_FORMAT", "dev")!,
  inviteQueueEndpoint: stringFromEnv("INVITE_QUEUE_ENDPOINT", "http://localhost:4000/events/v1")!,

  // clickhouse
  clickhouse: {
    url: requiredStringFromEnv("CLICKHOUSE_URL"),
    username: stringFromEnv("CLICKHOUSE_USERNAME", "default")!,
    password: requiredStringFromEnv("CLICKHOUSE_PASSWORD"),
    database: stringFromEnv("CLICKHOUSE_DATABASE", "default")!,

    // where the worker writes invite timeline events
    inviteTimelineTable: stringFromEnv("CLICKHOUSE_INVITE_TIMELINE_TABLE", "invite_timeline_events")!,
  },

  // sqs worker
  sqs: {
    queueUrl: requiredStringFromEnv("SQS_QUEUE_URL"),
    region: stringFromEnv("AWS_REGION", "eu-central-1")!,

    // optional (useful for LocalStack)
    endpoint: stringFromEnv("SQS_ENDPOINT"),

    // FIFO only (required by AWS for *.fifo queues when sending)
    fifoMessageGroupId: stringFromEnv("SQS_FIFO_MESSAGE_GROUP_ID"),

    // receive settings
    maxNumberOfMessages: numberFromEnv("SQS_MAX_MESSAGES", 10), // 1..10
    waitTimeSeconds: numberFromEnv("SQS_WAIT_TIME_SECONDS", 20), // 0..20
    visibilityTimeoutSeconds: optionalNumberFromEnv("SQS_VISIBILITY_TIMEOUT_SECONDS"),

    // backoff when queue is empty / errors
    pollIntervalMs: numberFromEnv("SQS_POLL_INTERVAL_MS", 1000),
  },
} as const;


