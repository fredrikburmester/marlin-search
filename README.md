# Marlin Search

> A simple search engine companion to Jellyfin, built with Python, Meilisearch and Flask.

## How it works

Marlin is a seperate app to Jellyfin that you run in a Docker container on either the same or a different server as Jellyfin. Marlin indexes your Jellyfin library and stores information about all items in Meilisearch, an open-source search engine.

Every hour (default, but configurable) Marlin will scrape your Jellyfin library and update the index in Meilisearch. This means that any changes to your library will be reflected in the search results within an hour. On large libraries, this can take several minutes.

Marlin stores all relevant information about an item, like the name, overview, actors, studios, type, release year, etc. This means that you can search for anything and get relevant results.

After installation you can search your Jellyfin library via Marlin by using GET requests on `/search?q=QUERY`, where QUERY is what you're looking to find. The results will be returned in JSON format.

The results constist of Jellyfin item IDs, which you can use with the Jellyfin API to get more detailed information about each media item.

```json
"ids" = [
   "1234567890",
   "0987654321",
]
```

Since Marlin is completely separate from Jellyfin and doesn't proxy any requests to Jellyfin, you will need to implement support for Marlin in your Jellyfin client. This is not difficult, and consists of 2 steps: 

1. Add a new search provider to your client. This provider should use the `/search` endpoint of Marlin to get search results.
2. When you have the ids of the search results, use the Jellyfin API to get more detailed information about each media item.

In the end this means that you need to expose Marlin to your Jellyfin client, and then you can search your Jellyfin library from your client. 

If you use something like Tailscale then this is really easy since you can use local ip-adresses. But if you don't you need to expose Marlin to the internet.

## Supprted clients

- [Streamyfin](https://github.com/fredrikburmester/streamyfin) - A Jellyfin client for Android and iOS built with Expo.

## Installation

To install Marlin Search, follow these steps:

1. Clone this repository and navigate into it.
2. Create a Jellyfin API key from the Jellyfin admin panel.
3. Create a .env file in the root directory of this project and add these lines:

   - JELLYFIN_URL=<jellyfin-server-url>
   - JELLYFIN_API_KEY=<jellyfin-api-key>
   - MEILISEARCH_API_KEY=<random-key-here>
   - SCRAPE_INTERVAL_MINUTES=60
   - EXPRESS_AUTH_TOKEN<secret-here>
   - BATCH_SIZE=1000

4. Run `docker-compose up -d --build` to start the application.
5. POST to `/create-index` to index your media data from Jellyfin. This will take a while depending on how much media you have, so be patient.
6. Start searching with GET requests to `/search?q=QUERY`.

## Routes

1. GET /up - Check if the service is up and running.
2. GET /search - Search for items in the index. Query parameter 'q' is required.
3. POST /create-index - Create a new Meilisearch index from Jellyfin data. This will take a while depending on how much media you have, so be patient.
4. DELETE /delete-index - Delete current Meilisearch index.
5. POST /clear-index - Clear all items from the current Meilisearch index.