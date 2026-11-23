import * as dotenv from "dotenv";

// `quiet` suppresses dotenv's startup banner
dotenv.config({ quiet: true });

const missing: string[] = [];
const invalid: string[] = [];

const read = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const required = (name: string): string => {
  const value = read(name);
  if (!value) missing.push(name);
  return value ?? "";
};

const positiveInt = (name: string, fallback: number): number => {
  const raw = read(name);

  if (raw === undefined) return fallback;

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value <= 0) {
    invalid.push(`${name} must be a positive integer (got ${JSON.stringify(raw)})`);
    return fallback;
  }

  return value;
};

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

export const JELLYFIN_URL = stripTrailingSlash(required("JELLYFIN_URL"));
export const JELLYFIN_API_KEY = required("JELLYFIN_API_KEY");
export const MEILISEARCH_URL = stripTrailingSlash(required("MEILISEARCH_URL"));
export const MEILISEARCH_API_KEY = required("MEILISEARCH_API_KEY");

/** Guards POST /create-index, POST /clear-index and DELETE /delete-index. */
export const EXPRESS_AUTH_TOKEN = read("EXPRESS_AUTH_TOKEN");

/** Guards GET /search. When unset, /search stays public. */
export const SEARCH_AUTH_TOKEN = read("SEARCH_AUTH_TOKEN");

/** Guards POST /webhook. Falls back to EXPRESS_AUTH_TOKEN when unset. */
export const WEBHOOK_AUTH_TOKEN = read("WEBHOOK_AUTH_TOKEN") ?? EXPRESS_AUTH_TOKEN;

export const INDEX_NAME = read("INDEX_NAME") ?? "jellyfin_items";
export const BATCH_SIZE = positiveInt("BATCH_SIZE", 1000);
export const SCRAPE_INTERVAL_MINUTES = positiveInt("SCRAPE_INTERVAL_MINUTES", 60);
export const PORT = positiveInt("PORT", 5000);

/**
 * Bind address. Node's default depends on whether the container has IPv6, so
 * bind explicitly and let operators override it.
 */
export const HOST = read("HOST") ?? "0.0.0.0";

/** Default number of hits returned by /search when `limit` is not supplied. */
export const SEARCH_LIMIT = positiveInt("SEARCH_LIMIT", 50);

/** Upper bound on the `limit` query parameter. */
export const MAX_SEARCH_LIMIT = positiveInt("MAX_SEARCH_LIMIT", 1000);

/** Timeout applied to every outbound Jellyfin request. */
export const REQUEST_TIMEOUT_MS = positiveInt("REQUEST_TIMEOUT_MS", 30_000);

if (missing.length > 0 || invalid.length > 0) {
  // Report every problem at once instead of failing on the first one, so a
  // misconfigured deployment takes one restart to diagnose rather than four.
  for (const name of missing) {
    console.error(`Missing required environment variable: ${name}`);
  }

  for (const problem of invalid) {
    console.error(`Invalid environment variable: ${problem}`);
  }

  process.exit(1);
}
