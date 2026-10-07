import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import worker from "./worker.mjs";

const path = "/t/p/w500/1E5baAaEse26fej7uHcjOgEE2t2.jpg";
const request = (suffix = path, init) => new Request("https://images.example.com" + suffix, init);

test("TMDB image gateway policy", async (t) => {
  // Free accounts enforce their own CPU limit and reject custom CPU tuning.
  const config = JSON.parse(readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.limits?.cpu_ms, undefined);
  const calls = [];
  const responses = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.ok(response, "unexpected upstream request");
    return response;
  });

  for (const bad of ["/api/3/movie/1", "/t/p/w999/a.jpg", "/t/p/w500/a%2fb.jpg", "/t/p/w500/a.html", "/w999/a.jpg", "/w500/a%2fb.jpg", "/w500/a.html"]) {
    assert.equal((await worker.fetch(request(bad))).status, 404);
  }
  assert.equal((await worker.fetch(request(path, { method: "POST" }))).status, 405);
  assert.equal((await worker.fetch(request(path, { method: "OPTIONS" }))).status, 204);
  const canonical = await worker.fetch(request(path + "?v=1"));
  assert.equal(canonical.status, 308);
  assert.equal(canonical.headers.get("Location"), request().url);
  assert.equal(calls.length, 0);

  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  responses.push(new Response(bytes, { headers: {
    "Content-Type": "image/jpeg", "ETag": '"image-1"', "Set-Cookie": "secret=1", "Accept-Ranges": "bytes",
  } }));
  const image = await worker.fetch(request(path, { headers: { Cookie: "private=1", Authorization: "secret" } }));
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
  assert.equal(image.headers.get("Set-Cookie"), null);
  assert.equal(image.headers.get("ETag"), '"image-1"');
  assert.equal(image.headers.get("Accept-Ranges"), "bytes");
  assert.match(image.headers.get("Server-Timing"), /^origin_headers;dur=\d+$/);
  assert.match(image.headers.get("Cache-Control"), /max-age=2592000/);
  assert.match(image.headers.get("Cloudflare-CDN-Cache-Control"), /stale-if-error=604800/);
  assert.equal(calls[0].url, "https://image.tmdb.org" + path);
  assert.equal(calls[0].init.headers.has("Cookie"), false);
  assert.equal(calls[0].init.headers.has("Authorization"), false);
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "manual");

  for (const prefix of ["", "/t/p"]) {
    for (const size of ["maxresdefault", "hq720", "mqdefault"]) {
      responses.push(new Response(bytes, { headers: { "Content-Type": "image/jpeg" } }));
      const thumbnail = await worker.fetch(request(`${prefix}/youtube/vi/abc_-123xyz/${size}.jpg`));
      assert.equal(thumbnail.status, 200);
      assert.deepEqual(new Uint8Array(await thumbnail.arrayBuffer()), bytes);
      assert.equal(calls.at(-1).url, `https://i.ytimg.com/vi/abc_-123xyz/${size}.jpg`);
      assert.equal(thumbnail.headers.get("Cache-Control"), "public, max-age=86400");
    }
  }
  for (const bad of ["/youtube/vi/a%2fb/maxresdefault.jpg", "/youtube/vi/abc/default.html", "/youtube/https://example.com/x.jpg", "/youtube/vi/abc/maxresdefault.jpg/extra"]) {
    assert.equal((await worker.fetch(request(bad))).status, 404);
  }

  for (const shortPath of [path.slice(4), "/original/1E5baAaEse26fej7uHcjOgEE2t2.jpg"]) {
    responses.push(new Response(bytes, { headers: { "Content-Type": "image/jpeg" } }));
    const short = await worker.fetch(request(shortPath));
    assert.equal(short.status, 200);
    assert.equal(short.headers.has("Location"), false);
    assert.deepEqual(new Uint8Array(await short.arrayBuffer()), bytes);
    assert.equal(calls.at(-1).url, "https://image.tmdb.org/t/p" + shortPath);
  }

  responses.push(new Response(null, { headers: { "Content-Type": "image/jpeg" } }));
  const head = await worker.fetch(request(path, { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(calls.at(-1).init.method, "HEAD");

  responses.push(new Response(null, { status: 304, headers: { ETag: '"image-1"' } }));
  const conditional = await worker.fetch(request(path, { headers: { "If-None-Match": '"image-1"' } }));
  assert.equal(conditional.status, 304);
  assert.equal(calls.at(-1).init.headers.get("If-None-Match"), '"image-1"');

  for (const status of [302, 404, 403, 429, 500]) {
    responses.push(new Response("error", { status, headers: { "Retry-After": "30" } }));
    const error = await worker.fetch(request());
    assert.equal(error.status, status === 404 || status === 429 ? status : 502);
    assert.equal(error.headers.get("Cache-Control"), "no-store");
    assert.equal(error.headers.get("Cloudflare-CDN-Cache-Control"), status === 404 ? "public, max-age=60" : "no-store");
    if (status === 429) assert.equal(error.headers.get("Retry-After"), "30");
  }
  responses.push(new Response("upstream error page", { headers: { "Content-Type": "text/html" } }));
  assert.equal((await worker.fetch(request())).status, 502);

  responses.push(new Response("temporary", { status: 503 }), new Response(bytes, { headers: { "Content-Type": "image/jpeg" } }));
  assert.equal((await worker.fetch(request())).status, 200);
  responses.push(new Error("connection reset"), new Error("connection reset"));
  const unavailable = await worker.fetch(request());
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.headers.get("Cache-Control"), "no-store");
  assert.equal(responses.length, 0);
});

test("returns an unfinished upstream stream without buffering the image", { timeout: 1000 }, async (t) => {
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([0xff, 0xd8])); },
  });
  const origin = new Response(stream, { headers: { "Content-Type": "image/jpeg" } });
  const fetch = t.mock.method(globalThis, "fetch", async () => origin);
  const result = await worker.fetch(request());
  assert.equal(result.status, 200);
  assert.equal(result.body, origin.body);
  assert.equal(fetch.mock.callCount(), 1);
  const reader = result.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([0xff, 0xd8]));
  await reader.cancel();
});

test("allows slow upstream headers without an artificial four-second abort", async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", (_url, init) => new Promise((resolve, reject) => {
    attempts++;
    const timer = setTimeout(() => resolve(new Response("image bytes", {
      headers: { "Content-Type": "image/jpeg" },
    })), 4200);
    init.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  }));
  const response = await worker.fetch(request());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "image bytes");
  assert.equal(attempts, 1);
});
