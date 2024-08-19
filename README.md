# Marlin Search

> A simple search engine companion to Jellyfin, built with TS, Express and Meilisearch.

## How it works

Marlin Search is a web application that uses the Jellyfin API to fetch media data from your Jellyfin server. It then indexes this data for fast searching through the use of Meilisearch, an open-source search engine.


## How to use

Since this is not connected to Jellyfin, and does not route any requests, Marlin needs its own domain (or if run locally you can access it as such).

After installation you can search via Marlin via GET requests on `http://your-server-ip:5000/search?q=QUERY` where QUERY is what you're looking to find. 

The results constist of jellyfin item IDs, which you can use with the Jellyfin API to get more detailed information about each media item.

```
{
   "ids": ["123", "456"]
}
```



## Installation

To install Marlin Search, follow these steps:

1. Clone this repository and navigate into it.
2. Create a Jellyfin API key from the Jellyfin admin panel.
3. Create a .env file in the root directory of this project and add these lines:

   - JELLYFIN_URL=
   - JELLYFIN_API_KEY=
   - MEILISEARCH_API_KEY=
   - SCRAPE_INTERVAL_MINUTES=60
   - EXPRESS_AUTH_TOKEN=
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
