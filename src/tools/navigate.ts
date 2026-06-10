// Navigation tools: notebook discovery and document-tree traversal.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import type { SiYuanBlock, SiYuanNotebook } from "../types.js";
import {
  RESULT_COLUMNS,
  escapeSqlString,
  pickBlockFields,
  summaryList,
  toolError,
  toolResult,
} from "../format.js";
import {
  BlockSummarySchema,
  EmptyInputSchema,
  NotebookSchema,
  UnknownArraySchema,
  limitSchema,
  notebookIdSchema,
  offsetSchema,
} from "../schemas.js";
import {
  READ_ONLY,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

interface DocTreeNode {
  id: string;
  children?: DocTreeNode[];
}

function flattenDocTree(nodes: DocTreeNode[] = []): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...flattenDocTree(node.children ?? []));
  }
  return ids;
}

async function queryDocsViaSql(client: SiYuanClient, box: string, limit: number, offset: number) {
  const sql = `SELECT ${RESULT_COLUMNS} FROM blocks WHERE type = 'd' AND box = '${escapeSqlString(
    box
  )}' ORDER BY hpath LIMIT ${limit + 1} OFFSET ${offset}`;
  const rows = await client.request<SiYuanBlock[]>("/api/query/sql", { stmt: sql });
  const list = (rows ?? []).map(pickBlockFields);
  return {
    docs: list.slice(0, limit),
    hasMore: list.length > limit,
    source: "sql_fallback" as const,
  };
}

async function listNotebookDocs(
  client: SiYuanClient,
  notebook: SiYuanNotebook,
  limit: number,
  offset: number
) {
  try {
    const treeData = await client.request<{ tree?: DocTreeNode[] }>("/api/filetree/listDocTree", {
      notebook: notebook.id,
      path: "/",
    });
    const ids = flattenDocTree(treeData.tree ?? []);
    const pageIds = ids.slice(offset, offset + limit);
    const info = pageIds.length
      ? await client.request<unknown[]>("/api/block/getDocsInfo", {
          ids: pageIds,
          refCount: false,
          av: false,
        })
      : [];
    return {
      notebook,
      count: pageIds.length,
      total: ids.length,
      offset,
      limit,
      hasMore: offset + pageIds.length < ids.length,
      nextOffset: offset + pageIds.length < ids.length ? offset + pageIds.length : null,
      docIds: pageIds,
      docs: info ?? [],
      source: "filetree" as const,
    };
  } catch (err) {
    const fallback = await queryDocsViaSql(client, notebook.id, limit, offset);
    return {
      notebook,
      count: fallback.docs.length,
      offset,
      limit,
      hasMore: fallback.hasMore,
      nextOffset: fallback.hasMore ? offset + fallback.docs.length : null,
      docs: fallback.docs,
      source: fallback.source,
      warning: `filetree listing failed, used SQL fallback: ${String(err)}`,
    };
  }
}

