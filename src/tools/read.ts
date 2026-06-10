// Read tools: documents, blocks, backlinks, navigation context, and statistics.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import type { ChildBlock, OutlineItem } from "../types.js";
import {
  toolError,
  toolResult,
  truncateWithInfo,
} from "../format.js";
import {
  ChildBlockSchema,
  EmptyInputSchema,
  TruncationSchema,
  UnknownArraySchema,
  UnknownRecordSchema,
  idSchema,
  limitSchema,
} from "../schemas.js";
import {
  READ_ONLY,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

function warningFrom(label: string, result: PromiseSettledResult<unknown>): string | null {
  if (result.status === "fulfilled") return null;
  return `${label}: ${String(result.reason)}`;
}

export function registerReadTools(
  server: McpServer,
  client: SiYuanClient,
  options: ToolRegistrationOptions
): void {
  const ReadDocInputSchema = z
    .object({
      docId: idSchema.describe("Document/root block ID to read."),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_read_doc",
      legacyName: "read_doc",
      title: "Read SiYuan document",
      description:
        "Read the complete Markdown content of a document by ID. Large documents are truncated with metadata.",
      inputSchema: ReadDocInputSchema,
      outputSchema: z
        .object({
          docId: z.string(),
          hPath: z.string(),
          content: z.string(),
          truncation: TruncationSchema,
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ docId }) => {
      try {
        const data = await client.request<{ hPath?: string; content?: string }>(
          "/api/export/exportMdContent",
          { id: docId }
        );
        const content = data.content ?? "";
        const truncated = truncateWithInfo(content);
        const structured = {
          docId,
          hPath: data.hPath ?? "",
          content: truncated.text,
          truncation: truncated.truncation,
        };
        return toolResult(
          structured,
          [
            "# SiYuan document",
            "",
            `- ID: ${docId}`,
            `- Path: ${structured.hPath}`,
            `- Characters: ${structured.truncation.returnedLength}/${structured.truncation.originalLength}`,
            "",
            "## Markdown",
            "",
            structured.content,
          ].join("\n")
        );
      } catch (err) {
        return toolError(`siyuan_read_doc failed: ${String(err)}`);
      }
    }
  );

  const GetBlockInputSchema = z
    .object({
      blockId: idSchema.describe("Block ID to retrieve."),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_block",
      legacyName: "get_block",
      title: "Get SiYuan block detail",
      description:
        "Get a block's kramdown, attributes, and document metadata. Partial API failures are returned as warnings.",
      inputSchema: GetBlockInputSchema,
      outputSchema: z
        .object({
          id: z.string(),
          kramdown: z.string(),
          truncation: TruncationSchema,
          attrs: UnknownRecordSchema,
          info: UnknownRecordSchema.nullable(),
          warnings: z.array(z.string()),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ blockId }) => {
      try {
        const results = await Promise.allSettled([
          client.request<{ kramdown?: string }>("/api/block/getBlockKramdown", { id: blockId }),
          client.request<Record<string, unknown>>("/api/attr/getBlockAttrs", { id: blockId }),
          client.request<Record<string, unknown>>("/api/block/getBlockInfo", { id: blockId }),
        ]);

        const [kramdownResult, attrsResult, infoResult] = results;
        const warnings = [
          warningFrom("getBlockKramdown", kramdownResult),
          warningFrom("getBlockAttrs", attrsResult),
          warningFrom("getBlockInfo", infoResult),
        ].filter((value): value is string => value !== null);

        const kramdown =
          kramdownResult.status === "fulfilled" ? kramdownResult.value.kramdown ?? "" : "";
        const truncated = truncateWithInfo(kramdown);
        const attrs = attrsResult.status === "fulfilled" ? attrsResult.value ?? {} : {};
        const info = infoResult.status === "fulfilled" ? infoResult.value ?? null : null;
        return toolResult({
          id: blockId,
          kramdown: truncated.text,
          truncation: truncated.truncation,
          attrs,
          info,
          warnings,
        });
      } catch (err) {
        return toolError(`siyuan_get_block failed: ${String(err)}`);
      }
    }
  );

  const BatchGetBlocksInputSchema = z
    .object({
      blockIds: z.array(idSchema).min(1).max(50),
      mode: z.enum(["md", "textmark"]).default("md"),
      includeAttrs: z.boolean().default(false),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_batch_get_blocks",
      title: "Batch get SiYuan blocks",
      description:
        "Read kramdown for up to 50 blocks in one call, optionally including attributes.",
      inputSchema: BatchGetBlocksInputSchema,
      outputSchema: z
        .object({
          count: z.number(),
          blocks: z.array(
            z
              .object({
                id: z.string(),
                kramdown: z.string(),
                truncated: z.boolean(),
                attrs: UnknownRecordSchema.optional(),
              })
              .strict()
          ),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ blockIds, mode, includeAttrs }) => {
      try {
        const [kramdowns, attrs] = await Promise.all([
          client.request<Record<string, string>>("/api/block/getBlockKramdowns", {
            ids: blockIds,
            mode,
          }),
          includeAttrs
            ? client.request<Record<string, Record<string, unknown>>>(
                "/api/attr/batchGetBlockAttrs",
                { ids: blockIds }
              )
            : Promise.resolve({} as Record<string, Record<string, unknown>>),
        ]);
        const blocks = blockIds.map((id) => {
          const kramdown = kramdowns[id] ?? "";
          const truncated = truncateWithInfo(kramdown);
          return {
            id,
            kramdown: truncated.text,
            truncated: truncated.truncation.truncated,
            ...(includeAttrs ? { attrs: attrs[id] ?? {} } : {}),
          };
        });
        return toolResult({ count: blocks.length, blocks });
      } catch (err) {
        return toolError(`siyuan_batch_get_blocks failed: ${String(err)}`);
      }
    }
  );

  const DocIdInputSchema = z.object({ docId: idSchema }).strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_doc_outline",
      legacyName: "get_doc_outline",
      title: "Get SiYuan document outline",
      description:
        "Get the heading hierarchy of a document without loading the whole body.",
      inputSchema: DocIdInputSchema,
      outputSchema: z.object({ docId: z.string(), outline: UnknownArraySchema }).strict(),
      annotations: READ_ONLY,
    },
    async ({ docId }) => {
      try {
        const outline = await client.request<OutlineItem[]>("/api/outline/getDocOutline", {
          id: docId,
        });
        return toolResult({ docId, outline: outline ?? [] });
      } catch (err) {
        return toolError(`siyuan_get_doc_outline failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_tail_child_blocks",
      title: "Get SiYuan tail child blocks",
      description: "List the last N direct child blocks of a block/document.",
      inputSchema: z
        .object({
          blockId: idSchema,
          count: z.number().int().min(1).max(100).default(7),
        })
        .strict(),
      outputSchema: z
        .object({
          blockId: z.string(),
          count: z.number(),
          children: z.array(ChildBlockSchema),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ blockId, count }) => {
      try {
        const children = await client.request<ChildBlock[]>("/api/block/getTailChildBlocks", {
          id: blockId,
          n: count,
        });
        const list = children ?? [];
        return toolResult({ blockId, count: list.length, children: list });
      } catch (err) {
        return toolError(`siyuan_get_tail_child_blocks failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_block_index",
      title: "Get SiYuan block index",
      description: "Return a block's sibling index as reported by SiYuan.",
      inputSchema: z.object({ blockId: idSchema }).strict(),
      outputSchema: z.object({ blockId: z.string(), index: z.unknown() }).strict(),
      annotations: READ_ONLY,
    },
    async ({ blockId }) => {
      try {
        const index = await client.request<unknown>("/api/block/getBlockIndex", { id: blockId });
        return toolResult({ blockId, index });
      } catch (err) {
        return toolError(`siyuan_get_block_index failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_ref_ids",
      title: "Get SiYuan reference IDs",
      description: "Get block reference definitions and original reference block IDs for a block.",
      inputSchema: z.object({ blockId: idSchema.optional() }).strict(),
      outputSchema: z
        .object({
          blockId: z.string().nullable(),
          refDefs: z.unknown(),
          originalRefBlockIDs: z.unknown(),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ blockId }) => {
      try {
        const data = await client.request<{
          refDefs?: unknown;
          originalRefBlockIDs?: unknown;
        }>("/api/block/getRefIDs", blockId ? { id: blockId } : {});
        return toolResult({
          blockId: blockId ?? null,
          refDefs: data.refDefs ?? [],
          originalRefBlockIDs: data.originalRefBlockIDs ?? {},
        });
      } catch (err) {
        return toolError(`siyuan_get_ref_ids failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_ref_text",
      title: "Get SiYuan reference text",
      description: "Get the display text SiYuan uses for block references to a block.",
      inputSchema: z.object({ blockId: idSchema }).strict(),
      outputSchema: z.object({ blockId: z.string(), refText: z.string() }).strict(),
      annotations: READ_ONLY,
    },
    async ({ blockId }) => {
      try {
        const refText = await client.request<string>("/api/block/getRefText", { id: blockId });
        return toolResult({ blockId, refText: refText ?? "" });
      } catch (err) {
        return toolError(`siyuan_get_ref_text failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_doc_info",
      title: "Get SiYuan document info",
      description:
        "Get document metadata such as notebook, path, title, icon, and reference info where available.",
      inputSchema: z.object({ id: idSchema.describe("Document or block ID.") }).strict(),
      outputSchema: z.object({ id: z.string(), info: UnknownRecordSchema }).strict(),
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      try {
        const info = await client.request<Record<string, unknown>>("/api/block/getDocInfo", { id });
        return toolResult({ id, info: info ?? {} });
      } catch (err) {
        return toolError(`siyuan_get_doc_info failed: ${String(err)}`);
      }
    }
  );

  const BacklinksInputSchema = z
    .object({
      id: idSchema.describe("Block or document ID to find backlinks for."),
      keyword: z.string().max(200).default(""),
      mentionKeyword: z.string().max(200).default(""),
      containChildren: z.boolean().optional(),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_backlinks",
      legacyName: "get_backlinks",
      title: "Get SiYuan backlinks and mentions",
      description:
        "Get backlinks and unlinked mentions for a block/document, including counts returned by SiYuan.",
      inputSchema: BacklinksInputSchema,
      outputSchema: z
        .object({
          id: z.string(),
          box: z.string().optional(),
          linkRefsCount: z.number(),
          mentionsCount: z.number(),
          backlinks: UnknownArraySchema,
          backmentions: UnknownArraySchema,
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ id, keyword, mentionKeyword, containChildren }) => {
      try {
        const data = await client.request<{
          box?: string;
          backlinks?: unknown[];
          backmentions?: unknown[];
          linkRefsCount?: number;
          mentionsCount?: number;
        }>("/api/ref/getBacklink2", {
          id,
          k: keyword,
          mk: mentionKeyword,
          sort: "3",
          mSort: "3",
          ...(containChildren !== undefined ? { containChildren } : {}),
        });
        return toolResult({
          id,
          box: data.box,
          linkRefsCount: data.linkRefsCount ?? 0,
          mentionsCount: data.mentionsCount ?? 0,
          backlinks: data.backlinks ?? [],
          backmentions: data.backmentions ?? [],
        });
      } catch (err) {
        return toolError(`siyuan_get_backlinks failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_child_blocks",
      legacyName: "get_child_blocks",
      title: "Get SiYuan child blocks",
      description:
        "List direct child blocks of a block. Blocks below a heading count as heading children.",
      inputSchema: z.object({ blockId: idSchema }).strict(),
      outputSchema: z
        .object({
          blockId: z.string(),
          count: z.number(),
          children: z.array(ChildBlockSchema),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ blockId }) => {
      try {
        const children = await client.request<ChildBlock[]>("/api/block/getChildBlocks", {
          id: blockId,
        });
        const list = children ?? [];
        return toolResult({ blockId, count: list.length, children: list });
      } catch (err) {
        return toolError(`siyuan_get_child_blocks failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_block_breadcrumb",
      title: "Get SiYuan block breadcrumb",
      description: "Build the notebook/document/block breadcrumb for a block ID.",
      inputSchema: z
        .object({
          blockId: idSchema,
          excludeTypes: z.array(z.string()).default([]),
        })
        .strict(),
      outputSchema: z.object({ blockId: z.string(), breadcrumb: z.unknown() }).strict(),
      annotations: READ_ONLY,
    },
    async ({ blockId, excludeTypes }) => {
      try {
        const breadcrumb = await client.request<unknown>("/api/block/getBlockBreadcrumb", {
          id: blockId,
          excludeTypes,
        });
        return toolResult({ blockId, breadcrumb });
      } catch (err) {
        return toolError(`siyuan_get_block_breadcrumb failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_block_siblings",
      title: "Get SiYuan block siblings",
      description: "Return parent, previous, and next block IDs for a block.",
      inputSchema: z.object({ blockId: idSchema }).strict(),
      outputSchema: z
        .object({
          blockId: z.string(),
          parent: z.string(),
          previous: z.string(),
          next: z.string(),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ blockId }) => {
      try {
        const data = await client.request<{ parent?: string; previous?: string; next?: string }>(
          "/api/block/getBlockSiblingID",
          { id: blockId }
        );
        return toolResult({
          blockId,
          parent: data.parent ?? "",
          previous: data.previous ?? "",
          next: data.next ?? "",
        });
      } catch (err) {
        return toolError(`siyuan_get_block_siblings failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_check_block_exists",
      title: "Check SiYuan block existence",
      description: "Check whether a block ID exists in the current workspace/index.",
      inputSchema: z.object({ blockId: idSchema }).strict(),
      outputSchema: z.object({ blockId: z.string(), exists: z.boolean() }).strict(),
      annotations: READ_ONLY,
    },
    async ({ blockId }) => {
      try {
        const exists = await client.request<boolean>("/api/block/checkBlockExist", { id: blockId });
        return toolResult({ blockId, exists: Boolean(exists) });
      } catch (err) {
        return toolError(`siyuan_check_block_exists failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_recent_updated_blocks",
      title: "Get recently updated SiYuan blocks",
      description: "Return SiYuan's recent updated blocks list, bounded client-side.",
      inputSchema: z.object({ limit: limitSchema.default(50) }).strict(),
      outputSchema: z
        .object({ count: z.number(), limit: z.number(), blocks: UnknownArraySchema })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ limit }) => {
      try {
        const blocks = await client.request<unknown[]>("/api/block/getRecentUpdatedBlocks");
        const list = (blocks ?? []).slice(0, limit);
        return toolResult({ count: list.length, limit, blocks: list });
      } catch (err) {
        return toolError(`siyuan_get_recent_updated_blocks failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_tree_stat",
      title: "Get SiYuan tree statistics",
      description: "Get document/tree statistics for a block or document ID.",
      inputSchema: z.object({ id: idSchema }).strict(),
      outputSchema: z.object({ id: z.string(), stat: z.unknown() }).strict(),
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      try {
        const data = await client.request<{ stat?: unknown }>("/api/block/getTreeStat", { id });
        return toolResult({ id, stat: data.stat ?? null });
      } catch (err) {
        return toolError(`siyuan_get_tree_stat failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_blocks_word_count",
      title: "Get SiYuan blocks word count",
      description: "Get aggregate word-count statistics for one or more block IDs.",
      inputSchema: z.object({ blockIds: z.array(idSchema).min(1).max(100) }).strict(),
      outputSchema: z.object({ count: z.number(), stat: z.unknown() }).strict(),
      annotations: READ_ONLY,
    },
    async ({ blockIds }) => {
      try {
        const data = await client.request<{ stat?: unknown }>("/api/block/getBlocksWordCount", {
          ids: blockIds,
        });
        return toolResult({ count: blockIds.length, stat: data.stat ?? null });
      } catch (err) {
        return toolError(`siyuan_get_blocks_word_count failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_recent_docs",
      title: "Get recent SiYuan documents",
      description: "Get recently opened or updated documents from SiYuan storage.",
      inputSchema: z
        .object({
          sortBy: z.string().max(50).optional(),
          limit: limitSchema.default(50),
        })
        .strict(),
      outputSchema: z
        .object({ count: z.number(), limit: z.number(), docs: UnknownArraySchema })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ sortBy, limit }) => {
      try {
        const docs = await client.request<unknown[]>("/api/storage/getRecentDocs", {
          ...(sortBy ? { sortBy } : {}),
        });
        const list = (docs ?? []).slice(0, limit);
        return toolResult({ count: list.length, limit, docs: list });
      } catch (err) {
        return toolError(`siyuan_get_recent_docs failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_read_workspace_overview",
      title: "Read SiYuan workspace overview",
      description:
        "Quick read-only orientation tool combining recent docs and recently updated blocks.",
      inputSchema: EmptyInputSchema,
      outputSchema: z
        .object({
          recentDocs: UnknownArraySchema,
          recentUpdatedBlocks: UnknownArraySchema,
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const [recentDocs, recentUpdatedBlocks] = await Promise.all([
          client.request<unknown[]>("/api/storage/getRecentDocs", {}),
          client.request<unknown[]>("/api/block/getRecentUpdatedBlocks"),
        ]);
        return toolResult({
          recentDocs: (recentDocs ?? []).slice(0, 20),
          recentUpdatedBlocks: (recentUpdatedBlocks ?? []).slice(0, 20),
        });
      } catch (err) {
        return toolError(`siyuan_read_workspace_overview failed: ${String(err)}`);
      }
    }
  );
}
