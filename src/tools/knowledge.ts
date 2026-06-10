// Knowledge discovery tools: tags, bookmarks, assets, and reference health.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import { toolError, toolResult } from "../format.js";
import { EmptyInputSchema, UnknownArraySchema, idSchema, pageSchema, pageSizeSchema } from "../schemas.js";
import {
  READ_ONLY,
  READ_ONLY_EXTERNAL,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

const ASSET_METHOD_CODE: Record<string, number> = {
  keyword: 0,
  querySyntax: 1,
  regex: 3,
};

const ASSET_ORDER_CODE: Record<string, number> = {
  relevance: 7,
  createdAsc: 1,
  createdDesc: 2,
  updatedAsc: 3,
  updatedDesc: 4,
};

export function registerKnowledgeTools(
  server: McpServer,
  client: SiYuanClient,
  options: ToolRegistrationOptions
): void {
  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_list_tags",
      title: "List SiYuan tags",
      description: "List tags built by SiYuan, including counts/blocks where returned by the kernel.",
      inputSchema: z.object({ ignoreMaxListHint: z.boolean().default(true) }).strict(),
      outputSchema: z.object({ tags: z.unknown() }).strict(),
      annotations: READ_ONLY,
    },
    async ({ ignoreMaxListHint }) => {
      try {
        const tags = await client.request<unknown>("/api/tag/getTag", { ignoreMaxListHint });
        return toolResult({ tags });
      } catch (err) {
        return toolError(`siyuan_list_tags failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_search_tags",
      title: "Search SiYuan tags",
      description: "Search tag labels by keyword.",
      inputSchema: z.object({ query: z.string().min(1).max(200) }).strict(),
      outputSchema: z.object({ query: z.string(), tags: z.array(z.string()) }).strict(),
      annotations: READ_ONLY,
    },
    async ({ query }) => {
      try {
        const data = await client.request<{ tags?: string[] }>("/api/search/searchTag", { k: query });
        return toolResult({ query, tags: data.tags ?? [] });
      } catch (err) {
        return toolError(`siyuan_search_tags failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_list_bookmarks",
      title: "List SiYuan bookmarks",
      description: "List bookmark groups and referenced blocks.",
      inputSchema: EmptyInputSchema,
      outputSchema: z.object({ bookmarks: z.unknown() }).strict(),
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const bookmarks = await client.request<unknown>("/api/bookmark/getBookmark");
        return toolResult({ bookmarks });
      } catch (err) {
        return toolError(`siyuan_list_bookmarks failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_search_assets",
      title: "Search SiYuan assets",
      description: "Search workspace assets by filename and optional extensions.",
      inputSchema: z
        .object({
          query: z.string().min(1).max(200),
          exts: z.array(z.string().min(1).max(20)).max(50).default([]),
        })
        .strict(),
      outputSchema: z.object({ query: z.string(), assets: z.unknown() }).strict(),
      annotations: READ_ONLY_EXTERNAL,
    },
    async ({ query, exts }) => {
      try {
        const assets = await client.request<unknown>("/api/search/searchAsset", {
          k: query,
          exts,
        });
        return toolResult({ query, assets });
      } catch (err) {
        return toolError(`siyuan_search_assets failed: ${String(err)}`);
      }
    }
  );

  const SearchAssetContentInputSchema = z
    .object({
      query: z.string().min(1).max(500),
      method: z.enum(["keyword", "querySyntax", "regex"]).default("keyword"),
      orderBy: z
        .enum(["relevance", "createdAsc", "createdDesc", "updatedAsc", "updatedDesc"])
        .default("relevance"),
      page: pageSchema,
      pageSize: pageSizeSchema,
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_search_asset_content",
      title: "Search SiYuan asset content",
      description: "Full-text search indexed asset content such as OCR/PDF text.",
      inputSchema: SearchAssetContentInputSchema,
      outputSchema: z
        .object({
          count: z.number(),
          matchedAssetCount: z.number(),
          pageCount: z.number(),
          page: z.number(),
          pageSize: z.number(),
          hasMore: z.boolean(),
          nextPage: z.number().nullable(),
          assetContents: UnknownArraySchema,
        })
        .strict(),
      annotations: READ_ONLY_EXTERNAL,
    },
    async ({ query, method, orderBy, page, pageSize }) => {
      try {
        const data = await client.request<{
          assetContents?: unknown[];
          matchedAssetCount?: number;
          pageCount?: number;
        }>("/api/search/fullTextSearchAssetContent", {
          query,
          method: ASSET_METHOD_CODE[method],
          orderBy: ASSET_ORDER_CODE[orderBy],
          page,
          pageSize,
        });
        const pageCount = data.pageCount ?? 0;
        const hasMore = page < pageCount;
        return toolResult({
          count: data.assetContents?.length ?? 0,
          matchedAssetCount: data.matchedAssetCount ?? 0,
          pageCount,
          page,
          pageSize,
          hasMore,
          nextPage: hasMore ? page + 1 : null,
          assetContents: data.assetContents ?? [],
        });
      } catch (err) {
        return toolError(`siyuan_search_asset_content failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_get_asset_content",
      title: "Get SiYuan asset content",
      description: "Get indexed text content for one asset search result.",
      inputSchema: z
        .object({
          assetId: idSchema,
          query: z.string().max(500).default(""),
          queryMethod: z.number().int().min(0).max(3).default(0),
        })
        .strict(),
      outputSchema: z.object({ assetId: z.string(), assetContent: z.unknown() }).strict(),
      annotations: READ_ONLY_EXTERNAL,
    },
    async ({ assetId, query, queryMethod }) => {
      try {
        const data = await client.request<{ assetContent?: unknown }>("/api/search/getAssetContent", {
          id: assetId,
          query,
          queryMethod,
        });
        return toolResult({ assetId, assetContent: data.assetContent ?? null });
      } catch (err) {
        return toolError(`siyuan_get_asset_content failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_list_invalid_refs",
      title: "List invalid SiYuan block references",
      description: "Find broken block references in the workspace.",
      inputSchema: z.object({ page: pageSchema, pageSize: pageSizeSchema }).strict(),
      outputSchema: z
        .object({
          count: z.number(),
          matchedBlockCount: z.number(),
          matchedRootCount: z.number(),
          pageCount: z.number(),
          page: z.number(),
          pageSize: z.number(),
          hasMore: z.boolean(),
          nextPage: z.number().nullable(),
          blocks: UnknownArraySchema,
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ page, pageSize }) => {
      try {
        const data = await client.request<{
          blocks?: unknown[];
          matchedBlockCount?: number;
          matchedRootCount?: number;
          pageCount?: number;
        }>("/api/search/listInvalidBlockRefs", { page, pageSize });
        const pageCount = data.pageCount ?? 0;
        const hasMore = page < pageCount;
        return toolResult({
          count: data.blocks?.length ?? 0,
          matchedBlockCount: data.matchedBlockCount ?? 0,
          matchedRootCount: data.matchedRootCount ?? 0,
          pageCount,
          page,
          pageSize,
          hasMore,
          nextPage: hasMore ? page + 1 : null,
          blocks: data.blocks ?? [],
        });
      } catch (err) {
        return toolError(`siyuan_list_invalid_refs failed: ${String(err)}`);
      }
    }
  );
}
