// Navigation tools: list notebooks and list documents in a notebook.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import type { SiYuanBlock, SiYuanNotebook } from "../types.js";
import {
  RESULT_COLUMNS,
  SIYUAN_ID_PATTERN,
  escapeSqlString,
  pickBlockFields,
  toolError,
  toolResult,
} from "../format.js";

export function registerNavigateTools(server: McpServer, client: SiYuanClient): void {
  server.registerTool(
    "list_notebooks",
    {
      title: "List notebooks",
      description:
        "List all notebooks with their IDs, names, icons, and open/closed state. " +
        "Start here to discover notebook IDs needed by other tools.",
      inputSchema: {},
      outputSchema: {
        count: z.number(),
        notebooks: z.array(z.any()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const data = await client.request<{ notebooks: SiYuanNotebook[] }>(
          "/api/notebook/lsNotebooks"
        );
        const notebooks = data.notebooks ?? [];
        return toolResult({ count: notebooks.length, notebooks });
      } catch (err) {
        return toolError(`list_notebooks failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "list_docs",
    {
      title: "List documents",
      description:
        "List documents as a tree ordered by human-readable path. " +
        "Pass a notebookId to list one notebook's documents, or omit it to list documents across all notebooks. " +
        "Only documents in open notebooks are indexed and returned.",
      inputSchema: {
        notebookId: z
          .string()
          .regex(SIYUAN_ID_PATTERN, "Invalid notebook ID format")
          .optional()
          .describe("Notebook ID to scope the listing; omit to list across all notebooks"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(200)
          .optional()
          .describe("Max documents per notebook (default 200)"),
      },
      outputSchema: {
        notebooks: z.array(z.any()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ notebookId, limit = 200 }) => {
      try {
        const queryDocs = async (box: string) => {
          const sql = `SELECT ${RESULT_COLUMNS} FROM blocks WHERE type = 'd' AND box = '${escapeSqlString(
            box
          )}' ORDER BY hpath LIMIT ${limit}`;
          const rows = await client.request<SiYuanBlock[]>("/api/query/sql", { stmt: sql });
          return (rows ?? []).map(pickBlockFields);
        };

        if (notebookId) {
          const docs = await queryDocs(notebookId);
          return toolResult({
            notebooks: [{ notebookId, count: docs.length, docs }],
          });
        }

        const nb = await client.request<{ notebooks: SiYuanNotebook[] }>(
          "/api/notebook/lsNotebooks"
        );
        const notebooks = nb.notebooks ?? [];
        const result = await Promise.all(
          notebooks.map(async (n) => {
            try {
              const docs = await queryDocs(n.id);
              return { notebook: n, count: docs.length, docs };
            } catch (err) {
              return { notebook: n, count: 0, docs: [], error: String(err) };
            }
          })
        );
        return toolResult({ notebooks: result });
      } catch (err) {
        return toolError(`list_docs failed: ${String(err)}`);
      }
    }
  );
}
