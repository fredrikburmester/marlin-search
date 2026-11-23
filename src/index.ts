import express from "express";
import { HOST, PORT, SCRAPE_INTERVAL_MINUTES } from "./config";
import { scrapeJellyfin } from "./jellyfin";
import { logger } from "./logger";
import { ensureIndexExists, waitForMeilisearch } from "./meilisearch";
import { setupRoutes } from "./routes";

const runScheduledScrape = async (): Promise<void> => {
  logger.info("Scheduled scrape job started.");
  const startedAt = Date.now();
  const { status, message } = await scrapeJellyfin();
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

  if (status === "success") {
    logger.info(`Scheduled scrape completed in ${elapsed}s.`);
  } else if (status === "skipped") {
    logger.warn(`Scheduled scrape skipped: ${message}`);
  } else {
    logger.error(`Scheduled scrape failed: ${message}`);
  }
};

const main = async (): Promise<void> => {
  // Compose starts both containers together, so wait rather than exiting on
  // the first connection refusal.
  await waitForMeilisearch();
  await ensureIndexExists();

  const app = express();
  app.use(express.json());
  setupRoutes(app);

  const server = app.listen(PORT, HOST, () => {
    logger.info(`Express app listening on ${HOST}:${PORT}`);
  });

  const scrapeTimer = setInterval(
    () => void runScheduledScrape(),
    SCRAPE_INTERVAL_MINUTES * 60 * 1000
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down...`);
    clearInterval(scrapeTimer);

    server.close(() => {
      logger.info("HTTP server closed.");
      process.exit(0);
    });

    // Don't let an in-flight scrape hold the container open indefinitely.
    setTimeout(() => {
      logger.warn("Shutdown timed out, exiting.");
      process.exit(1);
    }, 10_000).unref();
  };

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => shutdown(signal));
  }
};

main().catch((error: unknown) => {
  logger.error(`Startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
