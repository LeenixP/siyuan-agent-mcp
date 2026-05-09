#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// --- Configuration ----------------------------------------------------------

const API_URL = process.env.SIYUAN_API_URL || "http://127.0.0.1:6806";
const API_TOKEN = process.env.SIYUAN_API_TOKEN || "";

// --- Utility functions ------------------------------------------------------

const MAX_CONTENT_LENGTH = 100_000;
const SiyuanIdPattern = /^\d{14}-[a-z0-9]{7}$/;

const BLOCK_TYPES = ["p", "h", "l", "u", "o", "b", "c", "m", "t", "query"] as const;
const BLOCK_TYPE_LABELS: Record<string, string> = {
  p: "paragraph", h: "heading", l: "list-item", u: "unordered-list",
  o: "ordered-list", b: "blockquote", c: "code", m: "math",
  t: "table", query: "embed",
};

const RESULT_COLUMNS = "id, type, subType, content, box, hpath, parent_id, root_id, created, updated";

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeLikePattern(value: string): string {
  return value.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      return url.replace(/\/\/[^@]+@/, "//***:***@");
    }
    return url;
  } catch {
    return "[redacted]";
  }
}

function formatToolResponse(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Convert logical block type to appropriate markdown format */
function formatBlockContent(type: string, content: string): string {
  switch (type) {
    case "h":  return `## ${content}`;
    case "c":  return `\`\`\`\n${content}\n\`\`\``;
    case "b":  return `> ${content.replace(/\n/g, "\n> ")}`;
    case "l":  return `- ${content}`;
    case "u":  return `- ${content}`;
    case "o":  return `1. ${content}`;
    case "m":  return `$$\n${content}\n$$`;
    case "t":  return `| ${content.replace(/\n/g, " |\n| ")} |`;
    default:   return content;
  }
}

// --- HTTP helper ------------------------------------------------------------

interface SiYuanResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

async function siyuanRequest<T = unknown>(
  endpoint: string,
  body?: Record<string, unknown>
): Promise<SiYuanResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_TOKEN) {
    headers["Authorization"] = `Token ${API_TOKEN}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${endpoint}`, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error(`[siyuan-agent-mcp] Network error calling ${endpoint}:`, err);
    throw new Error(`Failed to reach SiYuan at ${sanitizeUrl(API_URL)}: ${String(err)}`);
  }

  let json: SiYuanResponse<T>;
  try {
    json = (await response.json()) as SiYuanResponse<T>;
  } catch {
    throw new Error(`SiYuan API returned non-JSON response [${endpoint}]: ${response.status}`);
  }

  if (json.code !== 0) {
    throw new Error(`SiYuan API error [${endpoint}]: code=${json.code} msg="${json.msg}"`);
  }

  return json;
}

// --- Tool parameter schemas -------------------------------------------------

const SearchNotesSchema = {
  query: z.string().min(1).max(500)
    .describe("Full-text search query"),
  limit: z.number().int().min(1).max(200).default(50).optional()
    .describe("Maximum number of results (1-200, default 50)"),
};

const SearchBlocksSchema = {
  type: z.enum(BLOCK_TYPES).optional()
    .describe("Block type filter, e.g. 'd' for document, 'h' for heading, 'p' for paragraph"),
  limit: z.number().int().min(1).max(200).default(50).optional()
    .describe("Maximum number of results (1-200, default 50)"),
};

const GetBlockSchema = {
  blockId: z.string().regex(SiyuanIdPattern, "Invalid block ID format (expected YYYYMMDDHHmmss-xxxxxxx)")
    .describe("ID of the block to retrieve"),
};

const InsertBlockSchema = {
  parentId: z.string().regex(SiyuanIdPattern, "Invalid block ID format")
    .describe("ID of the parent block to insert under"),
  content: z.string().min(1).max(MAX_CONTENT_LENGTH)
    .describe("Markdown content for the new block"),
  type: z.enum(BLOCK_TYPES).default("p").optional()
    .describe(`Block type: ${Object.entries(BLOCK_TYPE_LABELS).map(([k, v]) => `${k}=${v}`).join(", ")}. Default: 'p'`),
};

