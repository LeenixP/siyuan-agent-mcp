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

export interface MarkdownBlockSplit {
  firstBlock: string;
  remainingBlocks: string | null;
}

function isBlankLine(line: string): boolean {
  return line.trim() === "";
}

function trimOuterBlankLines(markdown: string): string {
  const lines = markdown.split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && isBlankLine(lines[start])) start += 1;
  while (end > start && isBlankLine(lines[end - 1])) end -= 1;
  return lines.slice(start, end).join("\n");
}

function lineIndent(line: string): number {
  let indent = 0;
  for (const char of line) {
    if (char === " ") indent += 1;
    else if (char === "\t") indent += 4;
    else break;
  }
  return indent;
}

function nextNonBlankLine(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i += 1) {
    if (!isBlankLine(lines[i])) return i;
  }
  return -1;
}

function skipBlankLines(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length && isBlankLine(lines[i])) i += 1;
  return i;
}

function fenceStart(line: string): { char: "`" | "~"; length: number } | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  const marker = match[1];
  return { char: marker[0] as "`" | "~", length: marker.length };
}

function isFenceEnd(line: string, fence: { char: "`" | "~"; length: number }): boolean {
  const match = line.match(/^ {0,3}(`+|~+)\s*$/);
  return !!match && match[1][0] === fence.char && match[1].length >= fence.length;
}

function isAtxHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:\s|$)/.test(line);
}

function isSetextHeadingUnderline(line: string): boolean {
  return /^ {0,3}(?:=+|-+)\s*$/.test(line);
}

function isThematicBreak(line: string): boolean {
  return /^ {0,3}((?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/.test(line.trimEnd());
}

function isIndentedCodeLine(line: string): boolean {
  return /^(?: {4}|\t)/.test(line);
}

function listMarker(line: string): { indent: number } | null {
  const match = line.match(/^(\s{0,3})(?:[-+*]|\d{1,9}[.)])\s+/);
  return match ? { indent: match[1].length } : null;
}

function isBlockquoteLine(line: string): boolean {
  return /^ {0,3}>/.test(line);
}

function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}

function isTableRow(line: string): boolean {
  return !isBlankLine(line) && line.includes("|");
}

const HTML_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "section",
  "source",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);

function htmlBlockTag(line: string): string | null {
  const match = line.match(/^ {0,3}<([A-Za-z][A-Za-z0-9-]*)(?:\s|>|\/>)/);
  if (!match) return null;
  const tag = match[1].toLowerCase();
  if (tag === "script" || tag === "style" || tag === "pre" || HTML_BLOCK_TAGS.has(tag)) {
    return tag;
  }
  return null;
}

function firstMarkdownBlockEnd(lines: string[]): number {
  const firstLine = lines[0] ?? "";
  const fence = fenceStart(firstLine);
  if (fence) {
    for (let i = 1; i < lines.length; i += 1) {
      if (isFenceEnd(lines[i], fence)) return i + 1;
    }
    return lines.length;
  }

  if (isAtxHeading(firstLine) || isThematicBreak(firstLine)) return 1;

  if (isIndentedCodeLine(firstLine)) {
    for (let i = 1; i < lines.length; i += 1) {
      if (!isBlankLine(lines[i]) && !isIndentedCodeLine(lines[i])) {
        const previousNonBlank = nextNonBlankLine(lines, i);
        return previousNonBlank === i ? i : lines.length;
      }
    }
    return lines.length;
  }

  const tag = htmlBlockTag(firstLine);
  if (tag) {
    const closeTag = new RegExp(`</${tag}\\s*>`, "i");
    for (let i = 0; i < lines.length; i += 1) {
      if (closeTag.test(lines[i])) return i + 1;
      if (i > 0 && isBlankLine(lines[i])) return i;
    }
    return lines.length;
  }

  if (isBlockquoteLine(firstLine)) {
    for (let i = 1; i < lines.length; i += 1) {
      if (isBlockquoteLine(lines[i])) continue;
      if (!isBlankLine(lines[i])) continue; // lazy continuation
      const next = nextNonBlankLine(lines, i + 1);
      if (next !== -1 && isBlockquoteLine(lines[next])) continue;
      return i;
    }
    return lines.length;
  }

  const marker = listMarker(firstLine);
  if (marker) {
    for (let i = 1; i < lines.length; i += 1) {
      if (!isBlankLine(lines[i])) continue;
      const next = nextNonBlankLine(lines, i + 1);
      if (next === -1) return i;
      const nextMarker = listMarker(lines[next]);
      if (nextMarker || lineIndent(lines[next]) > marker.indent) continue;
      return i;
    }
    return lines.length;
  }

  if (lines.length > 1 && isTableDelimiter(lines[1]) && isTableRow(firstLine)) {
    let i = 2;
    while (i < lines.length && isTableRow(lines[i])) i += 1;
    return i;
  }

  if (lines.length > 1 && isSetextHeadingUnderline(lines[1])) return 2;

  for (let i = 1; i < lines.length; i += 1) {
    if (isBlankLine(lines[i])) return i;
    if (
      isAtxHeading(lines[i]) ||
      isThematicBreak(lines[i]) ||
      fenceStart(lines[i]) ||
      isBlockquoteLine(lines[i]) ||
      listMarker(lines[i]) ||
      htmlBlockTag(lines[i]) ||
      (i + 1 < lines.length && isTableDelimiter(lines[i + 1]) && isTableRow(lines[i]))
    ) {
      return i;
    }
  }

  return lines.length;
}

/**
 * SiYuan's /api/block/updateBlock only applies the first root block when given
 * multi-block Markdown for a non-document block. Split before calling it so the
 * caller can update the anchor block and insert the remaining Markdown after it.
 */
export function splitMarkdownForBlockUpdate(markdown: string): MarkdownBlockSplit {
  const normalized = normalizeMarkdownInput(markdown).replace(/\r\n?/g, "\n");
  const trimmed = trimOuterBlankLines(normalized);
  if (!trimmed) return { firstBlock: "", remainingBlocks: null };

  const lines = trimmed.split("\n");
  const firstEnd = firstMarkdownBlockEnd(lines);
  const firstBlock = lines.slice(0, firstEnd).join("\n").trimEnd();
  const remainderStart = skipBlankLines(lines, firstEnd);
  const remaining = lines.slice(remainderStart).join("\n").trim();

  return {
    firstBlock: firstBlock || trimmed,
    remainingBlocks: remaining ? remaining : null,
  };
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
