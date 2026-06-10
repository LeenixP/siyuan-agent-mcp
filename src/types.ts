// SiYuan data structures returned by the kernel HTTP API.

/** Standard envelope every SiYuan API endpoint returns. */
export interface SiYuanResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

/** A block row as stored in SiYuan's SQL index (see kernel/sql/block.go). */
export interface SiYuanBlock {
  id: string;
  type: string;
  subType?: string;
  content: string;
  markdown?: string;
  box: string;
  path: string;
  hpath: string;
  root_id: string;
  parent_id: string;
  name?: string;
  alias?: string;
  memo?: string;
  tag?: string;
  created: string;
  updated: string;
}

export interface SiYuanNotebook {
  id: string;
  name: string;
  icon: string;
  sort: number;
  closed: boolean;
}

/** Result shape of /api/search/fullTextSearchBlock. */
export interface FullTextSearchResult {
  blocks: SiYuanBlock[];
  matchedBlockCount: number;
  matchedRootCount: number;
  pageCount: number;
  docMode: boolean;
}

/** A node in /api/outline/getDocOutline. */
export interface OutlineItem {
  id: string;
  box: string;
  name: string;
  content: string;
  type: string;
  subType: string;
  depth: number;
  count: number;
  blocks?: OutlineItem[] | null;
  children?: OutlineItem[] | null;
}

/** Child block entry from /api/block/getChildBlocks. */
export interface ChildBlock {
  id: string;
  type: string;
  subType?: string;
}