const UpdateBlockSchema = {
  blockId: z.string().regex(SiyuanIdPattern, "Invalid block ID format")
    .describe("ID of the block to update"),
  content: z.string().min(1).max(MAX_CONTENT_LENGTH)
    .describe("New markdown content"),
};

const DeleteBlockSchema = {
  blockId: z.string().regex(SiyuanIdPattern, "Invalid block ID format")
    .describe("ID of the block to delete"),
};

const ListDocsSchema = {
  notebookId: z.string().regex(SiyuanIdPattern, "Invalid notebook ID format").optional()
    .describe("Notebook ID filter; omit to list all notebooks"),
};

const CreateDocSchema = {
  notebookId: z.string().regex(SiyuanIdPattern, "Invalid notebook ID format")
    .describe("ID of the target notebook"),
  title: z.string().min(1).max(200)
    .describe("Title for the new document"),
};

// --- Pick block fields ------------------------------------------------------

interface SiYuanBlock {
  id: string;
  type: string;
  subType?: string;
  content: string;
  box: string;
  path: string;
  hpath: string;
  root_id: string;
  parent_id: string;
  created: string;
  updated: string;
}

function pickBlockFields(b: SiYuanBlock) {
  return {
    id: b.id,
    type: b.type,
    subType: b.subType,
    content: b.content,
    box: b.box,
    hpath: b.hpath,
    parent_id: b.parent_id,
    root_id: b.root_id,
    created: b.created,
    updated: b.updated,
  };
}

// --- Server setup -----------------------------------------------------------

const server = new McpServer({
  name: "siyuan-agent-mcp",
  version: "1.0.0",
});

// -- search_notes ------------------------------------------------------------

server.tool(
  "search_notes",
  "Full-text search across SiYuan notes. Searches block content and returns matching blocks with their IDs, content, and paths.",
  SearchNotesSchema,
  async ({ query, limit = 50 }) => {
    const escaped = escapeLikePattern(escapeSqlString(query));
    const sql = `SELECT ${RESULT_COLUMNS} FROM blocks WHERE content LIKE '%${escaped}%' ESCAPE '\\' AND type IN ('d','h','p','l','c','m','b','t','query') LIMIT ${limit}`;
    const res = await siyuanRequest<SiYuanBlock[]>(`/api/query/sql`, { stmt: sql });
    const blocks = (res.data ?? []).map(pickBlockFields);
    return formatToolResponse({ count: blocks.length, blocks });
  }
);

// -- search_blocks -----------------------------------------------------------

server.tool(
  "search_blocks",
  "List blocks filtered by type. Returns block IDs, types, and content. Use type 'd' for documents, 'h' for headings, 'p' for paragraphs.",
  SearchBlocksSchema,
  async ({ type, limit = 50 }) => {
    let sql = `SELECT ${RESULT_COLUMNS} FROM blocks`;
    if (type) {
      sql += ` WHERE type = '${escapeSqlString(type)}'`;
    }
    sql += ` LIMIT ${limit}`;
    const res = await siyuanRequest<SiYuanBlock[]>(`/api/query/sql`, { stmt: sql });
    const blocks = (res.data ?? []).map(pickBlockFields);
    return formatToolResponse({ count: blocks.length, blocks });
  }
);

// -- get_block ---------------------------------------------------------------

server.tool(
  "get_block",
  "Get full details and kramdown source of a specific block by its ID.",
  GetBlockSchema,
  async ({ blockId }) => {
    const [attrsRes, kramdownRes] = await Promise.all([
      siyuanRequest<Record<string, unknown>>(`/api/attr/getBlockAttrs`, { id: blockId }),
      siyuanRequest<{ id: string; kramdown: string }>(`/api/block/getBlockKramdown`, { id: blockId }),
    ]);

    return formatToolResponse({
      id: blockId,
      attrs: attrsRes.data,
      kramdown: (kramdownRes.data as { kramdown: string })?.kramdown ?? "",
    });
  }
);

// -- insert_block ------------------------------------------------------------

server.tool(
  "insert_block",
  "Insert a new block under a parent block. The content is written in markdown.",
  InsertBlockSchema,
  async ({ parentId, content, type = "p" }) => {
    const markdown = formatBlockContent(type, content);

    const res = await siyuanRequest<Array<{ doOperations: Array<{ id: string }> }>>(
      `/api/block/appendBlock`,
      {
        dataType: "markdown",
        data: markdown,
        parentID: parentId,
      }
    );

    const ops = res.data?.[0]?.doOperations;
    const newId = ops?.find((op) => op.id)?.id ?? "unknown";

    return formatToolResponse({ insertedBlockId: newId, parentId, type });
  }
);

