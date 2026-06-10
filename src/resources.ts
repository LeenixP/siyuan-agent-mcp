import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiYuanClient } from "./client.js";
import { jsonText, truncate } from "./format.js";

function variableString(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

export function registerResources(server: McpServer, client: SiYuanClient): void {
  server.registerResource(
    "siyuan_doc",
    new ResourceTemplate("siyuan://doc/{id}", { list: undefined }),
    {
      title: "SiYuan document",
      description: "Read a SiYuan document by root block ID as Markdown.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const id = variableString(variables.id);
      const data = await client.request<{ content?: string }>("/api/export/exportMdContent", { id });
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "text/markdown",
            text: truncate(data.content ?? ""),
          },
        ],
      };
    }
  );

  server.registerResource(
    "siyuan_block",
    new ResourceTemplate("siyuan://block/{id}", { list: undefined }),
    {
      title: "SiYuan block",
      description: "Read a SiYuan block by ID as kramdown.",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const id = variableString(variables.id);
      const data = await client.request<{ kramdown?: string }>("/api/block/getBlockKramdown", { id });
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "text/plain",
            text: truncate(data.kramdown ?? ""),
          },
        ],
      };
    }
  );

  server.registerResource(
    "siyuan_notebook",
    new ResourceTemplate("siyuan://notebook/{id}", { list: undefined }),
    {
      title: "SiYuan notebook",
      description: "Read notebook metadata from SiYuan's notebook list.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = variableString(variables.id);
      const data = await client.request<{ notebooks?: unknown[] }>("/api/notebook/lsNotebooks");
      const notebook = (data.notebooks ?? []).find(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          "id" in candidate &&
          candidate.id === id
      );
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: jsonText(notebook ?? null),
          },
        ],
      };
    }
  );
}
