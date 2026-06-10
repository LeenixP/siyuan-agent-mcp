// Tests for pure helpers in src/format.ts (run against compiled dist/).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIYUAN_ID_PATTERN,
  escapeSqlString,
  escapeLikePattern,
  truncate,
  pickBlockFields,
  toolResult,
  toolError,
} from "../dist/format.js";
import { sanitizeUrl } from "../dist/config.js";

test("SIYUAN_ID_PATTERN matches valid IDs", () => {
  assert.ok(SIYUAN_ID_PATTERN.test("20210817205410-2kvfpfn"));
  assert.ok(SIYUAN_ID_PATTERN.test("20231224160424-2f5680o"));
});

test("SIYUAN_ID_PATTERN rejects invalid IDs", () => {
  assert.equal(SIYUAN_ID_PATTERN.test("not-an-id"), false);
  assert.equal(SIYUAN_ID_PATTERN.test("2021-2kvfpfn"), false);
  assert.equal(SIYUAN_ID_PATTERN.test("20210817205410-2KVFPFN"), false); // uppercase
  assert.equal(SIYUAN_ID_PATTERN.test("20210817205410-2kvfpf"), false); // too short suffix
});

test("escapeSqlString doubles single quotes", () => {
  assert.equal(escapeSqlString("O'Brien"), "O''Brien");
  assert.equal(escapeSqlString("plain"), "plain");
});

test("escapeLikePattern escapes wildcards", () => {
  assert.equal(escapeLikePattern("50%_off"), "50\\%\\_off");
});

test("truncate leaves short text unchanged", () => {
  assert.equal(truncate("hello", 100), "hello");
});

test("truncate cuts long text and appends a marker", () => {
  const out = truncate("x".repeat(50), 10);
  assert.ok(out.startsWith("x".repeat(10)));
  assert.ok(out.includes("truncated"));
});

test("pickBlockFields keeps the expected fields only", () => {
  const block = {
    id: "20210817205410-2kvfpfn",
    type: "p",
    subType: "",
    content: "hi",
    markdown: "hi",
    box: "box1",
    path: "/p.sy",
    hpath: "/Doc",
    root_id: "root1",
    parent_id: "parent1",
    name: "n",
    created: "20210101000000",
    updated: "20210102000000",
  };
  const picked = pickBlockFields(block);
  assert.deepEqual(Object.keys(picked).sort(), [
    "box",
    "content",
    "created",
    "hpath",
    "id",
    "parent_id",
    "root_id",
    "subType",
    "type",
    "updated",
  ]);
  // internal fields dropped
  assert.equal("markdown" in picked, false);
  assert.equal("path" in picked, false);
});

test("toolResult carries both text content and structuredContent", () => {
  const r = toolResult({ a: 1 });
  assert.equal(r.structuredContent.a, 1);
  assert.equal(r.content[0].type, "text");
  assert.deepEqual(JSON.parse(r.content[0].text), { a: 1 });
});

test("toolError flags isError", () => {
  const r = toolError("boom");
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, "boom");
});

test("sanitizeUrl masks embedded credentials", () => {
  assert.equal(
    sanitizeUrl("http://user:secret@127.0.0.1:6806"),
    "http://***:***@127.0.0.1:6806"
  );
  assert.equal(sanitizeUrl("http://127.0.0.1:6806"), "http://127.0.0.1:6806");
});
