# siyuan-agent-mcp

MCP server for [SiYuan Note](https://github.com/siyuan-note/siyuan) — enables AI clients to read and write notes via the SiYuan HTTP API.

## Requirements

- Node.js >= 18
- SiYuan Note running with HTTP API enabled
- SiYuan API token (found in SiYuan under **Settings → About → API token**)

## Setup

```bash
npm install
npm run build
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SIYUAN_API_URL` | `http://127.0.0.1:6806` | SiYuan kernel API base URL |
| `SIYUAN_API_TOKEN` | _(required)_ | API token from SiYuan Settings → About |

## Tools

| Tool | Description |
|---|---|
| `search_notes` | Full-text search across note content |
| `search_blocks` | List blocks filtered by type |
| `get_block` | Get block details and kramdown source |
| `insert_block` | Insert a new block under a parent |
| `update_block` | Update block content |
| `delete_block` | Delete a block |
| `list_docs` | List the document tree grouped by notebook |
| `create_doc` | Create a new document in a notebook |

## Configuration Examples

### Claude Code

Add to your Claude Code `settings.json` (`~/.claude/settings.json`) or project `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": ["siyuan-agent-mcp"],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

### OpenCode

Add to your OpenCode `opencode.json`:

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": ["siyuan-agent-mcp"],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP config (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": ["siyuan-agent-mcp"],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

## License

MIT
