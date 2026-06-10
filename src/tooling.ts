import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export interface ToolRegistrationOptions {
  readOnlyMode: boolean;
  enableLegacyAliases: boolean;
  enableSql: boolean;
  enableDangerousTools: boolean;
}

export interface SiyuanToolSpec<
  InputSchema extends z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny,
> {
  name: string;
  legacyName?: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  annotations: ToolAnnotations;
  requiresDangerousTools?: boolean;
}

export function registerSiyuanTool<
  InputSchema extends z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny,
>(
  server: McpServer,
  options: ToolRegistrationOptions,
  spec: SiyuanToolSpec<InputSchema, OutputSchema>,
  handler: ToolCallback<InputSchema>
): void {
  if (options.readOnlyMode && spec.annotations.readOnlyHint !== true) {
    return;
  }
  if (spec.requiresDangerousTools && !options.enableDangerousTools) {
    return;
  }

  const config = {
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    annotations: spec.annotations,
  };

  server.registerTool(spec.name, config, handler);

  if (options.enableLegacyAliases && spec.legacyName) {
    server.registerTool(
      spec.legacyName,
      {
        ...config,
        title: `${spec.title} (legacy alias)`,
        description: `Deprecated alias for ${spec.name}. ${spec.description}`,
      },
      handler
    );
  }
}

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

export const READ_ONLY_EXTERNAL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} satisfies ToolAnnotations;

export const WRITE_SAFE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} satisfies ToolAnnotations;

export const WRITE_IDEMPOTENT = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

export const WRITE_DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;
