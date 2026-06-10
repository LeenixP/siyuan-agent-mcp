// Tests for the read-only SQL guardrail in src/tools/search.ts (run against dist/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReadOnlySql } from "../dist/tools/search.js";

test("assertReadOnlySql allows SELECT queries", () => {
  assert.doesNotThrow(() =>
    assertReadOnlySql("SELECT id, content FROM blocks WHERE type='d' LIMIT 10")
  );
  // leading whitespace and trailing semicolon are tolerated
  assert.doesNotThrow(() => assertReadOnlySql("  select * from blocks limit 1 ;"));
  assert.doesNotThrow(() =>
    assertReadOnlySql("SELECT id FROM blocks WHERE content = 'delete from blocks' LIMIT 5")
  );
});

test("assertReadOnlySql rejects non-SELECT first keyword", () => {
  assert.throws(() => assertReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x"), /must begin with SELECT/i);
  assert.throws(() => assertReadOnlySql("PRAGMA table_info(blocks)"), /SELECT/i);
});

test("assertReadOnlySql requires bounded numeric LIMIT", () => {
  assert.throws(() => assertReadOnlySql("SELECT * FROM blocks"), /LIMIT/i);
  assert.throws(() => assertReadOnlySql("SELECT * FROM blocks LIMIT 5001"), /too large/i);
});

test("assertReadOnlySql rejects write/DDL keywords", () => {
  assert.throws(() => assertReadOnlySql("DELETE FROM blocks"), /SELECT|not allowed/i);
  assert.throws(() => assertReadOnlySql("UPDATE blocks SET content='x'"), /SELECT|not allowed/i);
  assert.throws(() => assertReadOnlySql("INSERT INTO blocks VALUES (1)"), /SELECT|not allowed/i);
  assert.throws(() => assertReadOnlySql("DROP TABLE blocks"), /SELECT|not allowed/i);
});

test("assertReadOnlySql rejects a write hidden after SELECT prefix", () => {
  assert.throws(
    () => assertReadOnlySql("SELECT 1; DELETE FROM blocks"),
    /Multiple statements|not allowed/i
  );
});

test("assertReadOnlySql rejects DELETE even with odd casing/spacing", () => {
  assert.throws(() => assertReadOnlySql("SeLeCt * from blocks where 1=1; drop table blocks"), /Multiple statements|not allowed/i);
});
