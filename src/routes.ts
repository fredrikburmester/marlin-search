import { Express, Request, Response } from "express";
import { authenticateToken } from "./middleware";
import { scrapeJellyfin } from "./jellyfin";
import { client } from "./meilisearch";
import { INDEX_NAME } from "./config";
import { logger } from "./logger";

export const setupRoutes = (app: Express) => {
  app.get("/up", async (req: Request, res: Response) => {
    res.sendStatus(200);
  });

  app.get("/search", async (req: Request, res: Response) => {
    const query = req.query.q as string;
    let includeItemTypes = req.query.includeItemTypes;

    if (!query) {
      return res.status(400).json({ error: "No query provided" });
    }

    // Ensure includeItemTypes is an array
    if (typeof includeItemTypes === "string") {
      includeItemTypes = [includeItemTypes];
    } else if (!Array.isArray(includeItemTypes)) {
      includeItemTypes = [];
    }

    const filterQuery =
      includeItemTypes.length > 0
        ? includeItemTypes.map((type) => `Type = '${type}'`).join(" OR ")
        : "";

    try {
      const index = client.index(INDEX_NAME);
      const searchResults = await index.search(
        query,
        filterQuery ? { filter: filterQuery } : {}
      );
      const ids = searchResults.hits.map((hit: any) => hit.Id);
      res.json({ ids });
    } catch (error: any) {
      logger.error(`MeiliSearch error during search: ${error.message}`);
      res.status(500).json({ error: "An error occurred during the search" });
    }
  });

  app.post(
    "/create-index",
    authenticateToken,
    (req: Request, res: Response) => {
      res.status(200).json({
        status: "job started",
        message: "Scraping job is running in the background.",
      });

      (async () => {
        const startTime = Date.now();
        const { status, message } = await scrapeJellyfin();
        const elapsedTime = (Date.now() - startTime) / 1000;
        logger.info(`Scrape completed in ${elapsedTime.toFixed(2)} seconds`);

        if (status !== "success") {
          logger.error(`Scraping failed: ${message}`);
        }
      })().catch((error) => {
        logger.error(`Unexpected error in background job: ${error.message}`);
      });
    }
  );

  app.post(
    "/clear-index",
    authenticateToken,
    async (req: Request, res: Response) => {
      try {
        const index = client.index(INDEX_NAME);
        await index.deleteAllDocuments();
        logger.info("Index cleared successfully.");
        res
          .status(200)
          .json({ status: "success", message: "Index cleared successfully." });
      } catch (error: any) {
        logger.error(`Failed to clear index: ${error.message}`);
        res.status(500).json({
          status: "error",
          message: `Failed to clear index: ${error.message}`,
        });
      }
    }
  );

  app.delete(
    "/delete-index",
    authenticateToken,
    async (req: Request, res: Response) => {
      try {
        await client.deleteIndex(INDEX_NAME);
        logger.info(`Index \`${INDEX_NAME}\` deleted successfully.`);
        res.status(200).json({
          status: "success",
          message: `Index \`${INDEX_NAME}\` deleted successfully.`,
        });
      } catch (e: any) {
        logger.error(`Failed to delete index: ${e.message}`);
        res.status(500).json({
          status: "error",
          message: `Failed to delete index: ${e.message}`,
        });
      }
    }
  );
};
