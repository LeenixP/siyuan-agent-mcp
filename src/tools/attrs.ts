// Attribute tools: read and write block attributes (custom attrs, bookmarks, names, memos).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import { SIYUAN_ID_PATTERN, toolError, toolResult } from "../format.js";

const idSchema = z
  .string()
  .regex(SIYUAN_ID_PATTERN, "Invalid ID format (expected YYYYMMDDHHmmss-xxxxxxx)");

export function registerAttrTools(server: McpServer, client: SiYuanClient): void {
  server.registerTool(
    "get_block_attrs",
    {
      title: "Get block attributes",
      description:
        "Get all attributes of a block: built-in fields (name, alias, memo, bookmark) and any custom-* attributes.",
      inputSchema: {
        blockId: idSchema.describe("Block ID"),
      },
      outputSchema: {
        blockId: z.string(),
        attrs: z.record(z.any()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ blockId }) => {
      try {
        const attrs = await client.request<Record<string, unknown>>("/api/attr/getBlockAttrs", {
          id: blockId,
        });
        return toolResult({ blockId, attrs: attrs ?? {} });
      } catch (err) {
        return toolError(`get_block_attrs failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "set_block_attrs",
    {
      title: "Set block attributes",
      description:
        "Set attributes on a block. Use built-in keys like 'name', 'alias', 'memo', or 'bookmark', " +
        "and custom attributes which MUST be prefixed with 'custom-' (e.g. 'custom-status'). " +
        "Provided keys are merged into existing attributes.",
      inputSchema: {
        blockId: idSchema.describe("Block ID"),
        attrs: z
          .record(z.string())
          .describe(
            "Map of attribute name to value. Custom attributes must start with 'custom-'."
          ),
      },
      outputSchema: { blockId: z.string(), setKeys: z.array(z.string()) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ blockId, attrs }) => {
      try {
        const keys = Object.keys(attrs);
        if (keys.length === 0) {
          throw new Error("Provide at least one attribute to set.");
        }
        const invalid = keys.filter(
          (k) =>
            k.startsWith("custom-") === false &&
            !["name", "alias", "memo", "bookmark"].includes(k)
        );
        if (invalid.length > 0) {
          throw new Error(
            `Invalid attribute key(s): ${invalid.join(", ")}. Custom attributes must be prefixed with 'custom-'.`
          );
        }
        await client.request("/api/attr/setBlockAttrs", { id: blockId, attrs });
        await client.flushTransaction();
        return toolResult({ blockId, setKeys: keys });
      } catch (err) {
        return toolError(`set_block_attrs failed: ${String(err)}`);
      }
    }
  );
}
