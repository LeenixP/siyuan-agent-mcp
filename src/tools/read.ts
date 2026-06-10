// Read tools: full document content, single block detail, outline, backlinks, children.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import type { ChildBlock, OutlineItem } from "../types.js";
import { SIYUAN_ID_PATTERN, toolError, toolResult, truncate } from "../format.js";

const idSchema = z
  .string()
  .regex(SIYUAN_ID_PATTERN, "Invalid ID format (expected YYYYMMDDHHmmss-xxxxxxx)");

export function registerReadTools(server: McpServer, client: SiYuanClient): void {
  // -- read_doc: the core "read a whole note" capability ----------------------
  server.registerTool(
    "read_doc",
    {
      title: "Read full document content",
      description:
        "Read the complete Markdown content of a document by its ID. " +
        "This is the main way to read a note end-to-end. Returns the human-readable path and the full GFM Markdown body. " +
        "Very large documents are truncated to protect context; use get_block or sql_query to read specific parts if needed.",
      inputSchema: {
        docId: idSchema.describe("Document (root) block ID to read"),
      },
      outputSchema: {
        docId: z.string(),
        hPath: z.string(),
        content: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ docId }) => {
      try {
        const data = await client.request<{ hPath: string; content: string }>(
          "/api/export/exportMdContent",
          { id: docId }
        );
        return toolResult({
          docId,
          hPath: data.hPath ?? "",
          content: truncate(data.content ?? ""),
        });
      } catch (err) {
        return toolError(`read_doc failed: ${String(err)}`);
      }
    }
  );

  // -- get_block: single block detail (kramdown + attrs + info) ---------------
  server.registerTool(
    "get_block",
    {
      title: "Get block detail",
      description:
        "Get full detail of a single block by ID: its kramdown source, attributes, and metadata " +
        "(block type and the document it belongs to). Use this to inspect or before updating a specific block.",
      inputSchema: {
        blockId: idSchema.describe("ID of the block to retrieve"),
      },
      outputSchema: {
        id: z.string(),
        kramdown: z.string(),
        attrs: z.record(z.any()),
        info: z.record(z.any()).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ blockId }) => {
      try {
        const [kramdown, attrs, info] = await Promise.all([
          client
            .request<{ kramdown: string }>("/api/block/getBlockKramdown", { id: blockId })
            .then((d) => d?.kramdown ?? "")
            .catch(() => ""),
          client
            .request<Record<string, unknown>>("/api/attr/getBlockAttrs", { id: blockId })
            .catch(() => ({})),
          client
            .request<Record<string, unknown>>("/api/block/getBlockInfo", { id: blockId })
            .catch(() => undefined),
        ]);
        return toolResult({
          id: blockId,
          kramdown: truncate(kramdown),
          attrs: attrs as Record<string, unknown>,
          info: info as Record<string, unknown> | undefined,
        });
      } catch (err) {
        return toolError(`get_block failed: ${String(err)}`);
      }
    }
  );

  // -- get_doc_outline: heading hierarchy -------------------------------------
  server.registerTool(
    "get_doc_outline",
    {
      title: "Get document outline",
      description:
        "Get the heading hierarchy (outline) of a document. Use this to understand a document's structure " +
        "and locate the right section before reading or editing, without loading the whole body.",
      inputSchema: {
        docId: idSchema.describe("Document (root) block ID"),
      },
      outputSchema: {
        docId: z.string(),
        outline: z.array(z.any()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ docId }) => {
      try {
        const outline = await client.request<OutlineItem[]>("/api/outline/getDocOutline", {
          id: docId,
        });
        return toolResult({ docId, outline: outline ?? [] });
      } catch (err) {
        return toolError(`get_doc_outline failed: ${String(err)}`);
      }
    }
  );

  // -- get_backlinks: SiYuan's signature bidirectional links ------------------
  server.registerTool(
    "get_backlinks",
    {
      title: "Get backlinks and mentions",
      description:
        "Get the backlinks (blocks that reference this block/document) and unlinked mentions for a block. " +
        "This surfaces SiYuan's bidirectional links — useful for understanding how a note connects to the rest of the knowledge base.",
      inputSchema: {
        id: idSchema.describe("Block or document ID to find backlinks for"),
        keyword: z.string().optional().describe("Optional keyword to filter backlinks"),
        mentionKeyword: z.string().optional().describe("Optional keyword to filter unlinked mentions"),
      },
      outputSchema: {
        id: z.string(),
        backlinks: z.array(z.any()),
        backmentions: z.array(z.any()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, keyword, mentionKeyword }) => {
      try {
        const data = await client.request<{
          backlinks?: unknown[];
          backmentions?: unknown[];
        }>("/api/ref/getBacklink2", {
          id,
          k: keyword ?? "",
          mk: mentionKeyword ?? "",
          sort: "3",
          mSort: "3",
        });
        return toolResult({
          id,
          backlinks: data.backlinks ?? [],
          backmentions: data.backmentions ?? [],
        });
      } catch (err) {
        return toolError(`get_backlinks failed: ${String(err)}`);
      }
    }
  );

  // -- get_child_blocks: direct children of a block ---------------------------
  server.registerTool(
    "get_child_blocks",
    {
      title: "Get child blocks",
      description:
        "List the direct child blocks of a block (blocks under a heading also count as its children). " +
        "Returns each child's ID, type, and subtype — useful for walking a document's block tree.",
      inputSchema: {
        blockId: idSchema.describe("Parent block ID"),
      },
      outputSchema: {
        blockId: z.string(),
        count: z.number(),
        children: z.array(z.any()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ blockId }) => {
      try {
        const children = await client.request<ChildBlock[]>("/api/block/getChildBlocks", {
          id: blockId,
        });
        const list = children ?? [];
        return toolResult({ blockId, count: list.length, children: list });
      } catch (err) {
        return toolError(`get_child_blocks failed: ${String(err)}`);
      }
    }
  );
}
