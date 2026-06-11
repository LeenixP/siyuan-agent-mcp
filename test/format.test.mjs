// Tests for pure helpers in src/format.ts (run against compiled dist/).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIYUAN_ID_PATTERN,
  escapeSqlString,
  escapeLikePattern,
  truncate,
  truncateWithInfo,
  truncationInfo,
  normalizeMarkdownInput,
  splitMarkdownForBlockUpdate,
  pickBlockFields,
  operationIdsFromTransactions,
  toolResult,
  toolError,
  requireConfirmId,
  requireConfirmText,
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

test("truncateWithInfo returns consistent text and metadata", () => {
  const out = truncateWithInfo("x".repeat(50), 10);
  assert.equal(out.truncation.truncated, true);
  assert.equal(out.truncation.originalLength, 50);
  assert.equal(out.truncation.returnedLength, 10);
  assert.ok(out.text.includes("truncated 40 of 50"));
  assert.deepEqual(truncationInfo("abc", 10), {
    truncated: false,
    originalLength: 3,
    returnedLength: 3,
  });
});

test("normalizeMarkdownInput converts literal escaped newlines only when needed", () => {
  assert.equal(normalizeMarkdownInput("# Title\\n\\nBody"), "# Title\n\nBody");
  assert.equal(normalizeMarkdownInput("# Title\n\\nBody"), "# Title\n\\nBody");
  assert.equal(normalizeMarkdownInput("plain text"), "plain text");
});

test("splitMarkdownForBlockUpdate separates heading and following body", () => {
  assert.deepEqual(splitMarkdownForBlockUpdate("## Updated\n\nBody text"), {
    firstBlock: "## Updated",
    remainingBlocks: "Body text",
  });
});

test("splitMarkdownForBlockUpdate separates multiple paragraph blocks", () => {
  assert.deepEqual(splitMarkdownForBlockUpdate("First\n\nSecond\n\nThird"), {
    firstBlock: "First",
    remainingBlocks: "Second\n\nThird",
  });
});

test("splitMarkdownForBlockUpdate keeps one Markdown list as the first block", () => {
  assert.deepEqual(splitMarkdownForBlockUpdate("- one\n- two\n\nAfter list"), {
    firstBlock: "- one\n- two",
    remainingBlocks: "After list",
  });
});

test("splitMarkdownForBlockUpdate keeps fenced code intact", () => {
  assert.deepEqual(splitMarkdownForBlockUpdate("```ts\nconst x = 1;\n```\n\nAfter"), {
    firstBlock: "```ts\nconst x = 1;\n```",
    remainingBlocks: "After",
  });
});

test("splitMarkdownForBlockUpdate does not split a soft-wrapped paragraph", () => {
  assert.deepEqual(splitMarkdownForBlockUpdate("First line\nSecond line"), {
    firstBlock: "First line\nSecond line",
    remainingBlocks: null,
  });
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

test("toolResult can include resource links", () => {
  const r = toolResult(
    { a: 1 },
    "summary",
    [{ type: "resource_link", uri: "siyuan://block/20210817205410-2kvfpfn", name: "block" }]
  );
  assert.equal(r.content[0].text, "summary");
  assert.equal(r.content[1].type, "resource_link");
});

test("toolError flags isError", () => {
  const r = toolError("boom");
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, "boom");
});

test("operationIdsFromTransactions extracts unique IDs in order", () => {
  const ids = operationIdsFromTransactions([
    { doOperations: [{ id: "20210817205410-2kvfpfn" }, { id: "20231224160424-2f5680o" }] },
    { doOperations: [{ id: "20210817205410-2kvfpfn" }, { data: "ignored" }] },
  ]);
  assert.deepEqual(ids, ["20210817205410-2kvfpfn", "20231224160424-2f5680o"]);
});

test("requireConfirmId rejects missing or mismatched confirmations", () => {
  assert.doesNotThrow(() =>
    requireConfirmId("20210817205410-2kvfpfn", "20210817205410-2kvfpfn")
  );
  assert.throws(() => requireConfirmId("20210817205410-2kvfpfn"), /confirmId/);
  assert.throws(
    () => requireConfirmId("20210817205410-2kvfpfn", "20231224160424-2f5680o"),
    /confirmId/
  );
});

test("requireConfirmText rejects missing or mismatched confirmations", () => {
  assert.doesNotThrow(() => requireConfirmText("remove notebook abc", "remove notebook abc"));
  assert.throws(() => requireConfirmText("remove notebook abc"), /confirmText/);
  assert.throws(() => requireConfirmText("remove notebook abc", "remove notebook def"), /confirmText/);
});

test("sanitizeUrl masks embedded credentials", () => {
  assert.equal(
    sanitizeUrl("http://user:secret@127.0.0.1:6806"),
    "http://***:***@127.0.0.1:6806"
  );
  assert.equal(sanitizeUrl("http://127.0.0.1:6806"), "http://127.0.0.1:6806");
});
