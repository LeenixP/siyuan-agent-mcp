// Document management tools: create, rename, move, and remove documents.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import { MAX_CONTENT_LENGTH, requireConfirmId, toolError, toolResult } from "../format.js";
import { idSchema, notebookIdSchema } from "../schemas.js";
import {
  WRITE_DESTRUCTIVE,
  WRITE_IDEMPOTENT,
  WRITE_SAFE,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

export function registerDocTools(
  server: McpServer,
  client: SiYuanClient,
  options: ToolRegistrationOptions
): void {
  const CreateDocInputSchema = z
    .object({
      notebookId: notebookIdSchema.describe("Target notebook ID."),
      title: z.string().min(1).max(200).describe("Document title."),
      parentDocId: idSchema.optional().describe("Optional parent document ID."),
      markdown: z
        .string()
        .max(MAX_CONTENT_LENGTH)
        .default("")
        .describe("Optional initial GFM Markdown body."),
      tags: z.string().max(500).optional(),
      withMath: z.boolean().optional(),
      clippingHref: z.string().url().optional(),
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_create_doc",
      legacyName: "create_doc",
      title: "Create SiYuan document",
      description:
        "Create a document in a notebook, optionally nested under a parent document. Repeated calls with the same path do not overwrite existing documents.",
      inputSchema: CreateDocInputSchema,
      outputSchema: z
        .object({
          createdDocId: z.string(),
          notebookId: z.string(),
          title: z.string(),
          path: z.string(),
          parentDocId: z.string().nullable(),
        })
        .strict(),
      annotations: WRITE_SAFE,
    },
    async ({ notebookId, title, parentDocId, markdown, tags, withMath, clippingHref }) => {
      try {
        const safeTitle = title.replace(/[\r\n\t/\\#]/g, "-").trim();
        if (!safeTitle) {
          throw new Error("Title becomes empty after removing invalid path characters.");
        }
        let path = `/${safeTitle}`;
        if (parentDocId) {
          const parentHpath = (
            await client.request<string>("/api/filetree/getHPathByID", { id: parentDocId })
          )?.trim();
          if (!parentHpath || !parentHpath.startsWith("/")) {
            throw new Error(
              `Could not resolve human-readable path for parent document ${parentDocId}.`
            );
          }
          path = `${parentHpath}/${safeTitle}`;
        }
        const createdDocId = await client.request<string>("/api/filetree/createDocWithMd", {
          notebook: notebookId,
          path,
          markdown,
          ...(tags ? { tags } : {}),
          ...(withMath !== undefined ? { withMath } : {}),
          ...(clippingHref ? { clippingHref } : {}),
        });
        await client.flushTransaction();
        return toolResult({
          createdDocId,
          notebookId,
          title,
          path,
          parentDocId: parentDocId ?? null,
        });
      } catch (err) {
        return toolError(`siyuan_create_doc failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_rename_doc",
      legacyName: "rename_doc",
      title: "Rename SiYuan document",
      description: "Rename a document by ID without moving it.",
      inputSchema: z
        .object({
          docId: idSchema,
          title: z.string().min(1).max(200),
        })
        .strict(),
      outputSchema: z.object({ renamed: z.string(), title: z.string() }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ docId, title }) => {
      try {
        await client.request("/api/filetree/renameDocByID", { id: docId, title });
        await client.flushTransaction();
        return toolResult({ renamed: docId, title });
      } catch (err) {
        return toolError(`siyuan_rename_doc failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_move_docs",
      legacyName: "move_docs",
      title: "Move SiYuan documents",
      description:
        "Move one or more documents under a target parent document or notebook root.",
      inputSchema: z
        .object({
          docIds: z.array(idSchema).min(1).max(100),
          targetId: idSchema.describe("Parent document ID or notebook ID."),
        })
        .strict(),
      outputSchema: z.object({ moved: z.array(z.string()), targetId: z.string() }).strict(),
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ docIds, targetId }) => {
      try {
        await client.request("/api/filetree/moveDocsByID", { fromIDs: docIds, toID: targetId });
        await client.flushTransaction();
        return toolResult({ moved: docIds, targetId });
      } catch (err) {
        return toolError(`siyuan_move_docs failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_remove_doc",
      legacyName: "remove_doc",
      title: "Remove SiYuan document",
      description:
        "Delete a document and all child documents/blocks. Requires confirmId equal to docId.",
      inputSchema: z
        .object({
          docId: idSchema,
          confirmId: idSchema.describe("Must exactly equal docId."),
        })
        .strict(),
      outputSchema: z.object({ removed: z.string() }).strict(),
      annotations: WRITE_DESTRUCTIVE,
    },
    async ({ docId, confirmId }) => {
      try {
        requireConfirmId(docId, confirmId);
        await client.request("/api/filetree/removeDocByID", { id: docId });
        await client.flushTransaction();
        return toolResult({ removed: docId });
      } catch (err) {
        return toolError(`siyuan_remove_doc failed: ${String(err)}`);
      }
    }
  );
}
