import axios from "axios";
import {
  BATCH_SIZE,
  JELLYFIN_API_KEY,
  JELLYFIN_URL,
  REQUEST_TIMEOUT_MS,
} from "./config";
import { logger } from "./logger";
import { ensureIndexExists, getIndex } from "./meilisearch";

/** Jellyfin item types Marlin indexes. */
export const INDEXED_TYPES = [
  "Movie",
  "Series",
  "Episode",
  "MusicArtist",
  "MusicAlbum",
  "Audio",
] as const;

export type IndexedType = (typeof INDEXED_TYPES)[number];

const indexedTypes: ReadonlySet<string> = new Set(INDEXED_TYPES);

export const isIndexedType = (type: unknown): type is IndexedType =>
  typeof type === "string" && indexedTypes.has(type);

/** The only item properties Marlin stores in Meilisearch. */
const DOCUMENT_FIELDS = [
  "Id",
  "Name",
  "Type",
  "MediaType",
  "IsFolder",
  "Container",
  "ProductionYear",
  "OriginalTitle",
  "Overview",
  "CriticRating",
  "OfficialRating",
  "Genres",
  "Studios",
  "People",
  "Taglines",
  "RunTimeTicks",
] as const;

export type JellyfinItem = Record<string, unknown> & { Id: string };
export type IndexedDocument = Record<(typeof DOCUMENT_FIELDS)[number], unknown>;

export type ScrapeResult = {
  status: "success" | "error" | "skipped";
  message: string;
};

const headers = { "X-Emby-Token": JELLYFIN_API_KEY };

/**
 * Project a raw Jellyfin item onto exactly the indexed fields, so the full
 * scrape and the webhook receiver can never disagree about document shape.
 */
export const toDocument = (item: JellyfinItem): IndexedDocument =>
  Object.fromEntries(
    DOCUMENT_FIELDS.map((field) => [field, item[field]])
  ) as IndexedDocument;

const getItems = async (
  params: Record<string, unknown>
): Promise<{ Items?: JellyfinItem[]; TotalRecordCount?: number }> => {
  const { data } = await axios.get(`${JELLYFIN_URL}/Items`, {
    params: { Fields: DOCUMENT_FIELDS.join(","), ...params },
    headers,
    timeout: REQUEST_TIMEOUT_MS,
  });
  return data ?? {};
};

/** Fetch a single item by id. Returns `null` when Jellyfin no longer has it. */
export const fetchItemById = async (
  itemId: string
): Promise<JellyfinItem | null> => {
  const { Items } = await getItems({ Ids: itemId, Recursive: true });
  return Items?.[0] ?? null;
};

const runScrape = async (): Promise<ScrapeResult> => {
  try {
    // Recreates the index and its settings if /delete-index was called, so a
    // scrape never silently populates an index without a primary key.
    await ensureIndexExists();

    const index = getIndex();

    for (const type of INDEXED_TYPES) {
      logger.info(`Fetching items of type ${type} from Jellyfin...`);

      const { TotalRecordCount = 0 } = await getItems({
        Recursive: true,
        StartIndex: 0,
        Limit: 1,
        IncludeItemTypes: type,
      });

      const totalBatches = Math.ceil(TotalRecordCount / BATCH_SIZE);
      if (totalBatches === 0) {
        logger.info(`No ${type} items found, skipping.`);
        continue;
      }

      logger.info(
        `Total ${type} items found: ${TotalRecordCount}. Fetching in ${totalBatches} batches of ${BATCH_SIZE}...`
      );

      const documents: IndexedDocument[] = [];

      for (let batch = 0; batch < totalBatches; batch++) {
        const startIndex = batch * BATCH_SIZE;
        logger.info(
          `Fetching batch ${batch + 1}/${totalBatches} of type ${type} starting at index ${startIndex}...`
        );

        const { Items = [] } = await getItems({
          Recursive: true,
          StartIndex: startIndex,
          Limit: BATCH_SIZE,
          IncludeItemTypes: type,
        });

        documents.push(...Items.map(toDocument));
      }

      logger.info(
        `Fetched ${documents.length} ${type} items, adding them to Meilisearch...`
      );
      await index.addDocuments(documents);
      logger.info(`Added ${documents.length} items of type ${type} to Meilisearch.`);
    }

    return {
      status: "success",
      message: "All items have been added to Meilisearch.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Scrape failed: ${message}`);
    return { status: "error", message: `Scrape failed: ${message}` };
  }
};

let inFlight: Promise<ScrapeResult> | null = null;

/**
 * Run a full scrape. On a large library a scrape can outlast
 * SCRAPE_INTERVAL_MINUTES, so concurrent runs are collapsed rather than
 * allowed to pile up and hammer Jellyfin.
 */
export const scrapeJellyfin = (): Promise<ScrapeResult> => {
  if (inFlight) {
    logger.warn("A scrape is already running; ignoring this request.");
    return Promise.resolve({
      status: "skipped",
      message: "A scrape is already in progress.",
    });
  }

  inFlight = runScrape().finally(() => {
    inFlight = null;
  });

  return inFlight;
};

export const isScrapeInProgress = (): boolean => inFlight !== null;