export function registerNavigateTools(
  server: McpServer,
  client: SiYuanClient,
  options: ToolRegistrationOptions
): void {
  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_list_notebooks",
      legacyName: "list_notebooks",
      title: "List SiYuan notebooks",
      description:
        "List all SiYuan notebooks with IDs, names, icons, sort order, and open/closed state. Start here to discover notebook IDs.",
      inputSchema: EmptyInputSchema,
      outputSchema: z
        .object({
          count: z.number(),
          notebooks: z.array(NotebookSchema),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const data = await client.request<{ notebooks: SiYuanNotebook[] }>(
          "/api/notebook/lsNotebooks"
        );
        const notebooks = data.notebooks ?? [];
        return toolResult(
          { count: notebooks.length, notebooks },
          summaryList(
            "SiYuan notebooks",
            notebooks.map((n) => `- ${n.name} (${n.id})${n.closed ? " - closed" : ""}`)
          )
        );
      } catch (err) {
        return toolError(`siyuan_list_notebooks failed: ${String(err)}`);
      }
    }
  );

  const ListDocsInputSchema = z
    .object({
      notebookId: notebookIdSchema
        .optional()
        .describe("Notebook ID to scope the listing; omit to list across all open notebooks."),
      limit: limitSchema.default(100).describe("Max documents per notebook page."),
      offset: offsetSchema.describe("Number of documents to skip in each notebook."),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_list_docs",
      legacyName: "list_docs",
      title: "List SiYuan documents",
      description:
        "List documents by notebook using SiYuan's file tree API first, with SQL fallback. Returns doc IDs plus document info and pagination metadata.",
      inputSchema: ListDocsInputSchema,
      outputSchema: z
        .object({
          notebooks: z.array(
            z
              .object({
                notebook: NotebookSchema.optional(),
                notebookId: z.string().optional(),
                count: z.number(),
                total: z.number().optional(),
                offset: z.number().optional(),
                limit: z.number().optional(),
                hasMore: z.boolean(),
                nextOffset: z.number().nullable().optional(),
                docIds: z.array(z.string()).optional(),
                docs: z.array(z.union([BlockSummarySchema, z.unknown()])),
                source: z.string().optional(),
                warning: z.string().optional(),
              })
              .passthrough()
          ),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ notebookId, limit = 100, offset = 0 }) => {
      try {
        const nb = await client.request<{ notebooks: SiYuanNotebook[] }>(
          "/api/notebook/lsNotebooks"
        );
        const notebooks = (nb.notebooks ?? []).filter((n) =>
          notebookId ? n.id === notebookId : !n.closed
        );
        if (notebookId && notebooks.length === 0) {
          return toolResult({
            notebooks: [
              {
                notebookId,
                count: 0,
                docs: [],
                hasMore: false,
                warning: "Notebook not found or not open.",
              },
            ],
          });
        }
        const result = await Promise.all(
          notebooks.map((n) => listNotebookDocs(client, n, limit, offset))
        );
        const docLinks = result
          .flatMap((r) => r.docIds ?? [])
          .slice(0, 20)
          .map((id) => ({
            type: "resource_link" as const,
            uri: `siyuan://doc/${id}`,
            name: id,
            description: `SiYuan document ${id}`,
            mimeType: "text/markdown",
          }));
        return toolResult(
          { notebooks: result },
          summaryList(
            "SiYuan documents",
            result.map(
              (r) =>
                `- ${r.notebook?.name ?? r.notebook?.id ?? "notebook"}: ${r.count}${r.total !== undefined ? ` of ${r.total}` : ""} docs (${r.source})`
            )
          ),
          docLinks
        );
      } catch (err) {
        return toolError(`siyuan_list_docs failed: ${String(err)}`);
      }
    }
  );

  const ListDocsByPathInputSchema = z
    .object({
      notebookId: notebookIdSchema.describe("Notebook ID."),
      path: z
        .string()
        .min(1)
        .default("/")
        .describe("Storage path or '/' for the notebook root."),
      sort: z.number().int().optional().describe("SiYuan filetree sort mode."),
      maxListCount: z.number().int().min(1).max(5000).default(200),
      showHidden: z.boolean().default(false),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_list_docs_by_path",
      title: "List SiYuan documents by path",
      description:
        "List direct child documents/files below a notebook storage path using /api/filetree/listDocsByPath.",
      inputSchema: ListDocsByPathInputSchema,
      outputSchema: z
        .object({
          notebookId: z.string(),
          path: z.string(),
          count: z.number(),
          files: UnknownArraySchema,
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ notebookId, path, sort, maxListCount = 200, showHidden = false }) => {
      try {
        const data = await client.request<{ path?: string; files?: unknown[] }>(
          "/api/filetree/listDocsByPath",
          {
            notebook: notebookId,
            path,
            ...(sort !== undefined ? { sort } : {}),
            maxListCount,
            showHidden,
            ignoreMaxListHint: true,
          }
        );
        const files = data.files ?? [];
        return toolResult({ notebookId, path: data.path ?? path, count: files.length, files });
      } catch (err) {
        return toolError(`siyuan_list_docs_by_path failed: ${String(err)}`);
      }
    }
  );
}
