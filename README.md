# Marlin Search

> A lightweight search companion for Jellyfin, built with TypeScript, Express, and Meilisearch.

## How it works

Marlin Search integrates with your Jellyfin server via its API to retrieve media data. This data is then indexed by Meilisearch, enabling fast and efficient searches.

## How to use

Marlin Search operates independently from Jellyfin, so it requires its own domain or can be accessed locally. After setup, you can search by sending GET requests to:

```
http://your-server-ip:5000/search?q=QUERY
``` 

Replace `QUERY` with your search term. The response will include Jellyfin item IDs, which you can use with the Jellyfin API to retrieve detailed media information.

```json
{
   "ids": ["123", "456"]
}
```

## Installation

To install Marlin Search, follow these steps:

1. Clone the repository and navigate to the project directory.
2. Generate a Jellyfin API key from the Jellyfin admin panel.
3. Create a .env file in the project root with the following configuration:

   - JELLYFIN_URL=
   - JELLYFIN_API_KEY=
   - MEILISEARCH_API_KEY=
   - SCRAPE_INTERVAL_MINUTES=60
   - EXPRESS_AUTH_TOKEN=
   - BATCH_SIZE=1000

4. Run `docker-compose up -d --build` to start the application.
5. POST to `/create-index` to index your media data from Jellyfin. Don't forget to use the `Authorization` header with your `EXPRESS_AUTH_TOKEN`. This will take a while depending on how much media you have, so be patient.
6. Start searching with GET requests to `/search?q=QUERY`.

## Routes

1. GET /up - Check if the service is up and running.
2. GET /search - Search for items in the index. Query parameter 'q' is required.
3. POST /create-index - Create a new Meilisearch index from Jellyfin data. This will take a while depending on how much media you have, so be patient.
4. DELETE /delete-index - Delete current Meilisearch index.
5. POST /clear-index - Clear all items from the current Meilisearch index.
