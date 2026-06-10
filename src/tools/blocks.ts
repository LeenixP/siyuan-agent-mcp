// Block editing tools: insert, prepend, append, update, delete, and move blocks.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import { requireConfirmId, toolError, toolResult } from "../format.js";
import { idSchema, markdownSchema } from "../schemas.js";
import {
  WRITE_DESTRUCTIVE,
  WRITE_IDEMPOTENT,
  WRITE_SAFE,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

function extractNewId(data: Array<{ doOperations?: Array<{ id?: string }> }>): string {
  const ops = data?.[0]?.doOperations;
  return ops?.find((op) => op.id)?.id ?? "unknown";
}

function countDefined(values: Array<string | undefined>): number {
  return values.filter((value) => value !== undefined && value !== "").length;
}

export function registerBlockTools(
  server: McpServer,
  client: SiYuanClient,
  options: ToolRegistrationOptions
): void {
  const InsertBlockInputSchema = z
    .object({
      markdown: markdownSchema,
      previousID: idSchema.optional().describe("Insert immediately after this block."),
      nextID: idSchema.optional().describe("Insert immediately before this block."),
      parentID: idSchema.optional().describe("Insert as first child of this block."),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_insert_block",
      legacyName: "insert_block",
      title: "Insert SiYuan block",
      description:
        "Insert a Markdown block at a precise position. Provide exactly one of previousID, nextID, or parentID.",
      inputSchema: InsertBlockInputSchema,
      outputSchema: z.object({ insertedBlockId: z.string() }).strict(),
      annotations: WRITE_SAFE,
    },
    async ({ markdown, previousID, nextID, parentID }) => {
      try {
        if (countDefined([previousID, nextID, parentID]) !== 1) {
          throw new Error("Provide exactly one of previousID, nextID, or parentID.");
        }
        const data = await client.request<Array<{ doOperations?: Array<{ id?: string }> }>>(
          "/api/block/insertBlock",
          {
            dataType: "markdown",
            data: markdown,
            previousID: previousID ?? "",
            nextID: nextID ?? "",
            parentID: parentID ?? "",
          }
        );
        await client.flushTransaction();
        return toolResult({ insertedBlockId: extractNewId(data) });
      } catch (err) {
        return toolError(`siyuan_insert_block failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_append_block",
      legacyName: "append_block",
      title: "Append SiYuan block",
      description: "Append a Markdown block as the last child of a parent block/document.",
      inputSchema: z.object({ parentID: idSchema, markdown: markdownSchema }).strict(),
      outputSchema: z.object({ insertedBlockId: z.string() }).strict(),
      annotations: WRITE_SAFE,
    },
    async ({ parentID, markdown }) => {
      try {
        const data = await client.request<Array<{ doOperations?: Array<{ id?: string }> }>>(
          "/api/block/appendBlock",
          { dataType: "markdown", data: markdown, parentID }
        );
        await client.flushTransaction();
        return toolResult({ insertedBlockId: extractNewId(data) });
      } catch (err) {
        return toolError(`siyuan_append_block failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_prepend_block",
      legacyName: "prepend_block",
      title: "Prepend SiYuan block",
      description: "Prepend a Markdown block as the first child of a parent block/document.",
      inputSchema: z.object({ parentID: idSchema, markdown: markdownSchema }).strict(),
      outputSchema: z.object({ insertedBlockId: z.string() }).strict(),
      annotations: WRITE_SAFE,
    },
    async ({ parentID, markdown }) => {
      try {
        const data = await client.request<Array<{ doOperations?: Array<{ id?: string }> }>>(
          "/api/block/prependBlock",
          { dataType: "markdown", data: markdown, parentID }
        );
        await client.flushTransaction();
        return toolResult({ insertedBlockId: extractNewId(data) });
      } catch (err) {
        return toolError(`siyuan_prepend_block failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_update_block",
      legacyName: "update_block",
      title: "Update SiYuan block",
      description: "Replace a block's content with new Markdown.",
      inputSchema: z.object({ blockId: idSchema, markdown: markdownSchema }).strict(),
      outputSchema: z.object({ updated: z.string() }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ blockId, markdown }) => {
      try {
        await client.request("/api/block/updateBlock", {
          dataType: "markdown",
          data: markdown,
          id: blockId,
        });
        await client.flushTransaction();
        return toolResult({ updated: blockId });
      } catch (err) {
        return toolError(`siyuan_update_block failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_delete_block",
      legacyName: "delete_block",
      title: "Delete SiYuan block",
      description:
        "Delete a block and its children. Requires confirmId equal to blockId. Use siyuan_remove_doc for whole documents.",
      inputSchema: z.object({ blockId: idSchema, confirmId: idSchema }).strict(),
      outputSchema: z.object({ deleted: z.string() }).strict(),
      annotations: WRITE_DESTRUCTIVE,
    },
    async ({ blockId, confirmId }) => {
      try {
        requireConfirmId(blockId, confirmId);
        await client.request("/api/block/deleteBlock", { id: blockId });
        await client.flushTransaction();
        return toolResult({ deleted: blockId });
      } catch (err) {
        return toolError(`siyuan_delete_block failed: ${String(err)}`);
      }
    }
  );

  const MoveBlockInputSchema = z
    .object({
      blockId: idSchema,
      previousID: idSchema.optional(),
      parentID: idSchema.optional(),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_move_block",
      legacyName: "move_block",
      title: "Move SiYuan block",
      description:
        "Move a block. Provide previousID to move after a block or parentID to move under a parent.",
      inputSchema: MoveBlockInputSchema,
      outputSchema: z.object({ moved: z.string() }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ blockId, previousID, parentID }) => {
      try {
        if (!previousID && !parentID) {
          throw new Error("Provide previousID and/or parentID to anchor the move.");
        }
        await client.request("/api/block/moveBlock", {
          id: blockId,
          previousID: previousID ?? "",
          parentID: parentID ?? "",
        });
        await client.flushTransaction();
        return toolResult({ moved: blockId });
      } catch (err) {
        return toolError(`siyuan_move_block failed: ${String(err)}`);
      }
    }
  );
}
