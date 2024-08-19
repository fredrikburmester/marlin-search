import * as dotenv from "dotenv";

dotenv.config();

function checkEnvVariable(
  variableName: string,
  required: boolean = true
): string {
  const value = process.env[variableName];
  if (required && (!value || value.trim() === "")) {
    console.error(`Environment variable ${variableName} is missing or empty.`);
    process.exit(1); // Exit the process with a failure code
  }
  return value!;
}

function checkEnvVariableAsInt(
  variableName: string,
  defaultValue: number
): number {
  const value = parseInt(process.env[variableName] || `${defaultValue}`, 10);
  if (isNaN(value)) {
    console.error(
      `Environment variable ${variableName} must be a valid number.`
    );
    process.exit(1); // Exit the process with a failure code
  }
  return value;
}

export const JELLYFIN_URL = checkEnvVariable("JELLYFIN_URL");
export const JELLYFIN_API_KEY = checkEnvVariable("JELLYFIN_API_KEY");
export const MEILISEARCH_URL = checkEnvVariable("MEILISEARCH_URL");
export const MEILISEARCH_API_KEY = checkEnvVariable("MEILISEARCH_API_KEY");
export const EXPRESS_AUTH_TOKEN = checkEnvVariable("EXPRESS_AUTH_TOKEN", false);
export const BATCH_SIZE = checkEnvVariableAsInt("BATCH_SIZE", 1000);
export const SCRAPE_INTERVAL_MINUTES = checkEnvVariableAsInt(
  "SCRAPE_INTERVAL_MINUTES",
  60
);
export const PORT = checkEnvVariableAsInt("PORT", 5000);
export const INDEX_NAME =
  checkEnvVariable("INDEX_NAME", false) || "jellyfin_items";
