// Notebook management tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import type { SiYuanNotebook } from "../types.js";
import { requireConfirmId, requireConfirmText, toolError, toolResult } from "../format.js";
import { notebookIdSchema } from "../schemas.js";
import {
  READ_ONLY,
  WRITE_DESTRUCTIVE,
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
      name: "siyuan_get_notebook_info",
      title: "Get SiYuan notebook info",
      description: "Get detailed metadata for an open notebook.",
      inputSchema: z.object({ notebookId: notebookIdSchema }).strict(),
      outputSchema: z.object({ notebookId: z.string(), boxInfo: z.unknown() }).strict(),
      annotations: READ_ONLY,
    },
    async ({ notebookId }) => {
      try {
        const data = await client.request<{ boxInfo?: unknown }>("/api/notebook/getNotebookInfo", {
          notebook: notebookId,
        });
        return toolResult({ notebookId, boxInfo: data.boxInfo ?? null });
      } catch (err) {
        return toolError(`siyuan_get_notebook_info failed: ${String(err)}`);
      }
    }
  );

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
      name: "siyuan_set_notebook_icon",
      title: "Set SiYuan notebook icon",
      description: "Set a notebook icon string, such as an emoji or SiYuan icon value.",
      inputSchema: z
        .object({
          notebookId: notebookIdSchema,
          icon: z.string().max(100).default(""),
        })
        .strict(),
      outputSchema: z.object({ notebookId: z.string(), icon: z.string() }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ notebookId, icon }) => {
      try {
        await client.request("/api/notebook/setNotebookIcon", { notebook: notebookId, icon });
        return toolResult({ notebookId, icon });
      } catch (err) {
        return toolError(`siyuan_set_notebook_icon failed: ${String(err)}`);
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

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_remove_notebook",
      title: "Remove SiYuan notebook",
      description:
        "Delete a notebook. Requires SIYUAN_ENABLE_DANGEROUS_TOOLS=true, confirmId equal to notebookId, and confirmText equal to 'remove notebook <notebookId>'.",
      inputSchema: z
        .object({
          notebookId: notebookIdSchema,
          confirmId: notebookIdSchema,
          confirmText: z.string(),
        })
        .strict(),
      outputSchema: z.object({ removed: z.string() }).strict(),
      annotations: WRITE_DESTRUCTIVE,
      requiresDangerousTools: true,
    },
    async ({ notebookId, confirmId, confirmText }) => {
      try {
        requireConfirmId(notebookId, confirmId);
        requireConfirmText(`remove notebook ${notebookId}`, confirmText);
        await client.request("/api/notebook/removeNotebook", { notebook: notebookId });
        await client.flushTransaction();
        return toolResult({ removed: notebookId });
      } catch (err) {
        return toolError(`siyuan_remove_notebook failed: ${String(err)}`);
      }
    }
  );
}
