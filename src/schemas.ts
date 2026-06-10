import { z } from "zod";
import { MAX_CONTENT_LENGTH, SIYUAN_ID_PATTERN } from "./format.js";

export const EmptyInputSchema = z.object({}).strict();

export const idSchema = z
  .string()
  .regex(SIYUAN_ID_PATTERN, "Invalid SiYuan ID format (expected YYYYMMDDHHmmss-xxxxxxx)");

export const notebookIdSchema = idSchema.describe("SiYuan notebook ID");

export const markdownSchema = z
  .string()
  .min(1)
  .max(MAX_CONTENT_LENGTH)
  .describe("Raw GFM Markdown content.");

export const limitSchema = z.number().int().min(1).max(1000).default(50);
export const offsetSchema = z.number().int().min(0).default(0);
export const pageSchema = z.number().int().min(1).default(1);
export const pageSizeSchema = z.number().int().min(1).max(200).default(20);

export const NotebookSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional().default(""),
  sort: z.number().optional().default(0),
  closed: z.boolean().optional().default(false),
});

export const BlockSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  subType: z.string().optional(),
  content: z.string().optional().default(""),
  box: z.string().optional().default(""),
  hpath: z.string().optional().default(""),
  parent_id: z.string().optional().default(""),
  root_id: z.string().optional().default(""),
  created: z.string().optional().default(""),
  updated: z.string().optional().default(""),
});

export const ChildBlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  subType: z.string().optional(),
});

export const PaginationSchema = z.object({
  count: z.number(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  total: z.number().optional(),
  hasMore: z.boolean(),
  nextOffset: z.number().nullable().optional(),
  nextPage: z.number().nullable().optional(),
});

export const TruncationSchema = z.object({
  truncated: z.boolean(),
  originalLength: z.number(),
  returnedLength: z.number(),
});

export const UnknownRecordSchema = z.record(z.unknown());
export const UnknownArraySchema = z.array(z.unknown());

export type Notebook = z.infer<typeof NotebookSchema>;
export type BlockSummary = z.infer<typeof BlockSummarySchema>;
