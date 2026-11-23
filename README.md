# Marlin Search

> A lightweight search companion for Jellyfin, built with TypeScript, Express, and Meilisearch.

## How it works

Marlin is a separate app to Jellyfin that you run in a Docker container, on either the same or a different server as Jellyfin. Marlin indexes your Jellyfin library and stores information about all items in [Meilisearch](https://www.meilisearch.com/), an open-source search engine.

Every hour (default, but configurable) Marlin re-scrapes your Jellyfin library and updates the index. On large libraries a full scrape can take several minutes. If you also set up the [Jellyfin webhook](#real-time-updates-with-the-jellyfin-webhook-plugin), individual items are indexed as they are added or removed, so you don't have to wait for the next scrape.

Marlin stores all relevant information about an item — name, overview, actors, studios, type, release year, and so on — so you can search for anything and get relevant results.

Search with `GET /search?q=QUERY`. The response is a JSON list of Jellyfin item IDs:

```json
{ "ids": ["1234567890", "0987654321"] }
```

Since Marlin is completely separate from Jellyfin and doesn't proxy any requests to it, you need to implement support for Marlin in your Jellyfin client. This consists of 2 steps:

1. Add a new search provider to your client, pointed at Marlin's `/search` endpoint.
2. Use the returned IDs with the Jellyfin API to get detailed information about each item.

This means Marlin has to be reachable from your Jellyfin client. With something like Tailscale that's easy, since you can use local IP addresses. Otherwise you need to expose Marlin to the internet — in which case, set `SEARCH_AUTH_TOKEN` (see [Authentication](#authentication)).

## Supported clients

- [Streamyfin](https://github.com/fredrikburmester/streamyfin) — a Jellyfin client for Android and iOS built with Expo.

## Installation

1. Clone the repository and navigate to the project directory.
2. Generate a Jellyfin API key from the Jellyfin admin panel (Dashboard → Advanced → API Keys).
3. Copy `.env.example` to `.env` and fill it in:

   ```bash
   cp .env.example .env
   openssl rand -hex 32   # use for MEILISEARCH_API_KEY
   openssl rand -hex 32   # use for EXPRESS_AUTH_TOKEN
   ```

4. Start it:

   ```bash
   docker compose up -d --build
   ```

   To skip the local build, use the published image instead — replace
   `build: .` in `docker-compose.yml` with:

   ```yaml
   image: ghcr.io/fredrikburmester/marlin-search:latest
   ```

   Images are published for `linux/amd64` and `linux/arm64`.

5. Trigger the first index build. This takes a while depending on how much media you have:

   ```bash
   curl -X POST http://localhost:5000/create-index \
     -H "Authorization: Bearer $EXPRESS_AUTH_TOKEN"
   ```

6. Start searching:

   ```bash
   curl "http://localhost:5000/search?q=inception"
   ```

## Configuration

Everything is configured through environment variables. See [`.env.example`](.env.example) for a copy-paste starting point.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `JELLYFIN_URL` | yes | — | Base URL of your Jellyfin server, reachable from the Marlin container. |
| `JELLYFIN_API_KEY` | yes | — | Jellyfin API key. |
| `MEILISEARCH_URL` | yes | — | Base URL of Meilisearch. Set for you by `docker-compose.yml`. |
| `MEILISEARCH_API_KEY` | yes | — | Meilisearch master key. Must be at least 16 bytes. |
| `EXPRESS_AUTH_TOKEN` | no | — | Guards the index management routes. **If unset, those routes are disabled and return `503`.** |
| `SEARCH_AUTH_TOKEN` | no | — | Guards `/search`. If unset, `/search` is public. |
| `WEBHOOK_AUTH_TOKEN` | no | `EXPRESS_AUTH_TOKEN` | Guards `/webhook`. |
| `INDEX_NAME` | no | `jellyfin_items` | Meilisearch index name. |
| `SCRAPE_INTERVAL_MINUTES` | no | `60` | How often the full re-scrape runs. |
| `BATCH_SIZE` | no | `1000` | Items fetched from Jellyfin per request. |
| `SEARCH_LIMIT` | no | `50` | Default number of hits `/search` returns. |
| `MAX_SEARCH_LIMIT` | no | `1000` | Upper bound on the `limit` query parameter. |
| `REQUEST_TIMEOUT_MS` | no | `30000` | Timeout for outbound Jellyfin requests. |
| `PORT` | no | `5000` | Port Marlin listens on. |
| `HOST` | no | `0.0.0.0` | Bind address. |
| `LOG_LEVEL` | no | `info` | `error`, `warn`, `info` or `debug`. |

Marlin validates its configuration at startup and exits with a list of every problem it found, so check the container logs first if it won't start.

## Authentication

Protected routes read a single `Authorization` header. Both of these work:

```
Authorization: Bearer YOUR_TOKEN
Authorization: YOUR_TOKEN
```

There are three independent tokens so you can, for example, hand out a search token to clients without also handing out the ability to delete your index:

- `EXPRESS_AUTH_TOKEN` — the index management routes. **If it isn't set, those routes are disabled**, rather than left open.
- `SEARCH_AUTH_TOKEN` — `/search`. Leave it unset to keep search public; set it if Marlin is exposed to the internet.
- `WEBHOOK_AUTH_TOKEN` — `/webhook`. Falls back to `EXPRESS_AUTH_TOKEN`.

A missing or wrong token returns `401`. A route whose token isn't configured returns `503`.

## Routes

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/up` | none | Health check. |
| `GET` | `/search` | `SEARCH_AUTH_TOKEN` (if set) | Search the index. |
| `POST` | `/webhook` | `WEBHOOK_AUTH_TOKEN` | Jellyfin webhook receiver. |
| `POST` | `/create-index` | `EXPRESS_AUTH_TOKEN` | Start a full scrape in the background. Returns `202` immediately. |
| `POST` | `/clear-index` | `EXPRESS_AUTH_TOKEN` | Remove all documents, keeping the index. |
| `DELETE` | `/delete-index` | `EXPRESS_AUTH_TOKEN` | Delete the index entirely. |

### `GET /search`

| Parameter | Default | Description |
| --- | --- | --- |
| `q` | — | **Required.** The search query. |
| `includeItemTypes` | all | Restrict results by item type. Repeat for multiple. One of `Movie`, `Series`, `Episode`, `MusicArtist`, `MusicAlbum`, `Audio`. |
| `limit` | `SEARCH_LIMIT` | Maximum number of IDs to return, capped at `MAX_SEARCH_LIMIT`. |

```bash
curl "http://localhost:5000/search?q=inception"
curl "http://localhost:5000/search?q=the+office&includeItemTypes=Series&includeItemTypes=Episode"
curl "http://localhost:5000/search?q=jazz&includeItemTypes=Audio&limit=100"
```

## Examples

Set `TOKEN` to your `EXPRESS_AUTH_TOKEN` first.

```bash
# Health check
curl http://localhost:5000/up

# Search (add -H "Authorization: Bearer $SEARCH_TOKEN" if SEARCH_AUTH_TOKEN is set)
curl "http://localhost:5000/search?q=inception"

# Build or rebuild the index (runs in the background; watch the logs)
curl -X POST http://localhost:5000/create-index \
  -H "Authorization: Bearer $TOKEN"

# Empty the index without deleting it
curl -X POST http://localhost:5000/clear-index \
  -H "Authorization: Bearer $TOKEN"

# Delete the index
curl -X DELETE http://localhost:5000/delete-index \
  -H "Authorization: Bearer $TOKEN"

# Follow the logs
docker compose logs -f marlin-search-indexer
```

If you'd rather run these from inside the container, prefix them with
`docker exec -it marlin-search-indexer`.

## Real-time updates with the Jellyfin webhook plugin

The hourly scrape keeps the index broadly correct, but you can have Jellyfin push changes to Marlin as they happen using the official [Webhook plugin](https://github.com/jellyfin/jellyfin-plugin-webhook).

Marlin only reads the **item ID** out of the webhook payload — it then fetches that item from the Jellyfin API itself. So the indexed document is always identical to what a full scrape would have produced, and the template below is all Marlin needs.

1. In Jellyfin, install the **Webhook** plugin from the plugin catalog and restart Jellyfin.
2. Open the plugin's settings and add a **Generic** destination.
3. Set the webhook URL to Marlin's `/webhook` route, e.g. `http://marlin-search-indexer:5000/webhook` if Jellyfin shares the Docker network, or `http://<marlin-host>:5000/webhook` otherwise.
4. Enable the **Item Added** and **Item Deleted** notification types, and select the item types you want indexed (movies, series, episodes, albums, songs).
5. Add a request header so Marlin can authenticate the call:

   | Key | Value |
   | --- | --- |
   | `Authorization` | `Bearer YOUR_WEBHOOK_AUTH_TOKEN` |

6. Set the payload template to:

   ```handlebars
   {"NotificationType":"{{NotificationType}}","ItemId":"{{ItemId}}","ItemType":"{{ItemType}}"}
   ```

The plugin's Generic destination sends `Content-Type: text/plain` unless you add a `Content-Type: application/json` header yourself. Marlin accepts either, so you don't have to — but adding it does no harm.

You can check the wiring without Jellyfin:

```bash
curl -X POST http://localhost:5000/webhook \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"NotificationType":"ItemAdded","ItemId":"<a real jellyfin item id>"}'
```

Marlin replies with the action it took:

```json
{ "status": "success", "action": "indexed", "itemId": "..." }
```

`action` is `indexed`, `deleted` (the item is gone from Jellyfin, so it was dropped from the index), or `ignored` (the item isn't a type Marlin indexes).

## Development

Requires Node.js 24 or newer.

```bash
npm install
cp .env.example .env   # then fill it in, including MEILISEARCH_URL
npm run dev            # watch mode, runs the TypeScript directly
npm run typecheck
npm test               # builds, then runs the integration suite
npm run build && npm start
```

`npm test` drives the compiled app against in-process stand-ins for Meilisearch
and Jellyfin, so it needs no Docker, no Jellyfin server and no network access.
CI runs it on Node 24 and 26, builds the image, and boots that image against a
real Meilisearch to confirm it reaches a healthy state.

Marlin logs to stdout. Under Docker Compose, log rotation is handled by the
`json-file` logging driver configured in `docker-compose.yml`.
