import axios from "axios";
import {
  JELLYFIN_URL,
  JELLYFIN_API_KEY,
  BATCH_SIZE,
  INDEX_NAME,
} from "./config";
import { logger } from "./logger";
import { client } from "./meilisearch";

export const scrapeJellyfin = async (): Promise<{
  status: string;
  message: string;
}> => {
  const headers = { "X-Emby-Token": JELLYFIN_API_KEY! };
  const batchSize = BATCH_SIZE || 1000;
  const items = [];
  const allowedTypes = new Set([
    "Movie",
    "Series",
    "Episode",
    "MusicArtist",
    "MusicAlbum",
    "Audio",
  ]);

  try {
    for (const type of allowedTypes) {
      logger.info(`Fetching items of type ${type} from Jellyfin...`);

      const totalItemsResponse = await axios.get(`${JELLYFIN_URL}/Items`, {
        params: {
          Recursive: true,
          StartIndex: 0,
          Limit: 1,
          IncludeItemTypes: type,
        },
        headers,
        timeout: 30000,
      });

      const totalItems = totalItemsResponse.data.TotalRecordCount;
      const totalBatches = Math.ceil(totalItems / batchSize);
      logger.info(
        `Total ${type} items found: ${totalItems}. Fetching in ${totalBatches} batches of ${batchSize}...`
      );

      for (let index = 0; index < totalBatches; index++) {
        const startIndex = index * batchSize;
        logger.info(
          `Fetching batch ${
            index + 1
          }/${totalBatches} of type ${type} starting at index ${startIndex}...`
        );

        const response = await axios.get(`${JELLYFIN_URL}/Items`, {
          params: {
            Recursive: true,
            StartIndex: startIndex,
            Limit: batchSize,
            IncludeItemTypes: type,
            fields:
              "Id,Name,Type,MediaType,IsFolder,Container,ProductionYear,OriginalTitle,Overview,CriticRating,OfficialRating,Genres,Studios,People,Taglines,RunTimeTicks",
          },
          headers,
          timeout: 30000,
        });

        logger.info(
          `Batch ${
            index + 1
          }/${totalBatches} of type ${type} fetched successfully.`
        );
        const batchItems = response.data.Items || [];

        const filteredItems = batchItems.map((item: any) => ({
          Id: item.Id,
          Name: item.Name,
          Type: item.Type,
          MediaType: item.MediaType,
          IsFolder: item.IsFolder,
          Container: item.Container,
          ProductionYear: item.ProductionYear,
          OriginalTitle: item.OriginalTitle,
          Overview: item.Overview,
          CriticRating: item.CriticRating,
          OfficialRating: item.OfficialRating,
          Genres: item.Genres,
          Studios: item.Studios,
          People: item.People,
          Taglines: item.Taglines,
          RunTimeTicks: item.RunTimeTicks,
        }));

        items.push(...filteredItems);
      }

      logger.info(
        `Finished fetching all batches for type ${type}, found ${items.length} items. Now adding to MeiliSearch...`
      );

      const index = client.index(INDEX_NAME);
      await index.addDocuments(items);
      logger.info(
        `Added ${items.length} items of type ${type} to MeiliSearch.`
      );

      items.length = 0;
    }

    return {
      status: "success",
      message: `All items have been added to MeiliSearch.`,
    };
  } catch (error: any) {
    logger.error(`Error occurred: ${error.message}`);
    return {
      status: "error",
      message: `Error occurred: ${error.message}`,
    };
  }
};
