import { config } from "./config";
import { runSqsToClickhouseWorker } from "./services/sqsToClickhouseWorker";

const ac = new AbortController();

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down...`);
  ac.abort();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// eslint-disable-next-line no-console
console.log(`Worker booting (${config.env})`);

runSqsToClickhouseWorker({ signal: ac.signal }).catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Worker crashed:", err);
  process.exitCode = 1;
});


