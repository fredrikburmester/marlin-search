import express from "express";
import { PORT } from "./config";
import { logger } from "./logger";
import { ensureIndexExists } from "./meilisearch";
import { scrapeJellyfin } from "./jellyfin";
import { setupRoutes } from "./routes";
import { SCRAPE_INTERVAL_MINUTES } from "./config";

const app = express();
app.use(express.json());

setupRoutes(app);

app.listen(PORT, () => {
  logger.info(`Express app running on port ${PORT}`);

  ensureIndexExists().catch((err) => {
    logger.error(`Error during index setup: ${err.message}`);
    process.exit(1);
  });

  // Schedule the scraping job
  const scrapeIntervalMs = SCRAPE_INTERVAL_MINUTES * 60 * 1000;

  setInterval(async () => {
    logger.info("Scheduled scrape job started.");
    const startTime = Date.now();
    const { status, message } = await scrapeJellyfin();
    const elapsedTime = (Date.now() - startTime) / 1000;
    logger.info(
      `Scheduled scrape completed in ${elapsedTime.toFixed(2)} seconds`
    );

    if (status !== "success") {
      logger.error(`Scheduled scraping failed: ${message}`);
    }
  }, scrapeIntervalMs);
});
