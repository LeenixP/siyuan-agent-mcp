import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerSiyuanTool, READ_ONLY, WRITE_SAFE } from "../dist/tooling.js";

const outputSchema = z.object({ ok: z.boolean() }).strict();
const inputSchema = z.object({}).strict();
const handler = async () => ({
  content: [{ type: "text", text: "{\"ok\":true}" }],
  structuredContent: { ok: true },
});

test("registerSiyuanTool registers canonical names by default", () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerSiyuanTool(
    server,
    { readOnlyMode: false, enableLegacyAliases: false, enableSql: true, enableDangerousTools: false },
    {
      name: "siyuan_read",
      legacyName: "read",
      title: "Read",
      description: "Read",
      inputSchema,
      outputSchema,
      annotations: READ_ONLY,
    },
    handler
  );
  assert.ok(server._registeredTools.siyuan_read);
  assert.equal(server._registeredTools.read, undefined);
});

test("registerSiyuanTool can register legacy aliases", () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerSiyuanTool(
    server,
    { readOnlyMode: false, enableLegacyAliases: true, enableSql: true, enableDangerousTools: false },
    {
      name: "siyuan_read",
      legacyName: "read",
      title: "Read",
      description: "Read",
      inputSchema,
      outputSchema,
      annotations: READ_ONLY,
    },
    handler
  );
  assert.ok(server._registeredTools.siyuan_read);
  assert.ok(server._registeredTools.read);
});

test("registerSiyuanTool omits write tools in read-only mode", () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerSiyuanTool(
    server,
    { readOnlyMode: true, enableLegacyAliases: true, enableSql: true, enableDangerousTools: false },
    {
      name: "siyuan_write",
      legacyName: "write",
      title: "Write",
      description: "Write",
      inputSchema,
      outputSchema,
      annotations: WRITE_SAFE,
    },
    handler
  );
  assert.equal(server._registeredTools.siyuan_write, undefined);
  assert.equal(server._registeredTools.write, undefined);
});

test("registerSiyuanTool omits dangerous tools unless enabled", () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerSiyuanTool(
    server,
    { readOnlyMode: false, enableLegacyAliases: false, enableSql: true, enableDangerousTools: false },
    {
      name: "siyuan_remove_everything",
      title: "Remove",
      description: "Remove",
      inputSchema,
      outputSchema,
      annotations: WRITE_SAFE,
      requiresDangerousTools: true,
    },
    handler
  );
  assert.equal(server._registeredTools.siyuan_remove_everything, undefined);
});

test("registerSiyuanTool registers dangerous tools when enabled", () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerSiyuanTool(
    server,
    { readOnlyMode: false, enableLegacyAliases: false, enableSql: true, enableDangerousTools: true },
    {
      name: "siyuan_remove_everything",
      title: "Remove",
      description: "Remove",
      inputSchema,
      outputSchema,
      annotations: WRITE_SAFE,
      requiresDangerousTools: true,
    },
    handler
  );
  assert.ok(server._registeredTools.siyuan_remove_everything);
});
