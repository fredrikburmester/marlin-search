/**
 * End-to-end tests for the HTTP surface.
 *
 * These drive the real compiled app (`build/index.js`) against purpose-built
 * stand-ins for Meilisearch and Jellyfin, so the suite is entirely self-contained.
 *
 * Run with `npm test` (which builds first).
 */
const { after, before, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const REPO_ROOT = path.resolve(__dirname, "..");
const ENTRYPOINT = path.join(REPO_ROOT, "build", "index.js");
const ADMIN_TOKEN = "admin-token-for-tests";

// meilisearch mocks

const enqueuedTask = (type) => ({
  taskUid: 1,
  indexUid: "jellyfin_items",
  status: "enqueued",
  type,
  enqueuedAt: new Date().toISOString(),
});

const createMeilisearchStub = () => {
  const state = {
    indexExists: false,
    created: [],
    settings: [],
    searches: [],
    added: [],
    deleted: [],
    clearedAll: 0,
    reset() {
      this.created.length = 0;
      this.settings.length = 0;
      this.searches.length = 0;
      this.added.length = 0;
      this.deleted.length = 0;
      this.clearedAll = 0;
    },
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const { pathname } = new URL(req.url, "http://stub");
      const send = (code, payload) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (pathname === "/health") return send(200, { status: "available" });

      if (pathname === "/indexes" && req.method === "POST") {
        state.indexExists = true;
        state.created.push(JSON.parse(raw || "{}"));
        return send(202, enqueuedTask("indexCreation"));
      }

      if (pathname === "/indexes/jellyfin_items") {
        if (req.method === "GET") {
          if (!state.indexExists) {
            return send(404, {
              message: "Index `jellyfin_items` not found.",
              code: "index_not_found",
              type: "invalid_request",
              link: "https://docs.meilisearch.com/errors#index_not_found",
            });
          }
          return send(200, { uid: "jellyfin_items", primaryKey: "Id" });
        }
        if (req.method === "DELETE") {
          state.indexExists = false;
          return send(202, enqueuedTask("indexDeletion"));
        }
      }

      if (pathname.startsWith("/indexes/jellyfin_items/settings/")) {
        state.settings.push(pathname.split("/").pop());
        return send(202, enqueuedTask("settingsUpdate"));
      }

      if (pathname === "/indexes/jellyfin_items/search" && req.method === "POST") {
        state.searches.push(JSON.parse(raw || "{}"));
        return send(200, {
          hits: [
            { Id: "abc123", Name: "Inception" },
            { Id: "def456", Name: "Interstellar" },
          ],
          query: "",
          processingTimeMs: 1,
          limit: 20,
          offset: 0,
          estimatedTotalHits: 2,
        });
      }

      if (pathname === "/indexes/jellyfin_items/documents") {
        if (req.method === "POST") {
          state.added.push(JSON.parse(raw || "[]"));
          return send(202, enqueuedTask("documentAdditionOrUpdate"));
        }
        if (req.method === "DELETE") {
          state.clearedAll += 1;
          return send(202, enqueuedTask("documentDeletion"));
        }
      }

      if (pathname.startsWith("/indexes/jellyfin_items/documents/") && req.method === "DELETE") {
        state.deleted.push(decodeURIComponent(pathname.split("/").pop()));
        return send(202, enqueuedTask("documentDeletion"));
      }

      send(404, {
        message: `unhandled ${req.method} ${pathname}`,
        code: "not_found",
        type: "invalid_request",
        link: "",
      });
    });
  });

  return { server, state };
};

// jellyfin mocks

const INDEXED_ITEM = {
  Id: "item-known",
  Name: "The Matrix",
  Type: "Movie",
  Overview: "A hacker learns the truth.",
  ProductionYear: 1999,
  Genres: ["Action", "Sci-Fi"],
  RunTimeTicks: 81720000000,
  // Present on the Jellyfin item but deliberately not an indexed field.
  SortName: "Matrix, The",
};

