#!/usr/bin/env node

// siyuan-agent-mcp: an MCP server exposing SiYuan Note's HTTP API to AI clients.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, sanitizeUrl } from "./config.js";
import { SiYuanClient } from "./client.js";
import { registerSearchTools } from "./tools/search.js";
import { registerReadTools } from "./tools/read.js";
import { registerNavigateTools } from "./tools/navigate.js";
import { registerDocTools } from "./tools/docs.js";
import { registerBlockTools } from "./tools/blocks.js";
import { registerAttrTools } from "./tools/attrs.js";
import { registerNotebookTools } from "./tools/notebooks.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SiYuanClient(config);

  const server = new McpServer({
    name: "siyuan-agent-mcp",
    version: "2.0.1",
  });

  registerNavigateTools(server, client);
  registerSearchTools(server, client);
  registerReadTools(server, client);
  registerDocTools(server, client);
  registerBlockTools(server, client);
  registerAttrTools(server, client);
  registerNotebookTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[siyuan-agent-mcp] Connected. API: ${sanitizeUrl(config.apiUrl)}`);
}

main().catch((err) => {
  console.error("[siyuan-agent-mcp] Fatal startup error:", err);
  process.exit(1);
});
