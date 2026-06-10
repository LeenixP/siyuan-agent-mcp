// Document management tools: create, rename, move, remove documents.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import { SIYUAN_ID_PATTERN, MAX_CONTENT_LENGTH, toolError, toolResult } from "../format.js";

const idSchema = z
  .string()
  .regex(SIYUAN_ID_PATTERN, "Invalid ID format (expected YYYYMMDDHHmmss-xxxxxxx)");

export function registerDocTools(server: McpServer, client: SiYuanClient): void {
  server.registerTool(
    "create_doc",
    {
      title: "Create document",
      description:
        "Create a new document in a notebook. By default it is created at the notebook root; " +
        "pass parentDocId to nest it as a child of an existing document (builds a hierarchy). " +
        "Optionally provide an initial Markdown body. Calling repeatedly with the same resulting path does NOT overwrite an existing document.",
      inputSchema: {
        notebookId: idSchema.describe("ID of the target notebook"),
        title: z.string().min(1).max(200).describe("Title for the new document"),
        parentDocId: idSchema
          .optional()
          .describe(
            "Optional parent document ID. When provided, the new document is nested under it (same notebook)."
          ),
        markdown: z
          .string()
          .max(MAX_CONTENT_LENGTH)
          .optional()
          .describe("Optional initial GFM Markdown body. Do not include a top-level '# title' heading — the title comes from the document name."),
      },
      outputSchema: {
        createdDocId: z.string(),
        notebookId: z.string(),
        title: z.string(),
        path: z.string(),
        parentDocId: z.string().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ notebookId, title, parentDocId, markdown }) => {
      try {
        const safeTitle = title.replace(/[/\\#]/g, "-");
        let path = `/${safeTitle}`;
        if (parentDocId) {
          const parentHpath = (
            await client.request<string>("/api/filetree/getHPathByID", { id: parentDocId })
          )?.trim();
          if (!parentHpath || !parentHpath.startsWith("/")) {
            throw new Error(
              `Could not resolve human-readable path for parent document ${parentDocId}. Verify the parent ID exists.`
            );
          }
          path = `${parentHpath}/${safeTitle}`;
        }
        // The document title is derived from `path`; do NOT prepend a `# title`
        // heading here or the document would carry a duplicate H1 in its body.
        const createdDocId = await client.request<string>("/api/filetree/createDocWithMd", {
          notebook: notebookId,
          path,
          markdown: markdown ?? "",
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
        return toolError(`create_doc failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "rename_doc",
    {
      title: "Rename document",
      description:
        "Rename a document by its ID. Changes the title without moving it in the tree.",
      inputSchema: {
        docId: idSchema.describe("ID of the document to rename"),
        title: z.string().min(1).max(200).describe("New title"),
      },
      outputSchema: { renamed: z.string(), title: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ docId, title }) => {
      try {
        await client.request("/api/filetree/renameDocByID", { id: docId, title });
        await client.flushTransaction();
        return toolResult({ renamed: docId, title });
      } catch (err) {
        return toolError(`rename_doc failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "move_docs",
    {
      title: "Move documents",
      description:
        "Move one or more documents under a target. The target can be another document ID (the docs become its children, nesting the hierarchy) " +
        "or a notebook ID (the docs move to the notebook root). Use this to reorganize a flat list of documents into a tree.",
      inputSchema: {
        docIds: z.array(idSchema).min(1).max(100).describe("IDs of the documents to move"),
        targetId: idSchema.describe(
          "Target: a parent document ID (nest as children) or a notebook ID (move to root)"
        ),
      },
      outputSchema: { moved: z.array(z.string()), targetId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ docIds, targetId }) => {
      try {
        await client.request("/api/filetree/moveDocsByID", { fromIDs: docIds, toID: targetId });
        await client.flushTransaction();
        return toolResult({ moved: docIds, targetId });
      } catch (err) {
        return toolError(`move_docs failed: ${String(err)}`);
      }
    }
  );

  server.registerTool(
    "remove_doc",
    {
      title: "Remove document",
      description:
        "Delete a document by its ID. WARNING: this removes the document and ALL its child documents and blocks, " +
        "and cannot be undone. Confirm the ID with read_doc or list_docs before calling.",
      inputSchema: {
        docId: idSchema.describe("ID of the document to delete"),
      },
      outputSchema: { removed: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ docId }) => {
      try {
        await client.request("/api/filetree/removeDocByID", { id: docId });
        await client.flushTransaction();
        return toolResult({ removed: docId });
      } catch (err) {
        return toolError(`remove_doc failed: ${String(err)}`);
      }
    }
  );
}
