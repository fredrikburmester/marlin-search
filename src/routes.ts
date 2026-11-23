import express, { type Express, type Request, type Response } from "express";
import {
  INDEXED_TYPES,
  fetchItemById,
  isIndexedType,
  scrapeJellyfin,
  toDocument,
} from "./jellyfin";
import { logger } from "./logger";
import { client, getIndex } from "./meilisearch";
import { INDEX_NAME, MAX_SEARCH_LIMIT, SEARCH_LIMIT } from "./config";
import {
  authenticateSearch,
  authenticateToken,
  authenticateWebhook,
} from "./middleware";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Run a scrape detached from the request, logging the outcome. */
const startScrapeInBackground = (trigger: string): void => {
  const startedAt = Date.now();

  void scrapeJellyfin()
    .then(({ status, message }) => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
      if (status === "success") {
        logger.info(`${trigger} scrape completed in ${elapsed}s.`);
      } else if (status === "skipped") {
        logger.warn(`${trigger} scrape skipped: ${message}`);
      } else {
        logger.error(`${trigger} scrape failed: ${message}`);
      }
    })
    .catch((error) => {
      logger.error(`${trigger} scrape threw unexpectedly: ${errorMessage(error)}`);
    });
};

/**
 * The Jellyfin Webhook plugin's Generic destination sends `text/plain` unless
 * a `Content-Type` header is configured, so accept any content type and parse
 * the body ourselves.
 */
const webhookBodyParser = express.text({ type: "*/*", limit: "1mb" });

const parseWebhookBody = (body: unknown): Record<string, unknown> | null => {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof body === "object" && body !== null) {
    return body as Record<string, unknown>;
  }
  return null;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

export const setupRoutes = (app: Express): void => {
  app.get("/up", (_req: Request, res: Response) => {
    res.sendStatus(200);
  });

  app.get("/search", authenticateSearch, async (req: Request, res: Response) => {
    const query = asString(req.query.q);
    if (!query) {
      res.status(400).json({ error: "No query provided" });
      return;
    }

    const raw = req.query.includeItemTypes;
    const requestedTypes = (
      Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
    ).map(String);

    // Only let known item types through. Interpolating arbitrary user input
    // into a Meilisearch filter expression would otherwise be injectable.
    const types = requestedTypes.filter(isIndexedType);
    const unknownTypes = requestedTypes.filter((type) => !isIndexedType(type));
    if (unknownTypes.length > 0) {
      res.status(400).json({
        error: `Unknown includeItemTypes value(s): ${unknownTypes.join(", ")}`,
        supported: INDEXED_TYPES,
      });
      return;
    }

    const requestedLimit = Number(req.query.limit ?? SEARCH_LIMIT);
    const limit =
      Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_SEARCH_LIMIT)
        : SEARCH_LIMIT;

    try {
      const results = await getIndex().search(query, {
        limit,
        ...(types.length > 0
          ? { filter: types.map((type) => `Type = "${type}"`).join(" OR ") }
          : {}),
      });
      res.json({ ids: results.hits.map((hit) => (hit as { Id: string }).Id) });
    } catch (error) {
      logger.error(`Meilisearch error during search: ${errorMessage(error)}`);
      res.status(500).json({ error: "An error occurred during the search" });
    }
  });

  /**
   * Receiver for the Jellyfin Webhook plugin, for near real-time index
   * updates between full scrapes.
   *
   * The payload is only trusted for the item id: the item itself is re-read
   * from the Jellyfin API so the stored document matches what a full scrape
   * would have produced, whatever template the plugin is configured with.
   */
  app.post(
    "/webhook",
    authenticateWebhook,
    webhookBodyParser,
    async (req: Request, res: Response) => {
      const payload = parseWebhookBody(req.body);
      if (!payload) {
        res.status(400).json({ status: "error", message: "Body is not valid JSON" });
        return;
      }

      const itemId = asString(payload.ItemId) ?? asString(payload.Id);
      const notificationType = asString(payload.NotificationType);

      if (!itemId) {
        res.status(400).json({
          status: "error",
          message: "Payload is missing ItemId",
        });
        return;
      }

      const index = getIndex();

      try {
        if (notificationType === "ItemDeleted") {
          await index.deleteDocument(itemId);
          logger.info(`Webhook: removed item ${itemId} from the index.`);
          res.json({ status: "success", action: "deleted", itemId });
          return;
        }

        const item = await fetchItemById(itemId);

        // Jellyfin no longer knows about it, so neither should the index.
        if (!item) {
          await index.deleteDocument(itemId);
          logger.info(
            `Webhook: item ${itemId} is gone from Jellyfin, removed it from the index.`
          );
          res.json({ status: "success", action: "deleted", itemId });
          return;
        }

        if (!isIndexedType(item.Type)) {
          logger.debug(
            `Webhook: ignoring item ${itemId} of unindexed type ${String(item.Type)}.`
          );
          res.json({ status: "success", action: "ignored", itemId });
          return;
        }

        await index.addDocuments([toDocument(item)]);
        logger.info(`Webhook: indexed item ${itemId} (${String(item.Type)}).`);
        res.json({ status: "success", action: "indexed", itemId });
      } catch (error) {
        const message = errorMessage(error);
        logger.error(`Webhook: failed to process item ${itemId}: ${message}`);
        res.status(500).json({ status: "error", message });
      }
    }
  );

  app.post("/create-index", authenticateToken, (_req: Request, res: Response) => {
    startScrapeInBackground("Requested");
    res.status(202).json({
      status: "job started",
      message: "Scraping job is running in the background.",
    });
  });

  app.post("/clear-index", authenticateToken, async (_req: Request, res: Response) => {
    try {
      await getIndex().deleteAllDocuments();
      logger.info("Index cleared successfully.");
      res.json({ status: "success", message: "Index cleared successfully." });
    } catch (error) {
      const message = errorMessage(error);
      logger.error(`Failed to clear index: ${message}`);
      res.status(500).json({
        status: "error",
        message: `Failed to clear index: ${message}`,
      });
    }
  });

  app.delete("/delete-index", authenticateToken, async (_req: Request, res: Response) => {
    try {
      await client.deleteIndex(INDEX_NAME);
      logger.info(`Index \`${INDEX_NAME}\` deleted successfully.`);
      res.json({
        status: "success",
        message: `Index \`${INDEX_NAME}\` deleted successfully.`,
      });
    } catch (error) {
      const message = errorMessage(error);
      logger.error(`Failed to delete index: ${message}`);
      res.status(500).json({
        status: "error",
        message: `Failed to delete index: ${message}`,
      });
    }
  });
};
