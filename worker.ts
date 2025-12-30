import { config } from "./config";
import { runSqsToClickhouseWorker } from "./services/sqsToClickhouseWorker";

const ac = new AbortController();

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

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down...`);
  ac.abort();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// eslint-disable-next-line no-console
console.log(`Worker booting (${config.env})`);

async function runWithRetries(): Promise<void> {
  let attempt = 0;

  while (!ac.signal.aborted) {
    try {
      await runSqsToClickhouseWorker({ signal: ac.signal });
      return; // normal exit (likely aborted)
    } catch (err) {
      attempt += 1;
      // eslint-disable-next-line no-console
      console.error("Worker crashed:", err);

      const backoffMs = Math.min(30_000, 1_000 * Math.pow(2, Math.min(attempt, 5)));
      // eslint-disable-next-line no-console
      console.log(`Retrying worker in ${backoffMs}ms (attempt ${attempt})...`);
      await sleep(backoffMs, ac.signal).catch(() => undefined);
    }
  }
}

runWithRetries().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Worker fatal error:", err);
  process.exitCode = 1;
});


