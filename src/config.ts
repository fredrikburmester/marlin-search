import * as dotenv from "dotenv";

dotenv.config();

export const JELLYFIN_URL = process.env.JELLYFIN_URL;
export const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;
export const MEILISEARCH_URL = process.env.MEILISEARCH_URL;
export const MEILISEARCH_API_KEY = process.env.MEILISEARCH_API_KEY;
export const EXPRESS_AUTH_TOKEN = process.env.EXPRESS_AUTH_TOKEN;
export const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "1000", 10);
export const SCRAPE_INTERVAL_MINUTES = parseInt(
  process.env.SCRAPE_INTERVAL_MINUTES || "60",
  10
);
export const PORT = process.env.PORT || 5000;
export const INDEX_NAME = "jellyfin_items";
