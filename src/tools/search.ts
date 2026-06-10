// Search tools: native full-text search, typed block queries, and bounded read-only SQL.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import type { FullTextSearchResult, SiYuanBlock } from "../types.js";
import {
  RESULT_COLUMNS,
  escapeLikePattern,
  escapeSqlString,
  pickBlockFields,
  summaryList,
  toolError,
  toolResult,
} from "../format.js";
import {
  BlockSummarySchema,
  limitSchema,
  notebookIdSchema,
  offsetSchema,
  pageSchema,
  pageSizeSchema,
} from "../schemas.js";
import {
  READ_ONLY_EXTERNAL,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

const METHOD_CODE: Record<string, number> = {
  keyword: 0,
  querySyntax: 1,
  regex: 3,
};

const ORDER_CODE: Record<string, number> = {
  relevance: 7,
  createdAsc: 1,
  createdDesc: 2,
  updatedAsc: 3,
  updatedDesc: 4,
};

const BLOCK_ORDER_SQL: Record<string, string> = {
  hpathAsc: "hpath ASC",
  createdAsc: "created ASC",
  createdDesc: "created DESC",
  updatedAsc: "updated ASC",
  updatedDesc: "updated DESC",
};

const SEARCH_TYPES = [
  "document",
  "heading",
  "paragraph",
  "list",
  "listItem",
  "codeBlock",
  "mathBlock",
  "table",
  "blockquote",
  "superBlock",
  "htmlBlock",
] as const;

const SQL_BLOCK_TYPES = [
  "d",
  "h",
  "p",
  "l",
  "i",
  "c",
  "m",
  "t",
  "b",
  "s",
  "html",
] as const;

const DEFAULT_TYPES: Record<string, boolean> = {
  document: true,
  heading: true,
  paragraph: true,
  list: true,
  listItem: true,
  codeBlock: true,
  mathBlock: true,
  table: true,
  blockquote: true,
};

const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i;

function stripSqlLiteralsAndComments(stmt: string): string {
  return stmt
    .replace(/'([^']|'')*'/g, "''")
    .replace(/"([^"]|"")*"/g, '""')
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractLimit(stmt: string): number | null {
  const match = stmt.match(/\blimit\s+(?:(\d+)\s*,\s*)?(\d+)\b/i);
  if (!match) return null;
  return Number.parseInt(match[2] ?? match[1], 10);
}

export function assertReadOnlySql(stmt: string, maxRows = 1000): void {
  const trimmed = stmt.trim().replace(/;+\s*$/, "");
  const sanitized = stripSqlLiteralsAndComments(trimmed);
  if (!/^select\b/i.test(sanitized.trim())) {
    throw new Error("Only SELECT queries are allowed. The statement must begin with SELECT.");
  }
  if (sanitized.includes(";")) {
    throw new Error("Multiple statements are not allowed; provide a single SELECT query.");
  }
  if (WRITE_KEYWORDS.test(sanitized)) {
    throw new Error(
      "Write/DDL keywords are not allowed in siyuan_sql_query. Use dedicated editing tools to modify notes."
    );
  }
  const limit = extractLimit(sanitized);
  if (limit === null) {
    throw new Error(`A numeric LIMIT is required and must be <= ${maxRows}.`);
  }
  if (limit > maxRows) {
    throw new Error(`LIMIT ${limit} is too large; use LIMIT ${maxRows} or lower.`);
  }
}

