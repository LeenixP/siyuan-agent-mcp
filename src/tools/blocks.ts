// Block editing tools: insert, prepend, append, update, delete, move blocks.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import { SIYUAN_ID_PATTERN, MAX_CONTENT_LENGTH, toolError, toolResult } from "../format.js";

const idSchema = z
  .string()
  .regex(SIYUAN_ID_PATTERN, "Invalid ID format (expected YYYYMMDDHHmmss-xxxxxxx)");

const markdownSchema = z
  .string()
  .min(1)
  .max(MAX_CONTENT_LENGTH)
  .describe("Raw GFM Markdown content (e.g. '## Heading', '- item', '| a | b |').");

/** Extract the new block ID from an insert/append/prepend transaction response. */
function extractNewId(data: Array<{ doOperations?: Array<{ id?: string }> }>): string {
  const ops = data?.[0]?.doOperations;
  return ops?.find((op) => op.id)?.id ?? "unknown";
}

export function registerBlockTools(server: McpServer, client: SiYuanClient): void {
  server.registerTool(
    "insert_block",
    {
      title: "Insert block",
      description:
        "Insert a new block at a precise position, written in raw Markdown. " +
        "Anchor the position with exactly one of nextID / previousID / parentID " +
        "(priority when several are given: nextID > previousID > parentID). " +
        "Use previousID to insert after a block, nextID to insert before a block, parentID to insert as the first child. " +
        "Provide content as real Markdown — headings, lists, tables, code fences, math, etc.",
      inputSchema: {
        markdown: markdownSchema,
        previousID: idSchema.optional().describe("Insert immediately AFTER this block"),
        nextID: idSchema.optional().describe("Insert immediately BEFORE this block"),
        parentID: idSchema.optional().describe("Insert as the first child of this block"),
      },
      outputSchema: { insertedBlockId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ markdown, previousID, nextID, parentID }) => {
      try {
        if (!previousID && !nextID && !parentID) {
          throw new Error("Provide at least one of nextID, previousID, or parentID to anchor the insertion.");
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
        return toolError(`insert_block failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "append_block",
    {
      title: "Append block",
      description:
        "Append a new Markdown block as the LAST child of a parent block (commonly a document). " +
        "The simplest way to add content to the end of a note.",
      inputSchema: {
        parentID: idSchema.describe("Parent block ID (e.g. a document ID)"),
        markdown: markdownSchema,
      },
      outputSchema: { insertedBlockId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
        return toolError(`append_block failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "prepend_block",
    {
      title: "Prepend block",
      description:
        "Prepend a new Markdown block as the FIRST child of a parent block (commonly a document).",
      inputSchema: {
        parentID: idSchema.describe("Parent block ID (e.g. a document ID)"),
        markdown: markdownSchema,
      },
      outputSchema: { insertedBlockId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
        return toolError(`prepend_block failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "update_block",
    {
      title: "Update block",
      description:
        "Replace the content of an existing block with new Markdown. " +
        "Inspect the block first with get_block if you need its current content.",
      inputSchema: {
        blockId: idSchema.describe("ID of the block to update"),
        markdown: markdownSchema,
      },
      outputSchema: { updated: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
        return toolError(`update_block failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "delete_block",
    {
      title: "Delete block",
      description:
        "Delete a block by its ID. WARNING: this also deletes the block's children and cannot be undone. " +
        "To delete an entire document, use remove_doc instead.",
      inputSchema: {
        blockId: idSchema.describe("ID of the block to delete"),
      },
      outputSchema: { deleted: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ blockId }) => {
      try {
        await client.request("/api/block/deleteBlock", { id: blockId });
        await client.flushTransaction();
        return toolResult({ deleted: blockId });
      } catch (err) {
        return toolError(`delete_block failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "move_block",
    {
      title: "Move block",
      description:
        "Move a block to a new position. Anchor with previousID (move after that block) and/or parentID (move under that parent). " +
        "previousID and parentID cannot both be empty; if both are given, previousID takes priority.",
      inputSchema: {
        blockId: idSchema.describe("ID of the block to move"),
        previousID: idSchema.optional().describe("Move immediately AFTER this block"),
        parentID: idSchema.optional().describe("Move under this parent block"),
      },
      outputSchema: { moved: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
        return toolError(`move_block failed: ${String(err)}`);
      }
    }
  );
}
