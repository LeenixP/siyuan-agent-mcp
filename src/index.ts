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
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerSystemTools } from "./tools/system.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerResources } from "./resources.js";
import type { ToolRegistrationOptions } from "./tooling.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SiYuanClient(config);

  const server = new McpServer({
    name: "siyuan-agent-mcp",
    version: "3.1.5",
  });

  const registrationOptions: ToolRegistrationOptions = {
    readOnlyMode: config.readOnly,
    enableLegacyAliases: config.enableLegacyAliases,
    enableSql: config.enableSql,
    enableDangerousTools: config.enableDangerousTools,
  };

  registerSystemTools(server, client, config, registrationOptions);
  registerNavigateTools(server, client, registrationOptions);
  registerSearchTools(server, client, registrationOptions);
  registerReadTools(server, client, registrationOptions);
  registerKnowledgeTools(server, client, registrationOptions);
  registerAssetTools(server, client, registrationOptions);
  registerDocTools(server, client, registrationOptions);
  registerBlockTools(server, client, registrationOptions);
  registerAttrTools(server, client, registrationOptions);
  registerNotebookTools(server, client, registrationOptions);
  registerResources(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[siyuan-agent-mcp] Connected. API: ${sanitizeUrl(config.apiUrl)} ` +
      `readOnly=${config.readOnly} legacyAliases=${config.enableLegacyAliases} ` +
      `sql=${config.enableSql} dangerous=${config.enableDangerousTools}`
  );
}

main().catch((err) => {
  console.error("[siyuan-agent-mcp] Fatal startup error:", err);
  process.exit(1);
});