const UNINDEXED_ITEM = { Id: "item-photo", Name: "Holiday", Type: "Photo" };

const createJellyfinStub = () => {
  const state = {
    items: { [INDEXED_ITEM.Id]: INDEXED_ITEM, [UNINDEXED_ITEM.Id]: UNINDEXED_ITEM },
    requests: [],
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://stub");
    state.requests.push(url.search);

    if (url.pathname !== "/Items") {
      res.writeHead(404);
      return res.end();
    }

    const ids = url.searchParams.get("Ids");
    const body = ids
      ? state.items[ids]
        ? { Items: [state.items[ids]], TotalRecordCount: 1 }
        : { Items: [], TotalRecordCount: 0 }
      : { Items: [], TotalRecordCount: 0 };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });

  return { server, state };
};

// ---------------------------------------------------------------- helpers

const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};

const freePort = async () => {
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

const request = (port, method, routePath, { headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: routePath, headers }, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        let json;
        try {
          json = JSON.parse(raw);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, body: raw, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

let meili;
let jellyfin;
let baseEnv;

/** Boot the compiled app and wait until it answers on /up. */
const startApp = async (env = {}) => {
  const port = await freePort();
  const child = spawn(process.execPath, [ENTRYPOINT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...baseEnv, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  const exited = once(child, "exit").then(([code]) => code);

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await request(port, "GET", "/up");
      if (res.status === 200) return { port, child, getLog: () => log, exited };
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  child.kill("SIGKILL");
  throw new Error(`app did not become ready. Log:\n${log}`);
};

const stopApp = async (app) => {
  if (!app?.child || app.child.exitCode !== null) return;
  app.child.kill("SIGTERM");
  await app.exited;
};

// ---------------------------------------------------------------- suite

before(async () => {
  assert.ok(
    fs.existsSync(ENTRYPOINT),
    `${ENTRYPOINT} is missing - run \`npm run build\` before the tests.`
  );

  meili = createMeilisearchStub();
  jellyfin = createJellyfinStub();
  const meiliPort = await listen(meili.server);
  const jellyfinPort = await listen(jellyfin.server);

  baseEnv = {
    JELLYFIN_URL: `http://127.0.0.1:${jellyfinPort}`,
    JELLYFIN_API_KEY: "jellyfin-key",
    MEILISEARCH_URL: `http://127.0.0.1:${meiliPort}`,
    MEILISEARCH_API_KEY: "meilisearch-key",
    NODE_ENV: "production",
    // Keep the scheduler from firing mid-test.
    SCRAPE_INTERVAL_MINUTES: "1440",
    LOG_LEVEL: "error",
    // Inherited values must not leak in from the developer's own shell.
    EXPRESS_AUTH_TOKEN: "",
    SEARCH_AUTH_TOKEN: "",
    WEBHOOK_AUTH_TOKEN: "",
    INDEX_NAME: "",
  };
});

after(() => {
  meili?.server.close();
  jellyfin?.server.close();
});

describe("startup", () => {
  it("creates the index with the right primary key and settings", async () => {
    meili.state.indexExists = false;
    meili.state.reset();

    const app = await startApp({ EXPRESS_AUTH_TOKEN: ADMIN_TOKEN });
    try {
      assert.equal(meili.state.created[0]?.primaryKey, "Id");
      assert.deepEqual(meili.state.settings.sort(), [
        "filterable-attributes",
        "sortable-attributes",
      ]);
    } finally {
      await stopApp(app);
    }
  });

  it("exits non-zero and reports every bad environment variable at once", async () => {
    const child = spawn(process.execPath, [ENTRYPOINT], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...baseEnv, JELLYFIN_URL: "", BATCH_SIZE: "not-a-number" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));

    const [code] = await once(child, "exit");
    assert.equal(code, 1);
    assert.match(log, /JELLYFIN_URL/);
    assert.match(log, /BATCH_SIZE/);
  });

  it("shuts down cleanly on SIGTERM", async () => {
    const app = await startApp({ EXPRESS_AUTH_TOKEN: ADMIN_TOKEN });
    const startedAt = Date.now();
    app.child.kill("SIGTERM");
    const code = await app.exited;

    assert.equal(code, 0);
    assert.ok(Date.now() - startedAt < 5000, "SIGTERM should not wait for the kill timeout");
  });
});

describe("with an admin token configured", () => {
  let app;

  before(async () => {
    meili.state.indexExists = true;
    app = await startApp({ EXPRESS_AUTH_TOKEN: ADMIN_TOKEN });
  });
  after(() => stopApp(app));

  it("GET /up reports healthy", async () => {
    assert.equal((await request(app.port, "GET", "/up")).status, 200);
  });

  it("GET /search returns ids without a token when search is public", async () => {
    const res = await request(app.port, "GET", "/search?q=inception");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.ids, ["abc123", "def456"]);
  });

  it("GET /search requires q", async () => {
    assert.equal((await request(app.port, "GET", "/search")).status, 400);
  });

  it("GET /search builds a filter from known item types", async () => {
    meili.state.reset();
    const res = await request(
      app.port,
      "GET",
      "/search?q=x&includeItemTypes=Movie&includeItemTypes=Series"
    );
    assert.equal(res.status, 200);
    assert.equal(meili.state.searches[0].filter, 'Type = "Movie" OR Type = "Series"');
  });

  it("GET /search rejects unknown item types instead of interpolating them", async () => {
    const injection = encodeURIComponent("Movie\" OR Id = \"anything");
    const res = await request(app.port, "GET", `/search?q=x&includeItemTypes=${injection}`);
    assert.equal(res.status, 400);
  });

  it("GET /search applies, defaults and clamps limit", async () => {
    meili.state.reset();
    await request(app.port, "GET", "/search?q=x");
    assert.equal(meili.state.searches.at(-1).limit, 50);

    await request(app.port, "GET", "/search?q=x&limit=7");
    assert.equal(meili.state.searches.at(-1).limit, 7);

    await request(app.port, "GET", "/search?q=x&limit=99999");
    assert.equal(meili.state.searches.at(-1).limit, 1000);
  });

  it("rejects admin routes when the Authorization header is absent", async () => {
    // Regression test: an unset token once compared equal to an absent header.
    const res = await request(app.port, "POST", "/create-index");
    assert.equal(res.status, 401);
  });

  it("rejects admin routes with the wrong token", async () => {
    const res = await request(app.port, "POST", "/create-index", {
      headers: { authorization: "not-the-token" },
    });
    assert.equal(res.status, 401);
  });

  it("accepts both the bare and the Bearer header form", async () => {
    const bare = await request(app.port, "POST", "/create-index", {
      headers: { authorization: ADMIN_TOKEN },
    });
    const bearer = await request(app.port, "POST", "/create-index", {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(bare.status, 202);
    assert.equal(bearer.status, 202);
  });

  it("POST /clear-index empties the index", async () => {
    meili.state.reset();
    const res = await request(app.port, "POST", "/clear-index", {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(res.status, 200);
    assert.equal(meili.state.clearedAll, 1);
  });
});

describe("webhook receiver", () => {
  let app;
  const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };

  before(async () => {
    meili.state.indexExists = true;
    app = await startApp({ EXPRESS_AUTH_TOKEN: ADMIN_TOKEN });
  });
  after(() => stopApp(app));

  it("rejects unauthenticated calls", async () => {
    const res = await request(app.port, "POST", "/webhook", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ NotificationType: "ItemAdded", ItemId: INDEXED_ITEM.Id }),
    });
    assert.equal(res.status, 401);
  });

  // The plugin's Generic destination sends text/plain unless told otherwise.
  for (const contentType of ["text/plain", "application/json"]) {
    it(`indexes ItemAdded from a ${contentType} body`, async () => {
      meili.state.reset();
      const res = await request(app.port, "POST", "/webhook", {
        headers: { ...auth, "content-type": contentType },
        body: JSON.stringify({ NotificationType: "ItemAdded", ItemId: INDEXED_ITEM.Id }),
      });

      assert.equal(res.status, 200);
      assert.equal(res.json.action, "indexed");
      assert.equal(meili.state.added[0][0].Id, INDEXED_ITEM.Id);
    });
  }

  it("stores only the indexed fields", async () => {
    meili.state.reset();
    await request(app.port, "POST", "/webhook", {
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ NotificationType: "ItemAdded", ItemId: INDEXED_ITEM.Id }),
    });

    const document = meili.state.added[0][0];
    assert.ok("RunTimeTicks" in document);
    assert.ok(!("SortName" in document), "non-indexed Jellyfin fields must be dropped");
  });

  it("removes the document on ItemDeleted", async () => {
    meili.state.reset();
    const res = await request(app.port, "POST", "/webhook", {
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ NotificationType: "ItemDeleted", ItemId: "item-removed" }),
    });

    assert.equal(res.json.action, "deleted");
    assert.ok(meili.state.deleted.includes("item-removed"));
  });

  it("drops items Jellyfin no longer knows about", async () => {
    meili.state.reset();
    const res = await request(app.port, "POST", "/webhook", {
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ NotificationType: "ItemAdded", ItemId: "item-vanished" }),
    });

    assert.equal(res.json.action, "deleted");
    assert.ok(meili.state.deleted.includes("item-vanished"));
  });

  it("ignores item types that are not indexed", async () => {
    meili.state.reset();
    const res = await request(app.port, "POST", "/webhook", {
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ NotificationType: "ItemAdded", ItemId: UNINDEXED_ITEM.Id }),
    });

    assert.equal(res.json.action, "ignored");
    assert.equal(meili.state.added.length, 0);
  });

  it("rejects an unparseable body and a payload with no ItemId", async () => {
    const unparseable = await request(app.port, "POST", "/webhook", {
      headers: { ...auth, "content-type": "text/plain" },
      body: "not json at all",
    });
    const noId = await request(app.port, "POST", "/webhook", {
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ NotificationType: "PlaybackStart" }),
    });

    assert.equal(unparseable.status, 400);
    assert.equal(noId.status, 400);
  });
});

