import assert from "node:assert/strict";
import { createHash } from "node:crypto";

assert.ok(process.argv[2], "Usage: node smoke.mjs https://your-worker.example.com");
const target = new URL(process.argv[2]);
assert.equal(target.protocol, "https:", "Use your deployed HTTPS endpoint");
assert.ok(!target.username && !target.password && target.pathname === "/" && !target.search && !target.hash,
  "Pass only the origin, without /t/p/, credentials, query or fragment");
const base = target.origin;
const path = "/t/p/w500/1E5baAaEse26fej7uHcjOgEE2t2.jpg";
const get = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const origin = await get("https://image.tmdb.org" + path);
assert.equal(origin.status, 200);
const expected = Buffer.from(await origin.arrayBuffer());
let etag;
let hit = false;
for (let i = 0; i < 3; i++) {
  const start = performance.now();
  const image = await get(base + path);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /^image\//);
  assert.equal(hash(Buffer.from(await image.arrayBuffer())), hash(expected));
  etag = image.headers.get("etag");
  hit ||= image.headers.get("cf-cache-status") === "HIT";
  console.log(`GET ${image.headers.get("cf-cache-status")} ${Math.round(performance.now() - start)} ms`);
}
assert.ok(hit, "expected a native cache hit on repeated requests");
assert.ok(etag);
const short = await get(base + path.slice(4), { redirect: "manual" });
assert.equal(short.status, 200);
assert.equal(hash(Buffer.from(await short.arrayBuffer())), hash(expected));
const head = await get(base + path, { method: "HEAD" });
assert.equal(head.status, 200);
assert.equal(await head.text(), "");
const conditional = await get(base + path, { headers: { "If-None-Match": etag } });
assert.equal(conditional.status, 304);
const range = await get(base + path, { headers: { Range: "bytes=0-9" } });
assert.equal(range.status, 206);
assert.deepEqual(Buffer.from(await range.arrayBuffer()), expected.subarray(0, 10));
const canonical = await get(base + path + "?v=1", { redirect: "manual" });
assert.equal(canonical.status, 308);
assert.equal(canonical.headers.get("location"), base + path);
for (const missing of ["/api/private", "/t/p/w500/tmdb-worker-missing-check.jpg"]) {
  const response = await get(base + missing);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  await response.body?.cancel();
}
console.log("PASS: original bytes, bare-origin path, cache hit, HEAD, 304, 206, canonical query, safe 404");

if (process.argv[3]) {
  const key = process.argv[3];
  assert.match(key, /^[A-Za-z0-9_-]{1,64}$/);
  let available = 0;
  for (const size of ["maxresdefault", "hq720", "mqdefault"]) {
    const suffix = `/vi/${key}/${size}.jpg`;
    const original = await get("https://i.ytimg.com" + suffix);
    const bytes = Buffer.from(await original.arrayBuffer());
    for (const prefix of ["/youtube", "/t/p/youtube"]) {
      const image = await get(base + prefix + suffix);
      assert.equal(image.status, original.status);
      const received = Buffer.from(await image.arrayBuffer());
      if (original.status === 200) {
        assert.equal(hash(received), hash(bytes));
        available++;
      }
    }
  }
  assert.ok(available > 0, "video must have at least one available thumbnail");
  console.log("PASS: YouTube thumbnails match upstream bytes/status through both image prefixes");
}
