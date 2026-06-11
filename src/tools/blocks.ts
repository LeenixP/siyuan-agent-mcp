// Block editing tools: insert, prepend, append, update, delete, and move blocks.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import {
  firstOperationIdFromTransactions,
  normalizeMarkdownInput,
  operationIdsFromTransactions,
  requireConfirmId,
  toolError,
  toolResult,
} from "../format.js";
import { idSchema, markdownSchema } from "../schemas.js";
import {
  WRITE_DESTRUCTIVE,
  WRITE_IDEMPOTENT,
  WRITE_SAFE,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

function countDefined(values: Array<string | undefined>): number {
  return values.filter((value) => value !== undefined && value !== "").length;
}

type BatchInsertBlock = {
  markdown: string;
  previousID?: string;
  nextID?: string;
  parentID?: string;
};

function orderBatchInsertBlocks(blocks: BatchInsertBlock[]): BatchInsertBlock[] {
  if (blocks.length < 2) return blocks;
  const parentOnly = blocks.every((block) => block.parentID && !block.previousID && !block.nextID);
  const sameParent = new Set(blocks.map((block) => block.parentID)).size === 1;
  return parentOnly && sameParent ? [...blocks].reverse() : blocks;
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
      outputSchema: z
        .object({ insertedBlockId: z.string(), operationIds: z.array(z.string()) })
        .strict(),
      annotations: WRITE_SAFE,
    },
    async ({ markdown, previousID, nextID, parentID }) => {
      try {
        if (countDefined([previousID, nextID, parentID]) !== 1) {
          throw new Error("Provide exactly one of previousID, nextID, or parentID.");
        }
        const data = await client.request<unknown>("/api/block/insertBlock", {
          dataType: "markdown",
          data: normalizeMarkdownInput(markdown),
          previousID: previousID ?? "",
          nextID: nextID ?? "",
          parentID: parentID ?? "",
        });
        const insertedBlockId = firstOperationIdFromTransactions(data);
        if (!insertedBlockId) {
          throw new Error("SiYuan did not return an inserted block ID.");
        }
        await client.flushTransaction();
        return toolResult({
          insertedBlockId,
          operationIds: operationIdsFromTransactions(data),
        });
      } catch (err) {
        return toolError(`siyuan_insert_block failed: ${String(err)}`);
      }
    }
  );

  const BatchInsertBlockInputSchema = z
    .object({
      blocks: z
        .array(
          z
            .object({
              markdown: markdownSchema,
              previousID: idSchema.optional().describe("Insert immediately after this block."),
              nextID: idSchema.optional().describe("Insert immediately before this block."),
              parentID: idSchema.optional().describe("Insert as first child of this block."),
            })
            .strict()
        )
        .min(1)
        .max(50),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_batch_insert_blocks",
      title: "Batch insert SiYuan blocks",
      description:
        "Insert up to 50 Markdown blocks in one SiYuan transaction batch. Each item must provide exactly one of previousID, nextID, or parentID.",
      inputSchema: BatchInsertBlockInputSchema,
      outputSchema: z
        .object({
          count: z.number(),
          insertedBlockIds: z.array(z.string()),
          operationIds: z.array(z.string()),
          orderAdjusted: z.boolean(),
        })
        .strict(),
      annotations: WRITE_SAFE,
    },
    async ({ blocks }) => {
      try {
        for (const block of blocks) {
          if (countDefined([block.previousID, block.nextID, block.parentID]) !== 1) {
            throw new Error("Each block must provide exactly one of previousID, nextID, or parentID.");
          }
        }
        const orderedBlocks = orderBatchInsertBlocks(blocks);
        const data = await client.request<unknown>("/api/block/batchInsertBlock", {
          blocks: orderedBlocks.map((block) => ({
            dataType: "markdown",
            data: normalizeMarkdownInput(block.markdown),
            previousID: block.previousID ?? "",
            nextID: block.nextID ?? "",
            parentID: block.parentID ?? "",
          })),
        });
        const operationIds = operationIdsFromTransactions(data);
        await client.flushTransaction();
        return toolResult({
          count: blocks.length,
          insertedBlockIds: operationIds,
          operationIds,
          orderAdjusted: orderedBlocks !== blocks,
        });
      } catch (err) {
        return toolError(`siyuan_batch_insert_blocks failed: ${String(err)}`);
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
      outputSchema: z
        .object({ insertedBlockId: z.string(), operationIds: z.array(z.string()) })
        .strict(),
      annotations: WRITE_SAFE,
    },
    async ({ parentID, markdown }) => {
      try {
        const data = await client.request<unknown>("/api/block/appendBlock", {
          dataType: "markdown",
          data: normalizeMarkdownInput(markdown),
          parentID,
        });
        const insertedBlockId = firstOperationIdFromTransactions(data);
        if (!insertedBlockId) {
          throw new Error("SiYuan did not return an inserted block ID.");
        }
        await client.flushTransaction();
        return toolResult({
          insertedBlockId,
          operationIds: operationIdsFromTransactions(data),
        });
      } catch (err) {
        return toolError(`siyuan_append_block failed: ${String(err)}`);
      }
    }
  );

  const BatchUpdateBlockInputSchema = z
    .object({
      blocks: z
        .array(z.object({ blockId: idSchema, markdown: markdownSchema }).strict())
        .min(1)
        .max(50),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_batch_update_blocks",
      title: "Batch update SiYuan blocks",
      description: "Replace up to 50 blocks with Markdown in one SiYuan transaction batch.",
      inputSchema: BatchUpdateBlockInputSchema,
      outputSchema: z
        .object({
          count: z.number(),
          updated: z.array(z.string()),
          operationIds: z.array(z.string()),
        })
        .strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ blocks }) => {
      try {
        const data = await client.request<unknown>("/api/block/batchUpdateBlock", {
          blocks: blocks.map((block) => ({
            id: block.blockId,
            dataType: "markdown",
            data: normalizeMarkdownInput(block.markdown),
          })),
        });
        await client.flushTransaction();
        return toolResult({
          count: blocks.length,
          updated: blocks.map((block) => block.blockId),
          operationIds: operationIdsFromTransactions(data),
        });
      } catch (err) {
        return toolError(`siyuan_batch_update_blocks failed: ${String(err)}`);
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
      outputSchema: z
        .object({ insertedBlockId: z.string(), operationIds: z.array(z.string()) })
        .strict(),
      annotations: WRITE_SAFE,
    },
    async ({ parentID, markdown }) => {
      try {
        const data = await client.request<unknown>("/api/block/prependBlock", {
          dataType: "markdown",
          data: normalizeMarkdownInput(markdown),
          parentID,
        });
        const insertedBlockId = firstOperationIdFromTransactions(data);
        if (!insertedBlockId) {
          throw new Error("SiYuan did not return an inserted block ID.");
        }
        await client.flushTransaction();
        return toolResult({
          insertedBlockId,
          operationIds: operationIdsFromTransactions(data),
        });
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
      outputSchema: z.object({ updated: z.string(), operationIds: z.array(z.string()) }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ blockId, markdown }) => {
      try {
        const data = await client.request<unknown>("/api/block/updateBlock", {
          dataType: "markdown",
          data: normalizeMarkdownInput(markdown),
          id: blockId,
        });
        await client.flushTransaction();
        return toolResult({ updated: blockId, operationIds: operationIdsFromTransactions(data) });
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
      outputSchema: z.object({ deleted: z.string(), operationIds: z.array(z.string()) }).strict(),
      annotations: WRITE_DESTRUCTIVE,
    },
    async ({ blockId, confirmId }) => {
      try {
        requireConfirmId(blockId, confirmId);
        const data = await client.request<unknown>("/api/block/deleteBlock", { id: blockId });
        await client.flushTransaction();
        return toolResult({ deleted: blockId, operationIds: operationIdsFromTransactions(data) });
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
      outputSchema: z.object({ moved: z.string(), operationIds: z.array(z.string()) }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ blockId, previousID, parentID }) => {
      try {
        if (!previousID && !parentID) {
          throw new Error("Provide previousID and/or parentID to anchor the move.");
        }
        const data = await client.request<unknown>("/api/block/moveBlock", {
          id: blockId,
          previousID: previousID ?? "",
          parentID: parentID ?? "",
        });
        await client.flushTransaction();
        return toolResult({ moved: blockId, operationIds: operationIdsFromTransactions(data) });
      } catch (err) {
        return toolError(`siyuan_move_block failed: ${String(err)}`);
      }
    }
  );
}
