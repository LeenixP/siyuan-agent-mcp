// Document management tools: create, rename, move, and remove documents.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import {
  MAX_CONTENT_LENGTH,
  firstOperationIdFromTransactions,
  operationIdsFromTransactions,
  requireConfirmId,
  toolError,
  toolResult,
} from "../format.js";
import { idSchema, markdownSchema, notebookIdSchema } from "../schemas.js";
import {
  READ_ONLY,
  WRITE_DESTRUCTIVE,
  WRITE_IDEMPOTENT,
  WRITE_SAFE,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

function warningFrom(label: string, result: PromiseSettledResult<unknown>): string | null {
  if (result.status === "fulfilled") return null;
  return `${label}: ${String(result.reason)}`;
}

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
      docId: idSchema.optional().describe("Optional explicit ID for a newly created document."),
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
          existed: z.boolean(),
        })
        .strict(),
      annotations: WRITE_SAFE,
    },
    async ({ notebookId, title, parentDocId, docId, markdown, tags, withMath, clippingHref }) => {
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
        const existingIds = await client.request<string[]>("/api/filetree/getIDsByHPath", {
          notebook: notebookId,
          path,
        });
        const createdDocId = await client.request<string>("/api/filetree/createDocWithMd", {
          notebook: notebookId,
          path,
          markdown,
          ...(parentDocId ? { parentID: parentDocId } : {}),
          ...(docId ? { id: docId } : {}),
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
          existed: (existingIds ?? []).includes(createdDocId),
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
      name: "siyuan_get_doc_path",
      title: "Get SiYuan document path",
      description:
        "Resolve a document/block ID to human-readable path, full human-readable path, and storage path metadata.",
      inputSchema: z.object({ id: idSchema.describe("Document or block ID.") }).strict(),
      outputSchema: z
        .object({
          id: z.string(),
          hPath: z.string().nullable(),
          fullHPath: z.string().nullable(),
          storage: z
            .object({ notebook: z.string(), path: z.string() })
            .strict()
            .nullable(),
          warnings: z.array(z.string()),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      try {
        const [hPathResult, fullHPathResult, storageResult] = await Promise.allSettled([
          client.request<string>("/api/filetree/getHPathByID", { id }),
          client.request<string>("/api/filetree/getFullHPathByID", { id }),
          client.request<{ notebook: string; path: string }>("/api/filetree/getPathByID", { id }),
        ]);
        return toolResult({
          id,
          hPath: hPathResult.status === "fulfilled" ? hPathResult.value : null,
          fullHPath: fullHPathResult.status === "fulfilled" ? fullHPathResult.value : null,
          storage: storageResult.status === "fulfilled" ? storageResult.value : null,
          warnings: [
            warningFrom("getHPathByID", hPathResult),
            warningFrom("getFullHPathByID", fullHPathResult),
            warningFrom("getPathByID", storageResult),
          ].filter((value): value is string => value !== null),
        });
      } catch (err) {
        return toolError(`siyuan_get_doc_path failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_resolve_doc_path",
      title: "Resolve SiYuan document path",
      description: "Resolve a notebook human-readable path to matching document IDs.",
      inputSchema: z
        .object({
          notebookId: notebookIdSchema,
          hPath: z.string().min(1).max(1000).describe("Human-readable path such as /foo/bar."),
        })
        .strict(),
      outputSchema: z
        .object({ notebookId: z.string(), hPath: z.string(), count: z.number(), ids: z.array(z.string()) })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ notebookId, hPath }) => {
      try {
        const ids = await client.request<string[]>("/api/filetree/getIDsByHPath", {
          notebook: notebookId,
          path: hPath,
        });
        return toolResult({ notebookId, hPath, count: ids?.length ?? 0, ids: ids ?? [] });
      } catch (err) {
        return toolError(`siyuan_resolve_doc_path failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_create_daily_note",
      title: "Create SiYuan daily note",
      description:
        "Create or open today's daily note in a notebook using SiYuan's configured daily-note path.",
      inputSchema: z.object({ notebookId: notebookIdSchema }).strict(),
      outputSchema: z.object({ docId: z.string(), notebookId: z.string() }).strict(),
      annotations: WRITE_SAFE,
    },
    async ({ notebookId }) => {
      try {
        const data = await client.request<{ id?: string }>("/api/filetree/createDailyNote", {
          notebook: notebookId,
        });
        if (!data.id) {
          throw new Error("SiYuan did not return a daily note document ID.");
        }
        await client.flushTransaction();
        return toolResult({ docId: data.id, notebookId });
      } catch (err) {
        return toolError(`siyuan_create_daily_note failed: ${String(err)}`);
      }
    }
  );

  const DailyNoteBlockInputSchema = z.object({ notebookId: notebookIdSchema, markdown: markdownSchema }).strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_append_daily_note_block",
      title: "Append SiYuan daily note block",
      description: "Create/open today's daily note and append a Markdown block to it.",
      inputSchema: DailyNoteBlockInputSchema,
      outputSchema: z
        .object({
          notebookId: z.string(),
          insertedBlockId: z.string(),
          operationIds: z.array(z.string()),
        })
        .strict(),
      annotations: WRITE_SAFE,
    },
    async ({ notebookId, markdown }) => {
      try {
        const data = await client.request<unknown>("/api/block/appendDailyNoteBlock", {
          notebook: notebookId,
          dataType: "markdown",
          data: markdown,
        });
        const insertedBlockId = firstOperationIdFromTransactions(data);
        if (!insertedBlockId) {
          throw new Error("SiYuan did not return an inserted block ID.");
        }
        await client.flushTransaction();
        return toolResult({
          notebookId,
          insertedBlockId,
          operationIds: operationIdsFromTransactions(data),
        });
      } catch (err) {
        return toolError(`siyuan_append_daily_note_block failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_prepend_daily_note_block",
      title: "Prepend SiYuan daily note block",
      description: "Create/open today's daily note and prepend a Markdown block to it.",
      inputSchema: DailyNoteBlockInputSchema,
      outputSchema: z
        .object({
          notebookId: z.string(),
          insertedBlockId: z.string(),
          operationIds: z.array(z.string()),
        })
        .strict(),
      annotations: WRITE_SAFE,
    },
    async ({ notebookId, markdown }) => {
      try {
        const data = await client.request<unknown>("/api/block/prependDailyNoteBlock", {
          notebook: notebookId,
          dataType: "markdown",
          data: markdown,
        });
        const insertedBlockId = firstOperationIdFromTransactions(data);
        if (!insertedBlockId) {
          throw new Error("SiYuan did not return an inserted block ID.");
        }
        await client.flushTransaction();
        return toolResult({
          notebookId,
          insertedBlockId,
          operationIds: operationIdsFromTransactions(data),
        });
      } catch (err) {
        return toolError(`siyuan_prepend_daily_note_block failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_duplicate_doc",
      title: "Duplicate SiYuan document",
      description: "Duplicate a document by ID and return the document metadata reported by SiYuan.",
      inputSchema: z.object({ docId: idSchema }).strict(),
      outputSchema: z.object({ docId: z.string(), duplicate: z.unknown() }).strict(),
      annotations: WRITE_SAFE,
    },
    async ({ docId }) => {
      try {
        const duplicate = await client.request<unknown>("/api/filetree/duplicateDoc", { id: docId });
        await client.flushTransaction();
        return toolResult({ docId, duplicate });
      } catch (err) {
        return toolError(`siyuan_duplicate_doc failed: ${String(err)}`);
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
