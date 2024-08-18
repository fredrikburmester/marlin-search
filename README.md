# Marlin Search

> A simple search engine companion to Jellyfin, built with Python, Meilisearch and Flask.

## How it works

Marlin Search is a web application that uses the Jellyfin API to fetch media data from your Jellyfin server. It then indexes this data for fast searching through the use of Meilisearch, an open-source search engine.

After installation you can search via Marlin via GET requests on `/search?q=QUERY` where QUERY is what you're looking to find. The results will be returned in JSON format.

The results constist of jellyfin item IDs, which you can use with the Jellyfin API to get more detailed information about each media item.

## Installation

To install Marlin Search, follow these steps:

1. Clone this repository and navigate into it.
2. Create a Jellyfin API key from the Jellyfin admin panel.
3. Create a .env file in the root directory of this project and add these lines:

   - JELLYFIN_URL=<jellyfin-server-url>
   - MEILISEARCH_API_KEY=<random-key-here>
   - SCRAPE_INTERVAL_MINUTES=1
   - JELLYFIN_API_KEY=<jellyfin-api-key>

4. Run `docker-compose up -d` to start the application.
5. POST to `/index` to index your media data from Jellyfin. This will take a while depending on how much media you have, so be patient.
6. Start searching with GET requests to `/search?q=QUERY`.
