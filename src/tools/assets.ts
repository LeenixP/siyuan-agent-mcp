// Asset and slash-menu-inspired insertion tools: upload files, import local
// assets, and insert rich media/embed blocks without making agents memorize
// SiYuan's Markdown/HTML snippets.

import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SiYuanClient } from "../client.js";
import {
  MAX_CONTENT_LENGTH,
  firstOperationIdFromTransactions,
  normalizeMarkdownInput,
  operationIdsFromTransactions,
  toolError,
  toolResult,
} from "../format.js";
import { idSchema } from "../schemas.js";
import {
  WRITE_EXTERNAL,
  type ToolRegistrationOptions,
  registerSiyuanTool,
} from "../tooling.js";

const IMAGE_EXTS = new Set([
  ".apng",
  ".ico",
  ".cur",
  ".jpg",
  ".jpe",
  ".jpeg",
  ".jfif",
  ".pjp",
  ".pjpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".avif",
  ".tiff",
  ".tif",
]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);
const VIDEO_EXTS = new Set([".mov", ".weba", ".mkv", ".mp4", ".webm"]);
const MAX_UPLOAD_FILES = 20;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_LOCAL_FILE_BYTES = 2 * 1024 * 1024 * 1024;
type AssetKind = "image" | "audio" | "video" | "file";

interface AssetSnippet {
  originalName: string;
  assetPath: string;
  kind: AssetKind;
  markdown: string;
}

interface InsertAnchors {
  previousID?: string;
  nextID?: string;
  parentID?: string;
}

function countAnchors(anchors: InsertAnchors): number {
  return [anchors.previousID, anchors.nextID, anchors.parentID].filter(
    (value) => value !== undefined && value !== ""
  ).length;
}

function requireSingleAnchor(anchors: InsertAnchors): void {
  if (countAnchors(anchors) !== 1) {
    throw new Error("Provide exactly one of previousID, nextID, or parentID.");
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function markdownDestination(source: string): string {
  return `<${source.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
}

function pathWithoutQuery(source: string): string {
  return source.split(/[?#]/, 1)[0] ?? source;
}

function extensionOf(source: string): string {
  return path.posix.extname(pathWithoutQuery(source)).toLowerCase();
}

function filenameFromSource(source: string): string {
  const clean = pathWithoutQuery(source);
  const last = clean.split(/[\\/]/).filter(Boolean).at(-1);
  return last || "asset";
}

function displayNameFromFilename(filename: string): string {
  const ext = path.posix.extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

function inferAssetKind(source: string, explicit?: AssetKind): AssetKind {
  if (explicit) return explicit;
  const ext = extensionOf(source);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  return "file";
}

function assertSafeSource(source: string, label: string): void {
  const trimmed = source.trim();
  if (!trimmed) throw new Error(`${label} must not be empty.`);
  if (
    trimmed.startsWith("assets/") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("file://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return;
  }
  throw new Error(
    `${label} must start with assets/, /, file://, http://, or https://. ` +
      "Upload inline/base64 data first instead of inserting data: URLs."
  );
}

function assertSafeIframeSource(source: string): void {
  const trimmed = source.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
    return;
  }
  throw new Error("iframe url must start with http://, https://, or /.");
}

function assetSnippet(source: string, originalName?: string, explicitKind?: AssetKind, title?: string): AssetSnippet {
  assertSafeSource(source, "asset path/url");
  const filename = originalName || filenameFromSource(source);
  const name = displayNameFromFilename(filename);
  const kind = inferAssetKind(source, explicitKind);
  const escapedSource = escapeHtmlAttribute(source);
  const titleSuffix = title ? ` "${escapeMarkdownLabel(title)}"` : "";
  let markdown: string;

  if (kind === "image") {
    markdown = `![${escapeMarkdownLabel(name)}](${markdownDestination(source)}${titleSuffix})`;
  } else if (kind === "audio") {
    markdown = `<audio controls="controls" src="${escapedSource}"></audio>`;
  } else if (kind === "video") {
    markdown = `<video controls="controls" src="${escapedSource}"></video>`;
  } else {
    markdown = `[${escapeMarkdownLabel(title || filename)}](${markdownDestination(source)})`;
  }

  return {
    originalName: filename,
    assetPath: source,
    kind,
    markdown,
  };
}

function snippetsFromSuccMap(succMap: Record<string, unknown>, orderedNames: string[]): AssetSnippet[] {
  const names = orderedNames.filter((name) => typeof succMap[name] === "string");
  for (const key of Object.keys(succMap)) {
    if (!names.includes(key) && typeof succMap[key] === "string") {
      names.push(key);
    }
  }
  return names.map((name) => assetSnippet(String(succMap[name]), name));
}

