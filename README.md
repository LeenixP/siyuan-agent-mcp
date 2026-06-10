# siyuan-agent-mcp

MCP server for [SiYuan Note](https://github.com/siyuan-note/siyuan) — enables AI clients (Claude Code, OpenCode, Cursor, …) to read, search, write, and reorganize notes through SiYuan's HTTP API.

Version 3.0 focuses on production-grade MCP ergonomics: `siyuan_*` tool names, optional legacy aliases, read-only mode, bounded SQL, typed structured outputs, resource links, and broader coverage of SiYuan's native navigation/search/stat APIs.

## Requirements

- Node.js >= 18
- SiYuan Note running with the kernel HTTP API enabled
- SiYuan API token (in SiYuan under **Settings → About → API token**)

## Setup

```bash
npm install
npm run build
npm test      # runs the unit suite
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SIYUAN_API_URL` | `http://127.0.0.1:6806` | SiYuan kernel API base URL |
| `SIYUAN_API_TOKEN` | _(required)_ | API token from SiYuan Settings → About |
| `SIYUAN_TIMEOUT_MS` | `30000` | Per-request timeout in milliseconds |
| `SIYUAN_READ_ONLY` | `false` | If `true`, only read-only tools are registered |
| `SIYUAN_ENABLE_LEGACY_ALIASES` | `false` | If `true`, pre-v3 names like `read_doc` are also registered |
| `SIYUAN_ENABLE_SQL` | `true` | If `false`, hides the raw SQL escape hatch |

## Tools

### Navigation & search
| Tool | Description |
|---|---|
| `siyuan_health` | Check kernel reachability, version, boot progress, notebook access, and MCP modes |
| `siyuan_list_notebooks` | List all notebooks with IDs and open/closed state |
| `siyuan_list_docs` | List documents with filetree-first traversal and pagination |
| `siyuan_list_docs_by_path` | List direct child documents/files under a notebook path |
| `siyuan_search_notes` | Full-text search with keyword/query-syntax/regex, type filters, and resource links |
| `siyuan_query_blocks` | Typed, bounded query over the `blocks` index |
| `siyuan_sql_query` | Bounded read-only SELECT escape hatch; requires numeric `LIMIT <= 1000` |

### Reading
| Tool | Description |
|---|---|
| `siyuan_read_doc` | Read a document's Markdown content with truncation metadata |
| `siyuan_get_block` | Single block detail: kramdown + attributes + metadata + warnings |
| `siyuan_batch_get_blocks` | Batch-read kramdown for up to 50 blocks |
| `siyuan_get_doc_outline` | Heading hierarchy of a document |
| `siyuan_get_doc_info` | Document metadata from SiYuan |
| `siyuan_get_backlinks` | Backlinks and unlinked mentions with counts |
| `siyuan_get_child_blocks` | Direct child blocks of a block |
| `siyuan_get_block_breadcrumb` | Breadcrumb for a block |
| `siyuan_get_block_siblings` | Parent/previous/next block IDs |
| `siyuan_check_block_exists` | Check whether a block exists |
| `siyuan_get_recent_docs` | Recent documents from SiYuan storage |
| `siyuan_get_recent_updated_blocks` | Recently updated blocks |
| `siyuan_get_tree_stat` | Document/tree statistics |
| `siyuan_get_blocks_word_count` | Word-count stats for blocks |
| `siyuan_read_workspace_overview` | Compact workspace orientation |

### Knowledge discovery
| Tool | Description |
|---|---|
| `siyuan_list_tags` | List tags built by SiYuan |
| `siyuan_search_tags` | Search tag labels |
| `siyuan_list_bookmarks` | List bookmark groups |
| `siyuan_search_assets` | Search assets by filename |
| `siyuan_search_asset_content` | Full-text search indexed asset content |
| `siyuan_get_asset_content` | Read indexed content for an asset |
| `siyuan_list_invalid_refs` | Find broken block references |

### Document management
| Tool | Description |
|---|---|
| `siyuan_create_doc` | Create a document (optionally nested, with initial Markdown) |
| `siyuan_rename_doc` | Rename a document by ID |
| `siyuan_move_docs` | Move documents under a parent doc or notebook root |
| `siyuan_remove_doc` | Delete a document and its children; requires `confirmId` |

### Block editing
| Tool | Description |
|---|---|
| `siyuan_insert_block` | Insert a Markdown block at a precise position |
| `siyuan_append_block` | Append a block as the last child of a parent |
| `siyuan_prepend_block` | Prepend a block as the first child of a parent |
| `siyuan_update_block` | Replace a block's content with new Markdown |
| `siyuan_delete_block` | Delete a block and its children; requires `confirmId` |
| `siyuan_move_block` | Move a block to a new position |

### Attributes & notebooks
| Tool | Description |
|---|---|
| `siyuan_get_block_attrs` | Read a block's attributes |
| `siyuan_batch_get_block_attrs` | Batch-read attributes for up to 100 blocks |
| `siyuan_set_block_attrs` | Set/remove attributes (`name`/`alias`/`memo`/`bookmark` or `custom-*`) |
| `siyuan_create_notebook` | Create a notebook |
| `siyuan_rename_notebook` | Rename a notebook |
| `siyuan_open_notebook` | Open (mount) a notebook so its docs are indexed |
| `siyuan_close_notebook` | Close (unmount) a notebook |

## Resources

The server registers URI templates so clients can fetch context directly:

| Resource URI | Content |
|---|---|
| `siyuan://doc/{id}` | Document Markdown |
| `siyuan://block/{id}` | Block kramdown |
| `siyuan://notebook/{id}` | Notebook metadata JSON |

## Recommended workflow

The tools are designed to compose. A typical agent flow:

1. **Locate** — `siyuan_list_notebooks` / `siyuan_list_docs`, or `siyuan_search_notes`.
2. **Orient** — `siyuan_get_doc_outline`, `siyuan_get_backlinks`, `siyuan_get_block_breadcrumb`.
3. **Read** — `siyuan_read_doc`, `siyuan_get_block`, `siyuan_batch_get_blocks`, or MCP resources.
4. **Edit** — `siyuan_append_block` / `siyuan_prepend_block` for simple additions, `siyuan_insert_block` for exact placement, `siyuan_update_block` to revise, and `siyuan_move_block` / `siyuan_move_docs` to reorganize.
5. **Analyze** — prefer `siyuan_query_blocks`; use `siyuan_sql_query` only for bounded advanced read-only queries.

Notes:
- Write tools flush SiYuan's transaction before returning, so reads/search immediately after a write see the new data.
- `siyuan_insert_block` requires exactly one anchor: `previousID`, `nextID`, or `parentID`.
- `siyuan_remove_doc` and `siyuan_delete_block` require `confirmId` equal to the target ID.
- Only documents in **open** notebooks are indexed by search.

## Safety

- `siyuan_read_doc` / `siyuan_get_block` truncate very large content and return truncation metadata.
- `siyuan_sql_query` is enforced read-only, requires numeric `LIMIT <= 1000`, and rejects multi-statements/write keywords outside string literals.
- Destructive tools require explicit `confirmId` and are annotated `destructiveHint`.
- `SIYUAN_READ_ONLY=true` removes all write/state-changing tools from the exposed MCP tool list.
- A remote `SIYUAN_API_URL` without HTTPS logs a cleartext-token warning; credentials embedded in the URL are masked in logs.

## Configuration Examples

### Claude Code

Add to `~/.claude/settings.json` (or project `.claude/settings.local.json`):

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": ["-y", "siyuan-agent-mcp"],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_API_TOKEN": "your-api-token-here",
        "SIYUAN_READ_ONLY": "false"
      }
    }
  }
}
```

### OpenCode

Add to `opencode.json` under the `mcp` key:

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
        "SIYUAN_READ_ONLY": "false"
      }
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": ["-y", "siyuan-agent-mcp"],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_API_TOKEN": "your-api-token-here",
        "SIYUAN_READ_ONLY": "false"
      }
    }
  }
}
```

## Manual end-to-end check (with a running SiYuan)

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Then exercise: `siyuan_health` → `siyuan_list_notebooks` → `siyuan_list_docs` → `siyuan_search_notes` (keyword + regex) → `siyuan_read_doc` → `siyuan_get_doc_outline` / `siyuan_get_backlinks` → write chain (`siyuan_create_doc` → `siyuan_append_block` → `siyuan_update_block` → `siyuan_search_notes` confirms it's indexed → `siyuan_delete_block` with `confirmId` → `siyuan_remove_doc` with `confirmId`) → verify `siyuan_sql_query` rejects `DELETE FROM blocks`.

## Development

```
src/
  index.ts            # assemble server, register tools, connect stdio
  config.ts           # env parsing & validation
  client.ts           # SiYuanClient: auth, errors, flushTransaction
  types.ts            # SiYuan data structures
  schemas.ts          # shared Zod schemas
  format.ts           # ID validation, response shaping, escaping, truncation
  tooling.ts          # tool registration helpers and annotations
  resources.ts        # MCP resource templates
  tools/              # one module per tool group
test/                 # node --test unit suite (runs against dist/)
evaluation/           # mcp-builder evaluation suite
```

## License

MIT