// -- update_block ------------------------------------------------------------

server.tool(
  "update_block",
  "Update the content of an existing block with new markdown.",
  UpdateBlockSchema,
  async ({ blockId, content }) => {
    await siyuanRequest(`/api/block/updateBlock`, {
      dataType: "markdown",
      data: content,
      id: blockId,
    });

    return formatToolResponse({ updated: blockId });
  }
);

// -- delete_block ------------------------------------------------------------

server.tool(
  "delete_block",
  "Delete a block by its ID. This action cannot be undone.",
  DeleteBlockSchema,
  async ({ blockId }) => {
    await siyuanRequest(`/api/block/deleteBlock`, { id: blockId });

    return formatToolResponse({ deleted: blockId });
  }
);

// -- list_docs ---------------------------------------------------------------

interface SiYuanNotebook {
  id: string;
  name: string;
  icon: string;
  sort: number;
  closed: boolean;
}

server.tool(
  "list_docs",
  "List the document tree grouped by notebook. Returns a hierarchy of notebooks and their documents.",
  ListDocsSchema,
  async ({ notebookId }) => {
    if (notebookId) {
      const sql = `SELECT ${RESULT_COLUMNS} FROM blocks WHERE type = 'd' AND box = '${escapeSqlString(notebookId)}' ORDER BY hpath`;
      const res = await siyuanRequest<SiYuanBlock[]>(`/api/query/sql`, { stmt: sql });
      const docs = (res.data ?? []).map(pickBlockFields);
      return formatToolResponse({ notebookId, count: docs.length, docs });
    }

    const nbRes = await siyuanRequest<{ notebooks: SiYuanNotebook[] }>(
      `/api/notebook/lsNotebooks`
    );
    const notebooks = nbRes.data.notebooks ?? [];

    const docPromises = notebooks.map(async (nb) => {
      const sql = `SELECT ${RESULT_COLUMNS} FROM blocks WHERE type = 'd' AND box = '${escapeSqlString(nb.id)}' ORDER BY hpath LIMIT 200`;
      try {
        const docRes = await siyuanRequest<SiYuanBlock[]>(`/api/query/sql`, { stmt: sql });
        const docs = (docRes.data ?? []).map(pickBlockFields);
        return { notebook: nb, docs };
      } catch (err) {
        console.error(`[siyuan-agent-mcp] Failed to list docs for notebook ${nb.id}:`, err);
        return { notebook: nb, docs: [], error: String(err) };
      }
    });

    const result = await Promise.all(docPromises);
    return formatToolResponse({ notebooks: result });
  }
);

// -- create_doc --------------------------------------------------------------

server.tool(
  "create_doc",
  "Create a new document in a notebook. The document is created at the root of the notebook.",
  CreateDocSchema,
  async ({ notebookId, title }) => {
    const safeTitle = title.replace(/[/\\#]/g, "-");
    const res = await siyuanRequest<string>(`/api/filetree/createDocWithMd`, {
      notebook: notebookId,
      path: `/${safeTitle}`,
      markdown: `# ${title}`,
    });

    return formatToolResponse({ createdDocId: res.data, notebookId, title });
  }
);

// --- Startup -----------------------------------------------------------------

function validateApiUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.protocol !== "https:") {
      console.error("[siyuan-agent-mcp] WARNING: API_URL is remote but not using HTTPS. Token will be sent in cleartext.");
    }
  } catch {
    console.error("[siyuan-agent-mcp] WARNING: API_URL is not a valid URL.");
  }
}

async function main() {
  if (!API_TOKEN) {
    console.error("[siyuan-agent-mcp] FATAL: SIYUAN_API_TOKEN is required. Please set it in your environment.");
    process.exit(1);
  }

  validateApiUrl(API_URL);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[siyuan-agent-mcp] Connected. API: ${sanitizeUrl(API_URL)}`);
}

main().catch((err) => {
  console.error("[siyuan-agent-mcp] Fatal startup error:", err);
  process.exit(1);
});
