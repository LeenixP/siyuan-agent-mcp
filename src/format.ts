// Shared helpers: ID validation, response shaping, SQL escaping, field picking.

import type { CallToolResult, ResourceLink } from "@modelcontextprotocol/sdk/types.js";
import type { SiYuanBlock } from "./types.js";

/** SiYuan block/document IDs look like 20210817205410-2kvfpfn. */
export const SIYUAN_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;

/** Cap on returned content so a single huge document cannot blow up the client context. */
export const MAX_CONTENT_LENGTH = 100_000;

/** Columns selected by the SQL-backed listing tools. */
export const RESULT_COLUMNS =
  "id, type, subType, content, box, hpath, parent_id, root_id, created, updated";

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function escapeLikePattern(value: string): string {
  return value.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export interface TruncationInfo {
  truncated: boolean;
  originalLength: number;
  returnedLength: number;
}

export interface TruncatedText {
  text: string;
  truncation: TruncationInfo;
}

/** Truncate over-long text and append a marker so the agent knows content was cut. */
export function truncateWithInfo(text: string, max = MAX_CONTENT_LENGTH): TruncatedText {
  const truncated = text.length > max;
  const returnedLength = truncated ? max : text.length;
  const output = truncated
    ? text.slice(0, max) +
      `\n\n...[truncated ${text.length - max} of ${text.length} characters; use a narrower read/search query to retrieve the rest]`
    : text;
  return {
    text: output,
    truncation: {
      truncated,
      originalLength: text.length,
      returnedLength,
    },
  };
}

export function truncate(text: string, max = MAX_CONTENT_LENGTH): string {
  return truncateWithInfo(text, max).text;
}

export function truncationInfo(text: string, max = MAX_CONTENT_LENGTH): TruncationInfo {
  return truncateWithInfo(text, max).truncation;
}

/**
 * Some MCP clients or model-generated calls pass Markdown with escaped newline
 * sequences as literal "\\n" text. SiYuan's Markdown parser needs real line
 * breaks to split headings, paragraphs, and lists into separate blocks.
 */
export function normalizeMarkdownInput(markdown: string): string {
  if (markdown.includes("\n") || markdown.includes("\r")) return markdown;
  if (!/\\[nrt]/.test(markdown)) return markdown;
  return markdown
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t");
}

/** Keep only the fields agents care about, dropping internal hashes and paths. */
export function pickBlockFields(b: SiYuanBlock) {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Extract block IDs from SiYuan transaction arrays returned by write APIs. */
export function operationIdsFromTransactions(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const transaction of data) {
    const tx = asRecord(transaction);
    const operations = tx?.doOperations;
    if (!Array.isArray(operations)) continue;
    for (const operation of operations) {
      const op = asRecord(operation);
      if (typeof op?.id === "string" && op.id) {
        ids.push(op.id);
      }
    }
  }
  return Array.from(new Set(ids));
}

export function firstOperationIdFromTransactions(data: unknown): string | null {
  return operationIdsFromTransactions(data)[0] ?? null;
}

/**
 * Build a tool response that carries both a human/text view and machine-readable
 * structured content (the latter is validated against the tool's outputSchema).
 */
export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function summaryList(title: string, lines: string[]): string {
  return [`# ${title}`, "", ...lines].join("\n");
}

export function toolResult<T extends Record<string, unknown>>(
  structured: T,
  text?: string,
  resourceLinks: ResourceLink[] = []
): CallToolResult {
  return {
    content: [
      { type: "text" as const, text: text ?? jsonText(structured) },
      ...resourceLinks,
    ],
    structuredContent: structured,
  };
}

/** Build an error result that surfaces the failure to the agent with a hint. */
export function toolError(message: string): CallToolResult {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function requireConfirmId(targetId: string, confirmId?: string): void {
  if (confirmId !== targetId) {
    throw new Error(
      `Destructive operation requires confirmId equal to the target ID (${targetId}).`
    );
  }
}

export function requireConfirmText(expected: string, confirmText?: string): void {
  if (confirmText !== expected) {
    throw new Error(`Dangerous operation requires confirmText exactly equal to "${expected}".`);
  }
}