export function registerSearchTools(
  server: McpServer,
  client: SiYuanClient,
  options: ToolRegistrationOptions
): void {
  const SearchNotesInputSchema = z
    .object({
      query: z.string().min(1).max(500).describe("Search query text."),
      method: z.enum(["keyword", "querySyntax", "regex"]).default("keyword"),
      types: z.array(z.enum(SEARCH_TYPES)).optional(),
      paths: z.array(z.string().min(1).max(500)).max(100).optional(),
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
      name: "siyuan_search_notes",
      legacyName: "search_notes",
      title: "Search SiYuan notes",
      description:
        "Full-text search across SiYuan notes using the kernel search engine. Use returned block IDs with siyuan_read_doc or siyuan_get_block.",
      inputSchema: SearchNotesInputSchema,
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
          docMode: z.boolean(),
          blocks: z.array(BlockSummarySchema),
        })
        .strict(),
      annotations: READ_ONLY_EXTERNAL,
    },
    async ({ query, method, types, paths, orderBy, page, pageSize }) => {
      try {
        const typeMap = types ? Object.fromEntries(types.map((t) => [t, true])) : DEFAULT_TYPES;
        const data = await client.request<FullTextSearchResult>(
          "/api/search/fullTextSearchBlock",
          {
            query,
            method: METHOD_CODE[method],
            types: typeMap,
            paths: paths ?? [],
            orderBy: ORDER_CODE[orderBy],
            groupBy: 0,
            page,
            pageSize,
          }
        );
        const blocks = (data.blocks ?? []).map(pickBlockFields);
        const pageCount = data.pageCount ?? 0;
        const hasMore = page < pageCount;
        return toolResult(
          {
            count: blocks.length,
            matchedBlockCount: data.matchedBlockCount ?? 0,
            matchedRootCount: data.matchedRootCount ?? 0,
            pageCount,
            page,
            pageSize,
            hasMore,
            nextPage: hasMore ? page + 1 : null,
            docMode: data.docMode ?? false,
            blocks,
          },
          summaryList(
            `SiYuan search: ${query}`,
            blocks.map((b) => `- ${b.content || "(empty)"} (${b.id}, ${b.type})`)
          ),
          blocks.slice(0, 20).map((b) => ({
            type: "resource_link" as const,
            uri: `siyuan://block/${b.id}`,
            name: b.content || b.id,
            description: `SiYuan block ${b.id} (${b.type})`,
            mimeType: "text/plain",
          }))
        );
      } catch (err) {
        return toolError(`siyuan_search_notes failed: ${String(err)}`);
      }
    }
  );

  const QueryBlocksInputSchema = z
    .object({
      type: z.enum(SQL_BLOCK_TYPES).optional().describe("SiYuan SQL block type, e.g. d, h, p."),
      subType: z.string().max(50).optional(),
      notebookId: notebookIdSchema.optional(),
      rootId: z.string().optional(),
      parentId: z.string().optional(),
      content: z.string().min(1).max(500).optional().describe("Case-sensitive LIKE match."),
      hpathPrefix: z.string().min(1).max(500).optional(),
      updatedAfter: z.string().regex(/^\d{14}$/).optional(),
      updatedBefore: z.string().regex(/^\d{14}$/).optional(),
      orderBy: z
        .enum(["hpathAsc", "createdAsc", "createdDesc", "updatedAsc", "updatedDesc"])
        .default("updatedDesc"),
      limit: limitSchema.default(50),
      offset: offsetSchema,
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_query_blocks",
      title: "Query SiYuan blocks",
      description:
        "Typed, bounded query over SiYuan's blocks index. Prefer this over raw SQL for common filters.",
      inputSchema: QueryBlocksInputSchema,
      outputSchema: z
        .object({
          count: z.number(),
          limit: z.number(),
          offset: z.number(),
          hasMore: z.boolean(),
          nextOffset: z.number().nullable(),
          blocks: z.array(BlockSummarySchema),
        })
        .strict(),
      annotations: READ_ONLY_EXTERNAL,
    },
    async ({
      type,
      subType,
      notebookId,
      rootId,
      parentId,
      content,
      hpathPrefix,
      updatedAfter,
      updatedBefore,
      orderBy,
      limit,
      offset,
    }) => {
      try {
        const where = ["1 = 1"];
        if (type) where.push(`type = '${escapeSqlString(type)}'`);
        if (subType) where.push(`subType = '${escapeSqlString(subType)}'`);
        if (notebookId) where.push(`box = '${escapeSqlString(notebookId)}'`);
        if (rootId) where.push(`root_id = '${escapeSqlString(rootId)}'`);
        if (parentId) where.push(`parent_id = '${escapeSqlString(parentId)}'`);
        if (content) {
          where.push(`content LIKE '%${escapeLikePattern(escapeSqlString(content))}%' ESCAPE '\\'`);
        }
        if (hpathPrefix) {
          where.push(`hpath LIKE '${escapeLikePattern(escapeSqlString(hpathPrefix))}%' ESCAPE '\\'`);
        }
        if (updatedAfter) where.push(`updated >= '${updatedAfter}'`);
        if (updatedBefore) where.push(`updated <= '${updatedBefore}'`);
        const stmt = `SELECT ${RESULT_COLUMNS} FROM blocks WHERE ${where.join(
          " AND "
        )} ORDER BY ${BLOCK_ORDER_SQL[orderBy]} LIMIT ${limit + 1} OFFSET ${offset}`;
        const rows = await client.request<SiYuanBlock[]>("/api/query/sql", { stmt });
        const list = (rows ?? []).map(pickBlockFields);
        const blocks = list.slice(0, limit);
        const hasMore = list.length > limit;
        return toolResult(
          {
            count: blocks.length,
            limit,
            offset,
            hasMore,
            nextOffset: hasMore ? offset + blocks.length : null,
            blocks,
          },
          undefined,
          blocks.slice(0, 20).map((b) => ({
            type: "resource_link" as const,
            uri: b.type === "d" ? `siyuan://doc/${b.id}` : `siyuan://block/${b.id}`,
            name: b.content || b.id,
            description: `SiYuan ${b.type === "d" ? "document" : "block"} ${b.id}`,
            mimeType: b.type === "d" ? "text/markdown" : "text/plain",
          }))
        );
      } catch (err) {
        return toolError(`siyuan_query_blocks failed: ${String(err)}`);
      }
    }
  );

  if (options.enableSql) {
    const SqlQueryInputSchema = z
      .object({
        stmt: z
          .string()
          .min(1)
          .max(5000)
          .describe("A single read-only SELECT statement with numeric LIMIT <= 1000."),
      })
      .strict();

    registerSiyuanTool(
      server,
      options,
      {
        name: "siyuan_sql_query",
        legacyName: "sql_query",
        title: "Run bounded read-only SiYuan SQL",
        description:
          "Advanced escape hatch for read-only SELECT queries against SiYuan's SQLite index. Requires a numeric LIMIT <= 1000.",
        inputSchema: SqlQueryInputSchema,
        outputSchema: z
          .object({
            count: z.number(),
            maxRows: z.number(),
            rows: z.array(z.unknown()),
          })
          .strict(),
        annotations: READ_ONLY_EXTERNAL,
      },
      async ({ stmt }) => {
        try {
          const maxRows = 1000;
          assertReadOnlySql(stmt, maxRows);
          const rows = await client.request<unknown[]>("/api/query/sql", { stmt });
          const list = rows ?? [];
          return toolResult({ count: list.length, maxRows, rows: list });
        } catch (err) {
          return toolError(`siyuan_sql_query failed: ${String(err)}`);
        }
      }
    );
  }
}
