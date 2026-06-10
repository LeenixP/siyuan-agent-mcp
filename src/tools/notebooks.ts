// Notebook management tools: create, rename, open, close notebooks.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import type { SiYuanNotebook } from "../types.js";
import { SIYUAN_ID_PATTERN, toolError, toolResult } from "../format.js";

const idSchema = z
  .string()
  .regex(SIYUAN_ID_PATTERN, "Invalid notebook ID format (expected YYYYMMDDHHmmss-xxxxxxx)");

export function registerNotebookTools(server: McpServer, client: SiYuanClient): void {
  server.registerTool(
    "create_notebook",
    {
      title: "Create notebook",
      description: "Create a new notebook with the given name. Returns the new notebook's ID.",
      inputSchema: {
        name: z.string().min(1).max(200).describe("Name for the new notebook"),
      },
      outputSchema: { notebookId: z.string(), name: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name }) => {
      try {
        const data = await client.request<{ notebook: SiYuanNotebook }>(
          "/api/notebook/createNotebook",
          { name }
        );
        return toolResult({ notebookId: data.notebook?.id ?? "unknown", name });
      } catch (err) {
        return toolError(`create_notebook failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "rename_notebook",
    {
      title: "Rename notebook",
      description: "Rename an existing notebook.",
      inputSchema: {
        notebookId: idSchema.describe("Notebook ID"),
        name: z.string().min(1).max(200).describe("New name"),
      },
      outputSchema: { notebookId: z.string(), name: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ notebookId, name }) => {
      try {
        await client.request("/api/notebook/renameNotebook", { notebook: notebookId, name });
        return toolResult({ notebookId, name });
      } catch (err) {
        return toolError(`rename_notebook failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "open_notebook",
    {
      title: "Open notebook",
      description:
        "Open (mount) a notebook so its documents become indexed and searchable. " +
        "Documents in closed notebooks are not returned by search or list_docs.",
      inputSchema: {
        notebookId: idSchema.describe("Notebook ID to open"),
      },
      outputSchema: { opened: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ notebookId }) => {
      try {
        await client.request("/api/notebook/openNotebook", { notebook: notebookId });
        await client.flushTransaction();
        return toolResult({ opened: notebookId });
      } catch (err) {
        return toolError(`open_notebook failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "close_notebook",
    {
      title: "Close notebook",
      description:
        "Close (unmount) a notebook. Its documents will no longer appear in search or list_docs until reopened. " +
        "This does not delete any data.",
      inputSchema: {
        notebookId: idSchema.describe("Notebook ID to close"),
      },
      outputSchema: { closed: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ notebookId }) => {
      try {
        await client.request("/api/notebook/closeNotebook", { notebook: notebookId });
        return toolResult({ closed: notebookId });
      } catch (err) {
        return toolError(`close_notebook failed: ${String(err)}`);
      }
    }
  );
}
