// Tests for SiYuanClient HTTP handling (mock global fetch; run against dist/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SiYuanClient } from "../dist/client.js";

const config = {
  apiUrl: "http://127.0.0.1:6806",
  apiToken: "test-token",
  timeoutMs: 30000,
  readOnly: false,
  enableLegacyAliases: false,
  enableSql: true,
};

function mockFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

test("request unwraps the data field on success", async () => {
  const restore = mockFetch(async () => ({
    json: async () => ({ code: 0, msg: "", data: { hello: "world" } }),
    status: 200,
  }));
  try {
    const client = new SiYuanClient(config);
    const data = await client.request("/api/test");
    assert.deepEqual(data, { hello: "world" });
  } finally {
    restore();
  }
});

test("request sends the auth token header", async () => {
  let seenHeaders;
  const restore = mockFetch(async (_url, init) => {
    seenHeaders = init.headers;
    return { json: async () => ({ code: 0, msg: "", data: null }), status: 200 };
  });
  try {
    const client = new SiYuanClient(config);
    await client.request("/api/test", { a: 1 });
    assert.equal(seenHeaders["Authorization"], "Token test-token");
    assert.equal(seenHeaders["Content-Type"], "application/json");
  } finally {
    restore();
  }
});

test("request throws an actionable error on non-zero code", async () => {
  const restore = mockFetch(async () => ({
    json: async () => ({ code: -1, msg: "bad id", data: null }),
    status: 200,
  }));
  try {
    const client = new SiYuanClient(config);
    await assert.rejects(() => client.request("/api/block/getBlockInfo"), /code=-1.*bad id/);
  } finally {
    restore();
  }
});

test("request throws on network failure with a helpful hint", async () => {
  const restore = mockFetch(async () => {
    throw new Error("ECONNREFUSED");
  });
  try {
    const client = new SiYuanClient(config);
    await assert.rejects(() => client.request("/api/test"), /Failed to reach SiYuan.*running/s);
  } finally {
    restore();
  }
});

test("request throws on non-JSON response", async () => {
  const restore = mockFetch(async () => ({
    json: async () => {
      throw new Error("not json");
    },
    status: 500,
  }));
  try {
    const client = new SiYuanClient(config);
    await assert.rejects(() => client.request("/api/test"), /non-JSON/);
  } finally {
    restore();
  }
});

test("request throws on non-OK HTTP status before parsing JSON", async () => {
  const restore = mockFetch(async () => ({
    ok: false,
    status: 403,
    statusText: "Forbidden",
    json: async () => ({ code: 0, msg: "", data: null }),
  }));
  try {
    const client = new SiYuanClient(config);
    await assert.rejects(() => client.request("/api/test"), /HTTP error.*403.*Forbidden/);
  } finally {
    restore();
  }
});

test("flushTransaction never throws even when the endpoint fails", async () => {
  const restore = mockFetch(async () => ({
    json: async () => ({ code: -1, msg: "fail", data: null }),
    status: 200,
  }));
  try {
    const client = new SiYuanClient(config);
    await assert.doesNotReject(() => client.flushTransaction());
  } finally {
    restore();
  }
});
