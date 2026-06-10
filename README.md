# siyuan-agent-mcp

MCP server for [SiYuan Note](https://github.com/siyuan-note/siyuan) — enables AI clients (Claude Code, OpenCode, Cursor, …) to read, search, write, and reorganize notes through SiYuan's HTTP API.

Version 2.0 is a ground-up rewrite: 25 semantic tools backed by SiYuan's native search/outline/backlink engines, structured outputs, action-aware annotations, and a read-only SQL escape hatch.

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

## Tools

### Navigation & search
| Tool | Description |
|---|---|
| `list_notebooks` | List all notebooks with IDs and open/closed state |
| `list_docs` | List documents as a tree (one notebook or all) |
| `search_notes` | Full-text search (keyword / query-syntax / regex), type filter, paging, relevance ranking |
| `sql_query` | Read-only SELECT against SiYuan's SQLite index (escape hatch for advanced lookups) |

### Reading
| Tool | Description |
|---|---|
| `read_doc` | Read a document's **full Markdown** content |
| `get_block` | Single block detail: kramdown + attributes + metadata |
| `get_doc_outline` | Heading hierarchy of a document |
| `get_backlinks` | Backlinks and unlinked mentions for a block/document |
| `get_child_blocks` | Direct child blocks of a block |

### Document management
| Tool | Description |
|---|---|
| `create_doc` | Create a document (optionally nested, with initial Markdown) |
| `rename_doc` | Rename a document by ID |
| `move_docs` | Move documents under a parent doc or notebook root |
| `remove_doc` | Delete a document and its children (**destructive**) |

### Block editing
| Tool | Description |
|---|---|
| `insert_block` | Insert a Markdown block at a precise position (`previousID`/`nextID`/`parentID`) |
| `append_block` | Append a block as the last child of a parent |
| `prepend_block` | Prepend a block as the first child of a parent |
| `update_block` | Replace a block's content with new Markdown |
| `delete_block` | Delete a block and its children (**destructive**) |
| `move_block` | Move a block to a new position |

### Attributes & notebooks
| Tool | Description |
|---|---|
| `get_block_attrs` | Read a block's attributes |
| `set_block_attrs` | Set attributes (`name`/`alias`/`memo`/`bookmark` or `custom-*`) |
| `create_notebook` | Create a notebook |
| `rename_notebook` | Rename a notebook |
| `open_notebook` | Open (mount) a notebook so its docs are indexed |
| `close_notebook` | Close (unmount) a notebook (non-destructive) |

## Recommended workflow

The tools are designed to compose. A typical agent flow:

1. **Locate** — `list_notebooks` / `list_docs` to discover IDs, or `search_notes` to find content by keyword/regex.
2. **Orient** — `get_doc_outline` to see a document's structure, `get_backlinks` to see how it connects.
3. **Read** — `read_doc` for the whole note, or `get_block` / `get_child_blocks` to zoom into a section.
4. **Edit** — `append_block` / `prepend_block` for the simple cases, `insert_block` (with `previousID`/`nextID`/`parentID`) for precise placement, `update_block` to revise, `move_block` / `move_docs` to reorganize.
5. **Escape hatch** — `sql_query` for aggregations or filters the semantic tools don't cover.

Notes:
- Write tools flush SiYuan's transaction before returning, so a `search_notes` / `sql_query` immediately after a write sees the new data.
- `insert_block` / `append_block` / `prepend_block` take **raw Markdown** — pass real headings, lists, tables, code fences, math.
- Only documents in **open** notebooks are indexed by search and `list_docs`.

## Safety

- `read_doc` / `get_block` truncate very large content to protect the client context.
- `sql_query` is enforced read-only: it only accepts a single `SELECT` and rejects write/DDL keywords and multi-statements.
- `remove_doc` and `delete_block` are irreversible and annotated `destructiveHint`.
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
        "SIYUAN_API_TOKEN": "your-api-token-here"
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
        "SIYUAN_API_TOKEN": "your-api-token-here"
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
        "SIYUAN_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

## Manual end-to-end check (with a running SiYuan)

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Then exercise: `list_notebooks` → `list_docs` → `search_notes` (keyword + regex) → `read_doc` → `get_doc_outline` / `get_backlinks` → write chain (`create_doc` → `append_block` → `update_block` → `search_notes` confirms it's indexed → `delete_block` → `remove_doc`) → verify `sql_query` rejects `DELETE FROM blocks`.

## Development

```
src/
  index.ts            # assemble server, register tools, connect stdio
  config.ts           # env parsing & validation
  client.ts           # SiYuanClient: auth, errors, flushTransaction
  types.ts            # SiYuan data structures
  format.ts           # ID validation, response shaping, escaping, truncation
  tools/              # one module per tool group
test/                 # node --test unit suite (runs against dist/)
evaluation/           # mcp-builder evaluation suite
```

## License

MIT