async function insertMarkdownBlock(
  client: SiYuanClient,
  markdown: string,
  anchors: InsertAnchors
): Promise<{ insertedBlockId: string; operationIds: string[] }> {
  requireSingleAnchor(anchors);
  const data = await client.request<unknown>("/api/block/insertBlock", {
    dataType: "markdown",
    data: normalizeMarkdownInput(markdown),
    previousID: anchors.previousID ?? "",
    nextID: anchors.nextID ?? "",
    parentID: anchors.parentID ?? "",
  });
  const insertedBlockId = firstOperationIdFromTransactions(data);
  if (!insertedBlockId) {
    throw new Error("SiYuan did not return an inserted block ID.");
  }
  await client.flushTransaction();
  return { insertedBlockId, operationIds: operationIdsFromTransactions(data) };
}

function joinedAssetMarkdown(snippets: AssetSnippet[]): string {
  return snippets.map((snippet) => snippet.markdown).join("\n\n");
}

function stripDataUrlPrefix(value: string): { base64: string; mimeType?: string } {
  const match = value.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) return { base64: value };
  return { mimeType: match[1], base64: match[2] };
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function appendUploadFile(
  form: FormData,
  file: z.infer<typeof UploadFileSchema>,
  maxFileBytes: number
): Promise<string> {
  let filename: string;
  let bytes: Uint8Array;
  let mimeType = "mimeType" in file ? file.mimeType : undefined;

  if (file.sourceType === "localPath") {
    const info = await stat(file.path);
    if (!info.isFile()) {
      throw new Error(`Local path is not a file: ${file.path}`);
    }
    if (info.size > maxFileBytes) {
      throw new Error(
        `Local file is ${info.size} bytes, over maxFileBytes=${maxFileBytes}. ` +
          "Use siyuan_import_local_assets for large local files so the SiYuan kernel copies them directly."
      );
    }
    filename = file.filename || path.basename(file.path);
    bytes = new Uint8Array(await readFile(file.path));
  } else if (file.sourceType === "base64") {
    const parsed = stripDataUrlPrefix(file.data);
    filename = file.filename;
    mimeType = file.mimeType || parsed.mimeType;
    bytes = new Uint8Array(Buffer.from(parsed.base64.replace(/\s/g, ""), "base64"));
  } else {
    filename = file.filename;
    bytes = new Uint8Array(Buffer.from(file.content, "utf8"));
  }

  if (!filename.trim()) {
    throw new Error("Upload filename must not be empty.");
  }
  form.append("file[]", new Blob([arrayBufferFromBytes(bytes)], { type: mimeType || undefined }), filename);
  return filename;
}

function quoteCalloutLines(content: string): string {
  const lines = normalizeMarkdownInput(content || "").split(/\r?\n/);
  if (lines.length === 1 && lines[0] === "") return ">";
  return lines.map((line) => `> ${line}`).join("\n");
}

