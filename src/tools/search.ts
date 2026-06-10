// Search tools: full-text search (semantic) and a read-only SQL escape hatch.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import type { FullTextSearchResult } from "../types.js";
import { pickBlockFields, toolError, toolResult } from "../format.js";

// SiYuan search method codes (kernel/api/search.go parseSearchBlockArgs).
const METHOD_CODE: Record<string, number> = {
  keyword: 0,
  querySyntax: 1,
  regex: 3,
};

// orderBy codes; 7 = by relevance descending (best default for agents).
const ORDER_CODE: Record<string, number> = {
  relevance: 7,
  createdAsc: 1,
  createdDesc: 2,
  updatedAsc: 3,
  updatedDesc: 4,
};

// Block type filter keys accepted by fullTextSearchBlock (kernel/model/search.go).
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

// Read-only SQL guardrail: must start with SELECT, no write keywords, no multi-statements.
const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i;

export function assertReadOnlySql(stmt: string): void {
  const trimmed = stmt.trim().replace(/;+\s*$/, "");
  if (!/^select\b/i.test(trimmed)) {
    throw new Error("Only SELECT queries are allowed. The statement must begin with SELECT.");
  }
  if (trimmed.includes(";")) {
    throw new Error("Multiple statements are not allowed; provide a single SELECT query.");
  }
  if (WRITE_KEYWORDS.test(trimmed)) {
    throw new Error(
      "Write/DDL keywords are not allowed in sql_query. Use the dedicated editing tools to modify notes."
    );
  }
}

export function registerSearchTools(server: McpServer, client: SiYuanClient): void {
  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Full-text search across SiYuan notes using the kernel search engine. " +
        "Supports keyword, query-syntax, and regex matching, block-type filtering, " +
        "scope restriction by path, and pagination. Results are ranked by relevance by default. " +
        "This is the primary way to find content; use the returned block IDs with read_doc or get_block.",
      inputSchema: {
        query: z.string().min(1).max(500).describe("Search query text"),
        method: z
          .enum(["keyword", "querySyntax", "regex"])
          .default("keyword")
          .optional()
          .describe(
            "Match method. 'keyword' (default) = plain terms; 'querySyntax' = SiYuan query syntax; 'regex' = regular expression."
          ),
        types: z
          .array(z.enum(SEARCH_TYPES))
          .optional()
          .describe(
            "Restrict to these block types. Omit to search common content types (documents, headings, paragraphs, lists, code, tables, etc.)."
          ),
        paths: z
          .array(z.string())
          .optional()
          .describe(
            "Restrict search to these hpath prefixes (each begins with a notebook ID segment), e.g. '<notebookId>/Projects'."
          ),
        orderBy: z
          .enum(["relevance", "createdAsc", "createdDesc", "updatedAsc", "updatedDesc"])
          .default("relevance")
          .optional()
          .describe("Result ordering. Default: relevance (descending)."),
        page: z.number().int().min(1).default(1).optional().describe("1-based page number"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(20)
          .optional()
          .describe("Results per page (1-200, default 20)"),
      },
      outputSchema: {
        count: z.number(),
        matchedBlockCount: z.number(),
        matchedRootCount: z.number(),
        pageCount: z.number(),
        blocks: z.array(z.any()),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, method = "keyword", types, paths, orderBy = "relevance", page = 1, pageSize = 20 }) => {
      try {
        const typeMap = types
          ? Object.fromEntries(types.map((t) => [t, true]))
          : DEFAULT_TYPES;
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
        return toolResult({
          count: blocks.length,
          matchedBlockCount: data.matchedBlockCount ?? 0,
          matchedRootCount: data.matchedRootCount ?? 0,
          pageCount: data.pageCount ?? 0,
          blocks,
        });
      } catch (err) {
        return toolError(`search_notes failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "sql_query",
    {
      title: "Run a read-only SQL query",
      description:
        "Escape hatch: run a read-only SELECT query against SiYuan's SQLite index for advanced lookups " +
        "the dedicated tools don't cover (aggregations, joins, custom filters). " +
        "Key tables: 'blocks' (id, type, subtype, content, markdown, box, hpath, parent_id, root_id, created, updated, tag, name, alias, memo), " +
        "'attributes' (block_id, name, value), 'refs' (def_block_id, block_id), 'spans', 'assets'. " +
        "ONLY SELECT is permitted — to modify notes use the editing tools.",
      inputSchema: {
        stmt: z
          .string()
          .min(1)
          .max(5000)
          .describe("A single read-only SELECT statement. Always add a LIMIT to bound results."),
      },
      outputSchema: {
        count: z.number(),
        rows: z.array(z.any()),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ stmt }) => {
      try {
        assertReadOnlySql(stmt);
        const rows = await client.request<unknown[]>("/api/query/sql", { stmt });
        const list = rows ?? [];
        return toolResult({ count: list.length, rows: list });
      } catch (err) {
        return toolError(`sql_query failed: ${String(err)}`);
      }
    }
  );
}
