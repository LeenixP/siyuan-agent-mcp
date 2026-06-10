// Attribute tools: read and write block attributes.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import { toolError, toolResult } from "../format.js";
import { UnknownRecordSchema, idSchema } from "../schemas.js";
import {
  READ_ONLY,
  WRITE_IDEMPOTENT,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

const ATTR_VALUE_SCHEMA = z.union([z.string(), z.null()]);

function validateAttrKeys(attrs: Record<string, string | null>): void {
  const keys = Object.keys(attrs);
  if (keys.length === 0) {
    throw new Error("Provide at least one attribute.");
  }
  const allowed = new Set(["name", "alias", "memo", "bookmark"]);
  const invalid = keys.filter((key) => !key.startsWith("custom-") && !allowed.has(key));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid attribute key(s): ${invalid.join(", ")}. Use name, alias, memo, bookmark, or custom-* keys.`
    );
  }
}

export function registerAttrTools(
  server: McpServer,
  client: SiYuanClient,
  options: ToolRegistrationOptions
): void {
  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_block_attrs",
      legacyName: "get_block_attrs",
      title: "Get SiYuan block attributes",
      description: "Get built-in and custom attributes for a block.",
      inputSchema: z.object({ blockId: idSchema }).strict(),
      outputSchema: z.object({ blockId: z.string(), attrs: UnknownRecordSchema }).strict(),
      annotations: READ_ONLY,
    },
    async ({ blockId }) => {
      try {
        const attrs = await client.request<Record<string, unknown>>("/api/attr/getBlockAttrs", {
          id: blockId,
        });
        return toolResult({ blockId, attrs: attrs ?? {} });
      } catch (err) {
        return toolError(`siyuan_get_block_attrs failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_batch_get_block_attrs",
      title: "Batch get SiYuan block attributes",
      description: "Get attributes for up to 100 blocks in one call.",
      inputSchema: z.object({ blockIds: z.array(idSchema).min(1).max(100) }).strict(),
      outputSchema: z
        .object({ count: z.number(), attrsByBlockId: z.record(UnknownRecordSchema) })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ blockIds }) => {
      try {
        const attrsByBlockId = await client.request<Record<string, Record<string, unknown>>>(
          "/api/attr/batchGetBlockAttrs",
          { ids: blockIds }
        );
        return toolResult({ count: blockIds.length, attrsByBlockId: attrsByBlockId ?? {} });
      } catch (err) {
        return toolError(`siyuan_batch_get_block_attrs failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_set_block_attrs",
      legacyName: "set_block_attrs",
      title: "Set SiYuan block attributes",
      description:
        "Set or remove block attributes. Values must be strings; null removes the attribute. Custom keys must start with custom-.",
      inputSchema: z
        .object({
          blockId: idSchema,
          attrs: z.record(ATTR_VALUE_SCHEMA),
        })
        .strict(),
      outputSchema: z.object({ blockId: z.string(), setKeys: z.array(z.string()) }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ blockId, attrs }) => {
      try {
        validateAttrKeys(attrs);
        await client.request("/api/attr/setBlockAttrs", { id: blockId, attrs });
        await client.flushTransaction();
        return toolResult({ blockId, setKeys: Object.keys(attrs) });
      } catch (err) {
        return toolError(`siyuan_set_block_attrs failed: ${String(err)}`);
      }
    }
  );
}
