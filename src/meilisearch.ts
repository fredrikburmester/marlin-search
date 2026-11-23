import { setTimeout as sleep } from "node:timers/promises";
import { ErrorStatusCode, type Index, Meilisearch } from "meilisearch";
import { INDEX_NAME, MEILISEARCH_API_KEY, MEILISEARCH_URL } from "./config";
import { logger } from "./logger";

export const client = new Meilisearch({
  host: MEILISEARCH_URL,
  apiKey: MEILISEARCH_API_KEY,
});

export const getIndex = (): Index => client.index(INDEX_NAME);

/**
 * In meilisearch-js the API error code lives on `cause`, not on the error
 * itself.
 */
const errorCode = (error: unknown): string | undefined =>
  (error as { cause?: { code?: string } })?.cause?.code;

/**
 * Meilisearch and the indexer start at the same time under Docker Compose, so
 * the first few connections are expected to fail. Retry instead of exiting.
 */
export const waitForMeilisearch = async (
  timeoutMs = 120_000,
  intervalMs = 3_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 1; ; attempt++) {
    if (await client.isHealthy()) return;

    if (Date.now() >= deadline) {
      throw new Error(
        `Meilisearch at ${MEILISEARCH_URL} was not reachable within ${Math.round(
          timeoutMs / 1000
        )}s`
      );
    }

    logger.warn(
      `Meilisearch is not ready yet (attempt ${attempt}), retrying in ${
        intervalMs / 1000
      }s...`
    );
    await sleep(intervalMs);
  }
};

export const ensureIndexExists = async (): Promise<void> => {
  try {
    await client.getIndex(INDEX_NAME);
    logger.info(`Index \`${INDEX_NAME}\` already exists.`);
  } catch (error) {
    if (errorCode(error) !== ErrorStatusCode.INDEX_NOT_FOUND) {
      logger.error(`Unexpected error when getting index: ${error}`);
      throw error;
    }

    await client.createIndex(INDEX_NAME, { primaryKey: "Id" });
    logger.info(`Index \`${INDEX_NAME}\` created successfully.`);
  }

  const index = getIndex();

  await index.updateFilterableAttributes([
    "Type",
    "MediaType",
    "IsFolder",
    "Container",
    "OfficialRating",
  ]);
  logger.info("Updated filterable attributes.");

  await index.updateSortableAttributes([
    "Name",
    "ProductionYear",
    "CriticRating",
    "RunTimeTicks",
  ]);
  logger.info("Updated sortable attributes.");
};