describe("without an admin token configured", () => {
  let app;

  before(async () => {
    meili.state.indexExists = true;
    app = await startApp();
  });
  after(() => stopApp(app));

  it("disables the index management routes rather than leaving them open", async () => {
    const create = await request(app.port, "POST", "/create-index");
    const remove = await request(app.port, "DELETE", "/delete-index");
    assert.equal(create.status, 503);
    assert.equal(remove.status, 503);
  });

  it("keeps /search working", async () => {
    assert.equal((await request(app.port, "GET", "/search?q=x")).status, 200);
  });
});

describe("with a search token configured", () => {
  let app;

  before(async () => {
    meili.state.indexExists = true;
    app = await startApp({ EXPRESS_AUTH_TOKEN: ADMIN_TOKEN, SEARCH_AUTH_TOKEN: "search-token" });
  });
  after(() => stopApp(app));

  it("rejects anonymous searches", async () => {
    assert.equal((await request(app.port, "GET", "/search?q=x")).status, 401);
  });

  it("accepts the search token", async () => {
    const res = await request(app.port, "GET", "/search?q=x", {
      headers: { authorization: "Bearer search-token" },
    });
    assert.equal(res.status, 200);
  });

  it("does not accept the admin token for searching", async () => {
    const res = await request(app.port, "GET", "/search?q=x", {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(res.status, 401);
  });
});
