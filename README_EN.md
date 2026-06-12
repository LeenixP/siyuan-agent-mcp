# siyuan-agent-mcp

[![npm version](https://img.shields.io/npm/v/siyuan-agent-mcp.svg)](https://www.npmjs.com/package/siyuan-agent-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-4f46e5)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

A high-quality MCP Server for [SiYuan Note](https://github.com/siyuan-note/siyuan). It lets MCP clients such as Claude Code, OpenCode, and Cursor safely read, search, write, and reorganize your local SiYuan workspace through the SiYuan HTTP Kernel API.

[中文文档](./README.md) · [Release notes](./releases/v3.1.5.md) · [npm package](https://www.npmjs.com/package/siyuan-agent-mcp)

## What Can It Do

| Scenario | What MCP clients can do |
|---|---|
| Search and Q&A | Search notes by keyword, query syntax, or regex; read documents, blocks, outlines, backlinks, and surrounding context |
| Knowledge-base cleanup | Move documents in batches, rename documents, check broken references, and find unused or missing assets |
| Writing and revision | Create documents, append blocks, update blocks, batch insert, batch update, and refresh the index immediately after writes |
| Daily notes and inbox | Create today's daily note automatically and append quick thoughts, meeting notes, tasks, or reading excerpts |
| Slash-menu rich content | Upload or import assets and insert images, files, audio, video, iframes, HTML, math, tables, callouts, and diagram code blocks |
| Safe analysis | Run bounded SQL or structured `blocks` queries for read-only analysis with default result limits and dangerous-statement guards |
| Controlled access | Keep the server mounted in MCP clients with read-only mode, hidden dangerous tools, and forced confirmation for deletes |

## 5-Minute Setup

### 1. Prepare SiYuan

Make sure SiYuan is running, then copy the API token from SiYuan:

```text
Settings -> About -> API token
```

Use the token to verify that the local Kernel API is reachable:

```bash
export SIYUAN_API_TOKEN="your-api-token-here"
curl -H "Authorization: Token $SIYUAN_API_TOKEN" http://127.0.0.1:6806/api/system/version
```

For a first trial, start with `SIYUAN_READ_ONLY=true`. After connection and search are confirmed, change it to `false` if you need write access.

### 2. Configure Your MCP Client

Most users do not need to clone this repository. Let your client start the server through `npx`.

<details open>
<summary><strong>Claude Code</strong></summary>

Add this to `~/.claude/settings.json`, or to project-level `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": ["-y", "siyuan-agent-mcp"],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_API_TOKEN": "your-api-token-here",
        "SIYUAN_READ_ONLY": "true"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>OpenCode</strong></summary>

Add this under the `mcp` key in `opencode.json`:

```json
{
  "mcp": {
    "siyuan": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "siyuan-agent-mcp"],
      "environment": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_API_TOKEN": "your-api-token-here",
        "SIYUAN_READ_ONLY": "true"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add this to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": ["-y", "siyuan-agent-mcp"],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_API_TOKEN": "your-api-token-here",
        "SIYUAN_READ_ONLY": "true"
      }
    }
  }
}
```

</details>

### 3. First Verification

After restarting or refreshing your MCP client, call these tools in order:

| Step | Tool | Expected result |
|---|---|---|
| 1 | `siyuan_health` | Returns Kernel version, modes, boot progress, and notebook access status |
| 2 | `siyuan_list_notebooks` | Shows open notebook IDs and names |
| 3 | `siyuan_search_notes` | Finds existing notes by keyword |
| 4 | `siyuan_read_workspace_overview` | Returns recent documents and recently updated blocks |

After read access works, set `SIYUAN_READ_ONLY` to `false` and restart the client if you need writes.

## Common Task Cheat Sheet

| What you want to do | Recommended tools |
|---|---|
| Find a note | `siyuan_search_notes` -> `siyuan_read_doc` |
| Understand a document structure | `siyuan_get_doc_outline` -> `siyuan_get_backlinks` -> `siyuan_get_doc_assets` |
| Continue reading around a block | `siyuan_get_block` -> `siyuan_get_block_breadcrumb` -> `siyuan_get_child_blocks` |
| Create a structured document | `siyuan_create_doc` with multi-line Markdown |
| Append content to the end of a document | `siyuan_append_block` |
| Insert multiple content blocks | `siyuan_batch_insert_blocks` |
| Revise one or more blocks | `siyuan_update_block` or `siyuan_batch_update_blocks`; regular-block multi-block Markdown keeps the first block on the target ID and inserts following blocks after it |
| Delete content | `siyuan_delete_block` or `siyuan_remove_doc`; both require a matching `confirmId` |
| Capture into today's daily note | `siyuan_append_daily_note_block` |
| Inspect tags, bookmarks, and assets | `siyuan_list_tags`, `siyuan_list_bookmarks`, `siyuan_search_assets` |
| Upload and insert images/assets | Use `siyuan_upload_assets` for small files; `siyuan_import_local_assets` for large media or kernel-local paths; `siyuan_insert_asset_blocks` for existing paths |
| Insert slash-menu content | `siyuan_insert_slash_block` supports image/audio/video/file/iframe/widget/html/code/math/callout/table/mermaid/plantuml and more |
| Run read-only statistics or analysis | Prefer `siyuan_query_blocks`; use `siyuan_sql_query` only for advanced bounded queries |

## Key Design Choices

| Design | Details |
|---|---|
| MCP-friendly tool names | Since v3, every tool uses the `siyuan_*` prefix to avoid collisions with other MCP servers |
| Structured output | Tools return both text summaries and typed structured content so clients can parse results reliably |
| Read-after-write behavior | Write tools flush SiYuan transactions before returning, reducing "written but not searchable yet" surprises |
| Markdown protection | Write tools convert literal `\n` into real line breaks when needed, so multi-line Markdown is not parsed as one line |
| Asset write workflows | Supports multipart upload, kernel-local path import, upload-then-insert, and reusable generated Markdown snippets |
| Slash-menu semantic tools | Promotes SiYuan `/` menu items such as image, audio/video, iframe, HTML, math, callout, and diagram blocks into explicit MCP tools |
| Read-only first | `SIYUAN_READ_ONLY=true` removes all write and state-changing tools from the exposed tool list |
| Dangerous tools hidden | High-risk tools such as notebook deletion are not exposed unless explicitly enabled |
| Strong delete confirmation | Block, document, and notebook deletes all require matching confirmation parameters |
| Bounded SQL | Only a single `SELECT` is allowed, numeric `LIMIT <= 1000` is required, and write/DDL keywords are rejected |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SIYUAN_API_URL` | `http://127.0.0.1:6806` | SiYuan Kernel API base URL |
| `SIYUAN_API_TOKEN` | Required | SiYuan API token |
| `SIYUAN_TIMEOUT_MS` | `30000` | Per-request timeout in milliseconds |
| `SIYUAN_MAX_CONCURRENCY` | `4` | Maximum concurrent requests sent to the SiYuan Kernel |
| `SIYUAN_RETRY_INDEXING_MS` | `1500` | Delay before one automatic retry when SiYuan reports indexing in progress; set `0` to disable |
| `SIYUAN_READ_ONLY` | `false` | If `true`, only read-only tools are registered |
| `SIYUAN_ENABLE_LEGACY_ALIASES` | `false` | If `true`, also registers pre-v3 tool names such as `read_doc` |
| `SIYUAN_ENABLE_SQL` | `true` | If `false`, hides the raw SQL query tool |
| `SIYUAN_ENABLE_DANGEROUS_TOOLS` | `false` | If `true`, exposes extra high-risk tools such as notebook deletion |

## MCP Resources

The server registers these URI templates so clients can fetch context directly:

| Resource URI | Content |
|---|---|
| `siyuan://doc/{id}` | Document Markdown |
| `siyuan://block/{id}` | Block kramdown |
| `siyuan://notebook/{id}` | Notebook JSON metadata |

## Tool Catalog

For day-to-day use, start with the "Common Task Cheat Sheet" above. The complete catalog below is useful for client capability audits and troubleshooting.

<details>
<summary><strong>Navigation & Search</strong></summary>

| Tool | Description |
|---|---|
| `siyuan_health` | Check Kernel reachability, version, boot progress, notebook access, and MCP modes |
| `siyuan_list_notebooks` | List all notebooks with IDs and open/closed state |
| `siyuan_list_docs` | List documents with filetree-first traversal and pagination |
| `siyuan_list_docs_by_path` | List direct child documents/files under a notebook path |
| `siyuan_get_doc_path` | Resolve a document or block ID to hpath, full hpath, and storage path |
| `siyuan_resolve_doc_path` | Resolve a notebook human-readable path to document IDs |
| `siyuan_search_notes` | Full-text search with keyword, query syntax, regex, type filters, and resource links |
| `siyuan_query_blocks` | Run a typed, bounded query over the `blocks` index |
| `siyuan_sql_query` | Bounded read-only SELECT query; requires numeric `LIMIT <= 1000` |

</details>

<details>
<summary><strong>Reading & Context</strong></summary>

| Tool | Description |
|---|---|
| `siyuan_read_doc` | Read document Markdown with truncation metadata |
| `siyuan_get_block` | Read a single block's kramdown, attributes, metadata, and warnings |
| `siyuan_batch_get_blocks` | Batch-read kramdown for up to 50 blocks |
| `siyuan_get_doc_outline` | Read the heading hierarchy of a document |
| `siyuan_get_doc_info` | Read SiYuan document metadata |
| `siyuan_get_backlinks` | Read backlinks and unlinked mentions with counts |
| `siyuan_get_child_blocks` | Read direct child blocks of a block |
| `siyuan_get_tail_child_blocks` | Read the last N direct child blocks of a block |
| `siyuan_get_block_breadcrumb` | Read the breadcrumb for a block |
| `siyuan_get_block_siblings` | Read parent, previous, and next block IDs |
| `siyuan_get_block_index` | Read a block's sibling index |
| `siyuan_get_ref_ids` | Read reference definitions and original reference block IDs |
| `siyuan_get_ref_text` | Read display text used for block references |
| `siyuan_check_block_exists` | Check whether a block exists |
| `siyuan_get_recent_docs` | Read recent documents from SiYuan storage |
| `siyuan_get_recent_updated_blocks` | Read recently updated blocks |
| `siyuan_get_tree_stat` | Read document/tree statistics |
| `siyuan_get_blocks_word_count` | Read word-count stats for blocks |
| `siyuan_read_workspace_overview` | Read a compact workspace overview |

</details>

<details>
<summary><strong>Knowledge Discovery & Assets</strong></summary>

| Tool | Description |
|---|---|
| `siyuan_list_tags` | List tags built by SiYuan |
| `siyuan_search_tags` | Search tag labels |
| `siyuan_list_bookmarks` | List bookmark groups |
| `siyuan_search_assets` | Search assets by filename |
| `siyuan_get_doc_assets` | List assets referenced by a document, optionally images only |
| `siyuan_get_missing_assets` | List missing asset references |
| `siyuan_get_unused_assets` | List unreferenced assets with client-side bounds |
| `siyuan_resolve_asset_path` | Resolve a workspace asset path to its local path |
| `siyuan_search_asset_content` | Full-text search indexed asset content |
| `siyuan_get_asset_content` | Read indexed content for a single asset |
| `siyuan_list_invalid_refs` | Find broken block references |

</details>

<details>
<summary><strong>Rich Content & Asset Writes</strong></summary>

| Tool | Description |
|---|---|
| `siyuan_upload_assets` | Upload local small files, base64 payloads, or text content through `/api/asset/upload`; can directly insert generated asset blocks after upload |
| `siyuan_import_local_assets` | Ask the SiYuan Kernel to import or link local paths it can access, suitable for large videos, large audio, and directories |
| `siyuan_insert_asset_blocks` | Insert existing `assets/...`, `file://`, or http(s) resource paths as image, audio, video, or file-link blocks |
| `siyuan_insert_slash_block` | Insert common `/` menu content: image/file/audio/video links, iframe, widget, HTML, code, math, callout, table, ABC, ECharts, FlowChart, Graphviz, Mermaid, Mind map, and PlantUML |

</details>

<details>
<summary><strong>Document Management</strong></summary>

| Tool | Description |
|---|---|
| `siyuan_create_doc` | Create a document with nested path and initial Markdown support; returns the existing document when the same path already exists |
| `siyuan_create_daily_note` | Create or open today's daily note |
| `siyuan_append_daily_note_block` | Create or open today's daily note and append a block |
| `siyuan_prepend_daily_note_block` | Create or open today's daily note and prepend a block |
| `siyuan_duplicate_doc` | Duplicate a document by ID |
| `siyuan_rename_doc` | Rename a document by ID |
| `siyuan_move_docs` | Move documents under a parent document or notebook root |
| `siyuan_remove_doc` | Delete a document and its child documents; requires `confirmId` |

</details>

<details>
<summary><strong>Block Editing</strong></summary>

| Tool | Description |
|---|---|
| `siyuan_insert_block` | Insert a Markdown block at an exact position |
| `siyuan_append_block` | Append a block as the last child of a parent |
| `siyuan_prepend_block` | Prepend a block as the first child of a parent |
| `siyuan_batch_insert_blocks` | Insert up to 50 Markdown blocks in one batch; same-parent inserts preserve input order |
| `siyuan_update_block` | Replace a block with new Markdown; regular-block multi-block Markdown updates the first block on the original ID and inserts following blocks after it |
| `siyuan_batch_update_blocks` | Replace up to 50 blocks; regular-block multi-block Markdown is expanded safely to avoid losing trailing blocks |
| `siyuan_delete_block` | Delete a block and its children; requires `confirmId` |
| `siyuan_move_block` | Move a block to a new position |

</details>

<details>
<summary><strong>Attributes & Notebooks</strong></summary>

| Tool | Description |
|---|---|
| `siyuan_get_block_attrs` | Read block attributes |
| `siyuan_batch_get_block_attrs` | Batch-read attributes for up to 100 blocks |
| `siyuan_set_block_attrs` | Set or remove attributes, including `name`, `alias`, `memo`, `bookmark`, and `custom-*` |
| `siyuan_batch_set_block_attrs` | Batch set or remove attributes for up to 100 blocks |
| `siyuan_get_notebook_info` | Read detailed metadata for an open notebook |
| `siyuan_create_notebook` | Create a notebook |
| `siyuan_rename_notebook` | Rename a notebook |
| `siyuan_set_notebook_icon` | Set a notebook icon |
| `siyuan_open_notebook` | Open or mount a notebook so its documents can be indexed |
| `siyuan_close_notebook` | Close or unmount a notebook |
| `siyuan_remove_notebook` | Delete a notebook; hidden by default, exposed only when `SIYUAN_ENABLE_DANGEROUS_TOOLS=true`, and requires both `confirmId` and `confirmText` |

</details>

## Recommended Workflow

```text
Locate notes
  -> siyuan_list_notebooks / siyuan_list_docs / siyuan_search_notes

Understand context
  -> siyuan_get_doc_outline / siyuan_get_backlinks / siyuan_get_block_breadcrumb

Read content
  -> siyuan_read_doc / siyuan_get_block / siyuan_batch_get_blocks / MCP resources

Edit and organize
  -> siyuan_append_block / siyuan_insert_block / siyuan_update_block / batch tools / move tools

Write rich content
  -> siyuan_upload_assets / siyuan_import_local_assets / siyuan_insert_asset_blocks / siyuan_insert_slash_block

Analyze and archive
  -> siyuan_query_blocks / siyuan_sql_query / daily-note tools
```

Important behavior:

- `siyuan_create_doc` does not create same-name duplicate documents when the target human-readable path already exists. It returns the existing document ID with `existed=true` and `created=false`.
- `siyuan_insert_block` requires exactly one anchor: `previousID`, `nextID`, or `parentID`.
- `siyuan_batch_insert_blocks` reverses same-parent parentID-only batches before sending them to SiYuan so the final document order matches the input order.
- `siyuan_upload_assets` streams files through the MCP process and defaults to a 512MB per-file cap; use `siyuan_import_local_assets` for large files so the SiYuan Kernel copies them directly.
- `siyuan_insert_slash_block` inserts rich content with SiYuan-parseable Markdown/HTML snippets so callers do not need to handwrite `<video>`, `<iframe>`, or diagram templates.
- `siyuan_remove_doc` and `siyuan_delete_block` require `confirmId` equal to the target ID.
- `siyuan_remove_notebook` is hidden by default. Enabling it requires `SIYUAN_ENABLE_DANGEROUS_TOOLS=true`, and each call must provide both `confirmId` and exact `confirmText`.
- Only documents in open notebooks are covered by the search index.

## Manual End-To-End Check

Run this while SiYuan is running:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Suggested validation chain:

```text
siyuan_health
  -> siyuan_list_notebooks
  -> siyuan_list_docs
  -> siyuan_search_notes
  -> siyuan_read_doc
  -> siyuan_get_doc_outline / siyuan_get_backlinks
  -> siyuan_create_doc
  -> siyuan_append_block
  -> siyuan_insert_slash_block kind=mermaid
  -> siyuan_upload_assets insertAfterUpload=true
  -> siyuan_batch_update_blocks
  -> siyuan_search_notes confirms indexing
  -> siyuan_delete_block with confirmId
  -> siyuan_remove_doc with confirmId
  -> siyuan_create_daily_note
  -> siyuan_append_daily_note_block
  -> siyuan_sql_query rejects DELETE FROM blocks
```

## FAQ

### `siyuan_health` cannot connect

Make sure SiYuan is running and `SIYUAN_API_URL` points to the Kernel API address, not the normal web UI address. The default local address is usually `http://127.0.0.1:6806`.

### Write tools are missing in the client

Check whether `SIYUAN_READ_ONLY` is `true`. Read-only mode removes all write and state-changing tools from the exposed tool list.

### Newly written content cannot be searched

Write tools flush the transaction, but SiYuan indexing can still lag briefly. By default, the server retries once after `SIYUAN_RETRY_INDEXING_MS` when SiYuan reports indexing in progress.

### SQL is rejected

`siyuan_sql_query` only allows read-only `SELECT` statements and requires a numeric `LIMIT <= 1000`. Writes, DDL, multi-statements, and oversized queries are rejected.

### Delete tools fail

When deleting a document or block, `confirmId` must exactly match the target ID. Notebook deletion also requires `SIYUAN_ENABLE_DANGEROUS_TOOLS=true` and exact `confirmText`.

## Local Development

After cloning the repository, run:

```bash
npm install
npm run build
npm test
```

Project structure:

```text
src/
  index.ts            # assemble server, register tools, connect stdio
  config.ts           # environment parsing and validation
  client.ts           # SiYuanClient: auth, error handling, flushTransaction
  types.ts            # SiYuan data structures
  schemas.ts          # shared Zod schemas
  format.ts           # ID validation, response formatting, escaping, truncation
  tooling.ts          # tool registration helpers and annotations
  resources.ts        # MCP resource templates
  tools/              # modules split by tool group
test/                 # node --test unit and tool contract tests, run against dist/
evaluation/           # mcp-builder evaluation suite
```

## License

MIT