function fencedCodeBlock(language: string, content: string): string {
  const normalized = normalizeMarkdownInput(content || "");
  const longestFence = Math.max(2, ...Array.from(normalized.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestFence + 1);
  return `${fence}${language}\n${normalized}\n${fence}`;
}

function buildTable(columns?: string[], rows = 2): string {
  const safeColumns =
    columns && columns.length > 0
      ? columns.map((column) => column.replace(/\|/g, "\\|"))
      : ["", "", ""];
  const rowCount = Math.max(1, rows);
  const header = `| ${safeColumns.join(" | ")} |`;
  const delimiter = `| ${safeColumns.map(() => "---").join(" | ")} |`;
  const body = Array.from({ length: rowCount }, () => `| ${safeColumns.map(() => " ").join(" | ")} |`);
  return [header, delimiter, ...body].join("\n");
}

function buildSlashMarkdown(params: z.infer<typeof SlashBlockInputSchema>): string {
  const content = params.content ?? "";
  if (params.kind === "image") {
    if (!params.url) throw new Error("kind=image requires url.");
    return assetSnippet(params.url, params.alt || params.title || filenameFromSource(params.url), "image", params.title).markdown;
  }
  if (params.kind === "audio" || params.kind === "video" || params.kind === "file") {
    if (!params.url) throw new Error(`kind=${params.kind} requires url.`);
    return assetSnippet(params.url, params.title || filenameFromSource(params.url), params.kind).markdown;
  }
  if (params.kind === "iframe") {
    if (!params.url) throw new Error("kind=iframe requires url.");
    assertSafeIframeSource(params.url);
    return `<iframe sandbox="allow-forms allow-presentation allow-same-origin allow-scripts allow-modals allow-popups" src="${escapeHtmlAttribute(params.url)}" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`;
  }
  if (params.kind === "widget") {
    const widgetPath = (params.url || params.content || "").trim().replace(/^\/?widgets\//, "").replace(/^\/+|\/+$/g, "");
    if (!widgetPath) throw new Error("kind=widget requires url or content with the widget folder name.");
    return `<iframe src="/widgets/${escapeHtmlAttribute(widgetPath)}/" data-subtype="widget" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`;
  }
  if (params.kind === "html") {
    if (!content.trim()) throw new Error("kind=html requires content.");
    return content;
  }
  if (params.kind === "code") {
    return fencedCodeBlock(params.language ?? "", content);
  }
  if (params.kind === "math") {
    return `$$\n${content}\n$$`;
  }
  if (
    params.kind === "abc" ||
    params.kind === "echarts" ||
    params.kind === "flowchart" ||
    params.kind === "graphviz" ||
    params.kind === "mermaid" ||
    params.kind === "mindmap" ||
    params.kind === "plantuml"
  ) {
    return fencedCodeBlock(params.kind, content);
  }
  if (params.kind === "callout") {
    const type = params.calloutType ?? "NOTE";
    return `> [!${type}]\n${quoteCalloutLines(content)}`;
  }
  if (params.kind === "table") {
    return buildTable(params.columns, params.rows);
  }

  throw new Error(`Unsupported slash block kind: ${params.kind}`);
}

const AnchorSchema = {
  previousID: idSchema.optional().describe("Insert immediately after this block."),
  nextID: idSchema.optional().describe("Insert immediately before this block."),
  parentID: idSchema.optional().describe("Insert as first child of this block/document."),
};

const UploadFileSchema = z.discriminatedUnion("sourceType", [
  z
    .object({
      sourceType: z.literal("localPath"),
      path: z.string().min(1).max(4096).describe("Path on the MCP server machine."),
      filename: z.string().min(1).max(255).optional(),
      mimeType: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      sourceType: z.literal("base64"),
      data: z
        .string()
        .min(1)
        .max(50_000_000)
        .describe("Base64 payload, optionally as a data:<mime>;base64,... URL."),
      filename: z.string().min(1).max(255),
      mimeType: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      sourceType: z.literal("text"),
      content: z.string().min(1).max(MAX_CONTENT_LENGTH),
      filename: z.string().min(1).max(255),
      mimeType: z.string().min(1).max(200).default("text/plain;charset=utf-8"),
    })
    .strict(),
]);

const AssetKindSchema = z.enum(["image", "audio", "video", "file"]);

const AssetSnippetSchema = z
  .object({
    originalName: z.string(),
    assetPath: z.string(),
    kind: AssetKindSchema,
    markdown: z.string(),
  })
  .strict();

const SlashBlockInputSchema = z
  .object({
    kind: z
      .enum([
        "image",
        "audio",
        "video",
        "file",
        "iframe",
        "widget",
        "html",
        "code",
        "math",
        "abc",
        "echarts",
        "flowchart",
        "graphviz",
        "mermaid",
        "mindmap",
        "plantuml",
        "callout",
        "table",
      ])
      .describe("Slash-menu style content kind to create."),
    url: z.string().min(1).max(4096).optional().describe("URL, assets/... path, / path, or file:// source depending on kind."),
    content: z.string().max(MAX_CONTENT_LENGTH).optional().describe("Body for HTML/code/diagram/math/callout/widget kinds."),
    title: z.string().min(1).max(300).optional(),
    alt: z.string().min(1).max(300).optional(),
    language: z.string().min(1).max(80).optional().describe("Code-block language for kind=code."),
    calloutType: z.enum(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]).default("NOTE"),
    columns: z.array(z.string().max(100)).min(1).max(20).optional(),
    rows: z.number().int().min(1).max(50).default(2),
    ...AnchorSchema,
  })
  .strict();

export function registerAssetTools(
  server: McpServer,
  client: SiYuanClient,
  options: ToolRegistrationOptions
): void {
  const UploadAssetsInputSchema = z
    .object({
      files: z.array(UploadFileSchema).min(1).max(MAX_UPLOAD_FILES),
      docId: idSchema.optional().describe("Optional document/block ID used by SiYuan to choose the document asset folder."),
      assetsDirPath: z
        .string()
        .min(1)
        .max(1000)
        .optional()
        .describe("Optional data-root-relative target such as /assets/. Omit with docId to let SiYuan choose the document asset directory."),
      skipIfDuplicated: z.boolean().default(false),
      maxFileBytes: z.number().int().min(1).max(MAX_LOCAL_FILE_BYTES).default(DEFAULT_MAX_FILE_BYTES),
      insertAfterUpload: z.boolean().default(false).describe("When true, insert generated asset blocks after upload using the supplied anchor."),
      ...AnchorSchema,
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_upload_assets",
      title: "Upload SiYuan assets",
      description:
        "Upload local, base64, or text files to SiYuan assets via /api/asset/upload. Optionally insert the uploaded assets as image/audio/video/file blocks. For very large local files, prefer siyuan_import_local_assets so the SiYuan kernel copies paths directly.",
      inputSchema: UploadAssetsInputSchema,
      outputSchema: z
        .object({
          count: z.number(),
          uploadedCount: z.number(),
          errFiles: z.array(z.string()),
          succMap: z.record(z.string()),
          assets: z.array(AssetSnippetSchema),
          generatedMarkdown: z.string(),
          inserted: z.boolean(),
          insertedBlockId: z.string().nullable(),
          operationIds: z.array(z.string()),
          uploadContextId: z.string().nullable(),
          assetsDirPath: z.string().nullable(),
        })
        .strict(),
      annotations: WRITE_EXTERNAL,
    },
    async ({
      files,
      docId,
      assetsDirPath,
      skipIfDuplicated,
      maxFileBytes,
      insertAfterUpload,
      previousID,
      nextID,
      parentID,
    }) => {
      try {
        const anchors = { previousID, nextID, parentID };
        if (insertAfterUpload) requireSingleAnchor(anchors);
        const form = new FormData();
        if (docId || parentID || previousID || nextID) {
          form.append("id", docId ?? parentID ?? previousID ?? nextID ?? "");
        }
        if (assetsDirPath) form.append("assetsDirPath", assetsDirPath);
        if (skipIfDuplicated) form.append("skipIfDuplicated", "true");

        const originalNames: string[] = [];
        for (const file of files) {
          originalNames.push(await appendUploadFile(form, file, maxFileBytes));
        }

        const data = await client.requestForm<{ errFiles?: string[]; succMap?: Record<string, unknown> }>(
          "/api/asset/upload",
          form
        );
        const succMap = Object.fromEntries(
          Object.entries(data.succMap ?? {}).map(([key, value]) => [key, String(value)])
        );
        const assets = snippetsFromSuccMap(succMap, originalNames);
        const generatedMarkdown = joinedAssetMarkdown(assets);
        let insertedBlockId: string | null = null;
        let operationIds: string[] = [];
        if (insertAfterUpload && assets.length > 0) {
          const inserted = await insertMarkdownBlock(client, generatedMarkdown, anchors);
          insertedBlockId = inserted.insertedBlockId;
          operationIds = inserted.operationIds;
        }

        return toolResult({
          count: files.length,
          uploadedCount: assets.length,
          errFiles: data.errFiles ?? [],
          succMap,
          assets,
          generatedMarkdown,
          inserted: insertedBlockId !== null,
          insertedBlockId,
          operationIds,
          uploadContextId: docId ?? parentID ?? previousID ?? nextID ?? null,
          assetsDirPath: assetsDirPath ?? null,
        });
      } catch (err) {
        return toolError(`siyuan_upload_assets failed: ${String(err)}`);
      }
    }
  );

  const ImportLocalAssetsInputSchema = z
    .object({
      docId: idSchema.describe("Document/block ID used by SiYuan to choose the document asset folder."),
      assetPaths: z
        .array(z.string().min(1).max(4096))
        .min(1)
        .max(100)
        .describe("Paths on the SiYuan kernel machine."),
      isUpload: z
        .boolean()
        .default(true)
        .describe("true copies files into assets; false keeps file:// links. Directories are linked."),
      insertAfterImport: z.boolean().default(false),
      ...AnchorSchema,
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_import_local_assets",
      title: "Import SiYuan local assets",
      description:
        "Ask the SiYuan kernel to import or link files already visible to the kernel machine via /api/asset/insertLocalAssets. This avoids streaming large videos/audio through MCP. Optionally insert generated asset blocks.",
      inputSchema: ImportLocalAssetsInputSchema,
      outputSchema: z
        .object({
          docId: z.string(),
          count: z.number(),
          importedCount: z.number(),
          isUpload: z.boolean(),
          succMap: z.record(z.string()),
          assets: z.array(AssetSnippetSchema),
          generatedMarkdown: z.string(),
          inserted: z.boolean(),
          insertedBlockId: z.string().nullable(),
          operationIds: z.array(z.string()),
        })
        .strict(),
      annotations: WRITE_EXTERNAL,
    },
    async ({ docId, assetPaths, isUpload, insertAfterImport, previousID, nextID, parentID }) => {
      try {
        const anchors = { previousID, nextID, parentID };
        if (insertAfterImport) requireSingleAnchor(anchors);
        const data = await client.request<{ succMap?: Record<string, unknown> }>(
          "/api/asset/insertLocalAssets",
          {
            id: docId,
            assetPaths,
            isUpload,
          }
        );
        const succMap = Object.fromEntries(
          Object.entries(data.succMap ?? {}).map(([key, value]) => [key, String(value)])
        );
        const orderedNames = assetPaths.map((assetPath) => path.basename(assetPath));
        const assets = snippetsFromSuccMap(succMap, orderedNames);
        const generatedMarkdown = joinedAssetMarkdown(assets);
        let insertedBlockId: string | null = null;
        let operationIds: string[] = [];
        if (insertAfterImport && assets.length > 0) {
          const inserted = await insertMarkdownBlock(client, generatedMarkdown, anchors);
          insertedBlockId = inserted.insertedBlockId;
          operationIds = inserted.operationIds;
        }
        return toolResult({
          docId,
          count: assetPaths.length,
          importedCount: assets.length,
          isUpload,
          succMap,
          assets,
          generatedMarkdown,
          inserted: insertedBlockId !== null,
          insertedBlockId,
          operationIds,
        });
      } catch (err) {
        return toolError(`siyuan_import_local_assets failed: ${String(err)}`);
      }
    }
  );

  const InsertAssetBlocksInputSchema = z
    .object({
      assets: z
        .array(
          z
            .object({
              path: z.string().min(1).max(4096).describe("assets/... path, / path, file:// URL, or http(s) URL."),
              name: z.string().min(1).max(300).optional(),
              title: z.string().min(1).max(300).optional(),
              kind: AssetKindSchema.optional(),
            })
            .strict()
        )
        .min(1)
        .max(50),
      ...AnchorSchema,
    })
    .strict();

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_insert_asset_blocks",
      title: "Insert SiYuan asset blocks",
      description:
        "Insert existing assets or external media links as SiYuan-friendly image, audio, video, or file blocks. Use after siyuan_upload_assets or siyuan_import_local_assets, or with an existing assets/... path.",
      inputSchema: InsertAssetBlocksInputSchema,
      outputSchema: z
        .object({
          count: z.number(),
          assets: z.array(AssetSnippetSchema),
          generatedMarkdown: z.string(),
          insertedBlockId: z.string(),
          operationIds: z.array(z.string()),
        })
        .strict(),
      annotations: WRITE_EXTERNAL,
    },
    async ({ assets, previousID, nextID, parentID }) => {
      try {
        const snippets = assets.map((asset) =>
          assetSnippet(asset.path, asset.name || filenameFromSource(asset.path), asset.kind, asset.title)
        );
        const generatedMarkdown = joinedAssetMarkdown(snippets);
        const inserted = await insertMarkdownBlock(client, generatedMarkdown, { previousID, nextID, parentID });
        return toolResult({
          count: snippets.length,
          assets: snippets,
          generatedMarkdown,
          ...inserted,
        });
      } catch (err) {
        return toolError(`siyuan_insert_asset_blocks failed: ${String(err)}`);
      }
    }
  );

  registerSiyuanTool(
    server,
    options,
    {
      name: "siyuan_insert_slash_block",
      title: "Insert SiYuan slash block",
      description:
        "Insert a high-level block matching common SiYuan slash-menu items: image/audio/video/file links, iframe, widget, HTML, code, math, callout, table, ABC, ECharts, FlowChart, Graphviz, Mermaid, Mind map, and PlantUML.",
      inputSchema: SlashBlockInputSchema,
      outputSchema: z
        .object({
          kind: z.string(),
          generatedMarkdown: z.string(),
          insertedBlockId: z.string(),
          operationIds: z.array(z.string()),
        })
        .strict(),
      annotations: WRITE_EXTERNAL,
    },
    async (params) => {
      try {
        const generatedMarkdown = buildSlashMarkdown(params);
        const inserted = await insertMarkdownBlock(client, generatedMarkdown, params);
        return toolResult({
          kind: params.kind,
          generatedMarkdown,
          ...inserted,
        });
      } catch (err) {
        return toolError(`siyuan_insert_slash_block failed: ${String(err)}`);
      }
    }
  );
}
