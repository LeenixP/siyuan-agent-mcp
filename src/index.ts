#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// --- Configuration ----------------------------------------------------------

const API_URL = process.env.SIYUAN_API_URL || "http://127.0.0.1:6806";
const API_TOKEN = process.env.SIYUAN_API_TOKEN || "";

if (!API_TOKEN) {
  console.error("[siyuan-agent-mcp] SIYUAN_API_TOKEN is not set. Please set it in your environment.");
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
    throw new Error(`Failed to reach SiYuan at ${API_URL}: ${String(err)}`);
  }

  const json = (await response.json()) as SiYuanResponse<T>;

  if (json.code !== 0) {
    throw new Error(`SiYuan API error [${endpoint}]: code=${json.code} msg="${json.msg}"`);
  }

  return json;
}

// --- Tool parameter schemas -------------------------------------------------

const SearchNotesSchema = {
  query: z.string().describe("Full-text search query"),
};

const SearchBlocksSchema = {
  type: z
    .string()
    .optional()
    .describe("Block type filter, e.g. 'd' for document, 'h' for heading, 'p' for paragraph"),
  limit: z.number().int().min(1).max(200).default(50).optional()
    .describe("Maximum number of results (1-200, default 50)"),
};

const GetBlockSchema = {
  blockId: z.string().describe("ID of the block to retrieve"),
};

const InsertBlockSchema = {
  parentId: z.string().describe("ID of the parent block to insert under"),
  content: z.string().describe("Markdown content for the new block"),
  type: z
    .enum(["p", "h", "l", "u", "o", "b", "c", "m", "t", "query"])
    .default("p")
    .optional()
    .describe("Block type (p=paragraph, h=heading, l=list-item, u=unordered-list, o=ordered-list, b=blockquote, c=code, m=math, t=table, query=embed). Default: 'p'"),
};

const UpdateBlockSchema = {
  blockId: z.string().describe("ID of the block to update"),
  content: z.string().describe("New markdown content"),
};

const DeleteBlockSchema = {
  blockId: z.string().describe("ID of the block to delete"),
};

const ListDocsSchema = {
  notebookId: z.string().optional().describe("Notebook ID filter; omit to list all notebooks"),
};

const CreateDocSchema = {
  notebookId: z.string().describe("ID of the target notebook"),
  title: z.string().describe("Title for the new document"),
};

// --- Utility functions ------------------------------------------------------

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
  async ({ query }) => {
    const sql = `SELECT * FROM blocks WHERE content LIKE '%${query.replace(/'/g, "''")}%' AND type IN ('d','h','p','l','c','m','b','t','query') LIMIT 50`;
    const res = await siyuanRequest<SiYuanBlock[]>(`/api/query/sql`, { stmt: sql });
    const blocks = (res.data ?? []).map(pickBlockFields);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ count: blocks.length, blocks }, null, 2) },
      ],
    };
  }
);

// -- search_blocks -----------------------------------------------------------

server.tool(
  "search_blocks",
  "List blocks filtered by type. Returns block IDs, types, and content. Use type 'd' for documents, 'h' for headings, 'p' for paragraphs.",
  SearchBlocksSchema,
  async ({ type, limit = 50 }) => {
    let sql = "SELECT * FROM blocks";
    if (type) {
      sql += ` WHERE type = '${type.replace(/'/g, "''")}'`;
    }
    sql += ` LIMIT ${limit}`;
    const res = await siyuanRequest<SiYuanBlock[]>(`/api/query/sql`, { stmt: sql });
    const blocks = (res.data ?? []).map(pickBlockFields);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ count: blocks.length, blocks }, null, 2) },
      ],
    };
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

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              id: blockId,
              attrs: attrsRes.data,
              kramdown: (kramdownRes.data as { kramdown: string })?.kramdown ?? "",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// -- insert_block ------------------------------------------------------------

server.tool(
  "insert_block",
  "Insert a new block under a parent block. The content is written in markdown.",
  InsertBlockSchema,
  async ({ parentId, content, type = "p" }) => {
    // Map logical type to SiYuan markdown heading level or default
    let markdown = content;
    if (type === "h") {
      markdown = `## ${content}`;
    }

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

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ insertedBlockId: newId, parentId }, null, 2),
        },
      ],
    };
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

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ updated: blockId }, null, 2),
        },
      ],
    };
  }
);

// -- delete_block ------------------------------------------------------------

server.tool(
  "delete_block",
  "Delete a block by its ID. This action cannot be undone.",
  DeleteBlockSchema,
  async ({ blockId }) => {
    await siyuanRequest(`/api/block/deleteBlock`, { id: blockId });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ deleted: blockId }, null, 2),
        },
      ],
    };
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
      // List documents in a specific notebook
      const sql = `SELECT * FROM blocks WHERE type = 'd' AND box = '${notebookId.replace(/'/g, "''")}' ORDER BY hpath`;
      const res = await siyuanRequest<SiYuanBlock[]>(`/api/query/sql`, { stmt: sql });
      const docs = (res.data ?? []).map(pickBlockFields);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ notebookId, count: docs.length, docs }, null, 2),
          },
        ],
      };
    }

    // List all notebooks with their documents
    const nbRes = await siyuanRequest<{ notebooks: SiYuanNotebook[] }>(
      `/api/notebook/lsNotebooks`
    );
    const notebooks = nbRes.data.notebooks ?? [];

    const result: Array<{ notebook: SiYuanNotebook; docs: ReturnType<typeof pickBlockFields>[] }> = [];

    for (const nb of notebooks) {
      const sql = `SELECT * FROM blocks WHERE type = 'd' AND box = '${nb.id.replace(/'/g, "''")}' ORDER BY hpath LIMIT 200`;
      try {
        const docRes = await siyuanRequest<SiYuanBlock[]>(`/api/query/sql`, { stmt: sql });
        const docs = (docRes.data ?? []).map(pickBlockFields);
        result.push({ notebook: nb, docs });
      } catch {
        result.push({ notebook: nb, docs: [] });
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ notebooks: result }, null, 2),
        },
      ],
    };
  }
);

// -- create_doc --------------------------------------------------------------

server.tool(
  "create_doc",
  "Create a new document in a notebook. The document is created at the root of the notebook.",
  CreateDocSchema,
  async ({ notebookId, title }) => {
    const res = await siyuanRequest<string>(`/api/filetree/createDocWithMd`, {
      notebook: notebookId,
      path: `/${title}`,
      markdown: `# ${title}`,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ createdDocId: res.data, notebookId, title }, null, 2),
        },
      ],
    };
  }
);

// --- Startup -----------------------------------------------------------------

async function main() {
  if (!API_TOKEN) {
    console.error(
      "[siyuan-agent-mcp] WARNING: SIYUAN_API_TOKEN is empty. All API calls will fail with auth errors."
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[siyuan-agent-mcp] Connected. API: ${API_URL}`);
}

main().catch((err) => {
  console.error("[siyuan-agent-mcp] Fatal startup error:", err);
  process.exit(1);
});
