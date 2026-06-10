// Shared helpers: ID validation, response shaping, SQL escaping, field picking.

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

/** Truncate over-long text and append a marker so the agent knows content was cut. */
export function truncate(text: string, max = MAX_CONTENT_LENGTH): string {
  if (text.length <= max) return text;
  return (
    text.slice(0, max) +
    `\n\n…[truncated ${text.length - max} of ${text.length} characters; use a more specific block ID or SQL to read the rest]`
  );
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

/**
 * Build a tool response that carries both a human/text view and machine-readable
 * structured content (the latter is validated against the tool's outputSchema).
 */
export function toolResult<T extends Record<string, unknown>>(structured: T) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structured, null, 2) },
    ],
    structuredContent: structured,
  };
}

/** Build an error result that surfaces the failure to the agent with a hint. */
export function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}
