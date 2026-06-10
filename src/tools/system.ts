// System and health tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { sanitizeUrl } from "../config.js";
import type { SiYuanClient } from "../client.js";
import { toolError, toolResult } from "../format.js";
import { EmptyInputSchema, UnknownRecordSchema } from "../schemas.js";
import {
  READ_ONLY,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

export function registerSystemTools(
  server: McpServer,
  client: SiYuanClient,
  config: Config,
  options: ToolRegistrationOptions
): void {
  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_health",
      title: "Check SiYuan MCP health",
      description:
        "Verify SiYuan kernel reachability, token access, version, boot progress, and MCP server mode.",
      inputSchema: EmptyInputSchema,
      outputSchema: z
        .object({
          ok: z.boolean(),
          apiUrl: z.string(),
          version: z.string().nullable(),
          currentTime: z.unknown().nullable(),
          bootProgress: UnknownRecordSchema.nullable(),
          modes: z.object({
            readOnly: z.boolean(),
            legacyAliases: z.boolean(),
            sqlEnabled: z.boolean(),
            timeoutMs: z.number(),
          }),
          notebooksAccessible: z.boolean(),
          notebookCount: z.number(),
          warnings: z.array(z.string()),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async () => {
      const warnings: string[] = [];
      let version: string | null = null;
      let currentTime: unknown | null = null;
      let bootProgress: Record<string, unknown> | null = null;
      let notebooksAccessible = false;
      let notebookCount = 0;

      try {
        const [versionResult, timeResult, bootResult, notebookResult] = await Promise.allSettled([
          client.request<string>("/api/system/version"),
          client.request<unknown>("/api/system/currentTime"),
          client.request<Record<string, unknown>>("/api/system/bootProgress"),
          client.request<{ notebooks?: unknown[] }>("/api/notebook/lsNotebooks"),
        ]);

        if (versionResult.status === "fulfilled") version = String(versionResult.value);
        else warnings.push(`version: ${String(versionResult.reason)}`);

        if (timeResult.status === "fulfilled") currentTime = timeResult.value;
        else warnings.push(`currentTime: ${String(timeResult.reason)}`);

        if (bootResult.status === "fulfilled") bootProgress = bootResult.value ?? {};
        else warnings.push(`bootProgress: ${String(bootResult.reason)}`);

        if (notebookResult.status === "fulfilled") {
          notebooksAccessible = true;
          notebookCount = notebookResult.value.notebooks?.length ?? 0;
        } else {
          warnings.push(`lsNotebooks: ${String(notebookResult.reason)}`);
        }

        return toolResult({
          ok: warnings.length === 0,
          apiUrl: sanitizeUrl(config.apiUrl),
          version,
          currentTime,
          bootProgress,
          modes: {
            readOnly: config.readOnly,
            legacyAliases: config.enableLegacyAliases,
            sqlEnabled: config.enableSql,
            timeoutMs: config.timeoutMs,
          },
          notebooksAccessible,
          notebookCount,
          warnings,
        });
      } catch (err) {
        return toolError(`siyuan_health failed: ${String(err)}`);
      }
    }
  );
}
