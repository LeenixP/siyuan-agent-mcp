// Notebook management tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import type { SiYuanNotebook } from "../types.js";
import { toolError, toolResult } from "../format.js";
import { notebookIdSchema } from "../schemas.js";
import {
  WRITE_IDEMPOTENT,
  WRITE_SAFE,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

export function registerNotebookTools(
  server: McpServer,
  client: SiYuanClient,
  options: ToolRegistrationOptions
): void {
  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_create_notebook",
      legacyName: "create_notebook",
      title: "Create SiYuan notebook",
      description: "Create a new SiYuan notebook and return its ID.",
      inputSchema: z.object({ name: z.string().min(1).max(200) }).strict(),
      outputSchema: z.object({ notebookId: z.string(), name: z.string() }).strict(),
      annotations: WRITE_SAFE,
    },
    async ({ name }) => {
      try {
        const data = await client.request<{ notebook?: SiYuanNotebook }>(
          "/api/notebook/createNotebook",
          { name }
        );
        return toolResult({ notebookId: data.notebook?.id ?? "unknown", name });
      } catch (err) {
        return toolError(`siyuan_create_notebook failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_rename_notebook",
      legacyName: "rename_notebook",
      title: "Rename SiYuan notebook",
      description: "Rename an existing notebook.",
      inputSchema: z.object({ notebookId: notebookIdSchema, name: z.string().min(1).max(200) }).strict(),
      outputSchema: z.object({ notebookId: z.string(), name: z.string() }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ notebookId, name }) => {
      try {
        await client.request("/api/notebook/renameNotebook", { notebook: notebookId, name });
        return toolResult({ notebookId, name });
      } catch (err) {
        return toolError(`siyuan_rename_notebook failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_open_notebook",
      legacyName: "open_notebook",
      title: "Open SiYuan notebook",
      description: "Open/mount a notebook so its documents become indexed and searchable.",
      inputSchema: z.object({ notebookId: notebookIdSchema }).strict(),
      outputSchema: z.object({ opened: z.string() }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ notebookId }) => {
      try {
        await client.request("/api/notebook/openNotebook", { notebook: notebookId });
        await client.flushTransaction();
        return toolResult({ opened: notebookId });
      } catch (err) {
        return toolError(`siyuan_open_notebook failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_close_notebook",
      legacyName: "close_notebook",
      title: "Close SiYuan notebook",
      description: "Close/unmount a notebook without deleting data.",
      inputSchema: z.object({ notebookId: notebookIdSchema }).strict(),
      outputSchema: z.object({ closed: z.string() }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ notebookId }) => {
      try {
        await client.request("/api/notebook/closeNotebook", { notebook: notebookId });
        return toolResult({ closed: notebookId });
      } catch (err) {
        return toolError(`siyuan_close_notebook failed: ${String(err)}`);
      }
    }
  );
}
