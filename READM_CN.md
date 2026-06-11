# siyuan-agent-mcp 中文文档

这是一个面向 SiYuan 笔记 HTTP Kernel API 的 MCP Server，可供 Claude Code、OpenCode、Cursor 等 MCP 客户端读取、搜索、写入和整理 SiYuan 工作空间。

## 环境要求

- Node.js >= 18
- SiYuan 笔记正在运行，并启用 Kernel HTTP API
- SiYuan API token，可在 SiYuan 的 设置 -> 关于 -> API token 中获取

## 安装与构建

```bash
npm install
npm run build
npm test
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SIYUAN_API_URL` | `http://127.0.0.1:6806` | SiYuan Kernel API 地址 |
| `SIYUAN_API_TOKEN` | 必填 | SiYuan API token |
| `SIYUAN_TIMEOUT_MS` | `30000` | 单次请求超时时间，单位毫秒 |
| `SIYUAN_MAX_CONCURRENCY` | `4` | 发往 SiYuan Kernel 的最大并发请求数 |
| `SIYUAN_RETRY_INDEXING_MS` | `1500` | SiYuan 返回索引中状态时，自动重试一次前等待的毫秒数；设为 `0` 可关闭 |
| `SIYUAN_READ_ONLY` | `false` | 设为 `true` 时只注册只读工具 |
| `SIYUAN_ENABLE_LEGACY_ALIASES` | `false` | 设为 `true` 时同时注册旧版工具名，如 `read_doc` |
| `SIYUAN_ENABLE_SQL` | `true` | 设为 `false` 时隐藏原始 SQL 查询工具 |
| `SIYUAN_ENABLE_DANGEROUS_TOOLS` | `false` | 设为 `true` 时暴露额外高风险工具，如删除笔记本 |

## 工具能力

### 导航与搜索

- `siyuan_health`：检查 Kernel 连通性、版本、启动进度和 MCP 模式
- `siyuan_list_notebooks`：列出笔记本
- `siyuan_list_docs`：按笔记本列出文档，优先使用文档树 API
- `siyuan_list_docs_by_path`：按存储路径列出直接子文档
- `siyuan_get_doc_path`：根据文档或块 ID 获取可读路径、完整可读路径和存储路径
- `siyuan_resolve_doc_path`：根据笔记本与可读路径解析文档 ID
- `siyuan_search_notes`：全文搜索笔记
- `siyuan_query_blocks`：结构化查询 blocks 索引
- `siyuan_sql_query`：受限只读 SQL 查询，必须带 `LIMIT <= 1000`

### 读取与上下文

- `siyuan_read_doc`：读取文档 Markdown，文本输出中直接包含正文，并返回截断元数据
- `siyuan_get_block`：读取单个块的 kramdown、属性和文档信息
- `siyuan_batch_get_blocks`：批量读取块
- `siyuan_get_doc_outline`：读取文档大纲
- `siyuan_get_doc_info`：读取文档信息
- `siyuan_get_backlinks`：读取反链和未链接提及
- `siyuan_get_child_blocks` / `siyuan_get_tail_child_blocks`：读取子块
- `siyuan_get_block_breadcrumb` / `siyuan_get_block_siblings` / `siyuan_get_block_index`：定位块上下文
- `siyuan_get_ref_ids` / `siyuan_get_ref_text`：读取块引用信息
- `siyuan_get_recent_docs` / `siyuan_get_recent_updated_blocks`：读取最近文档和最近更新块
- `siyuan_get_tree_stat` / `siyuan_get_blocks_word_count`：读取统计信息
- `siyuan_read_workspace_overview`：读取工作区概览

### 知识发现与资产

- `siyuan_list_tags` / `siyuan_search_tags`：列出或搜索标签
- `siyuan_list_bookmarks`：列出书签
- `siyuan_search_assets`：按文件名搜索资产
- `siyuan_get_doc_assets`：列出文档引用的资产，可只看图片
- `siyuan_get_missing_assets`：列出缺失资产
- `siyuan_get_unused_assets`：列出未引用资产
- `siyuan_resolve_asset_path`：解析资产本地路径
- `siyuan_search_asset_content`：搜索 OCR/PDF 等已索引资产内容
- `siyuan_get_asset_content`：读取单个资产索引内容
- `siyuan_list_invalid_refs`：列出失效块引用

### 文档管理

- `siyuan_create_doc`：创建文档，支持父文档、指定初始 Markdown、指定文档 ID；同路径已有文档时直接返回已有 ID
- `siyuan_create_daily_note`：创建或打开当天日记
- `siyuan_append_daily_note_block` / `siyuan_prepend_daily_note_block`：向当天日记追加或前置块
- `siyuan_duplicate_doc`：复制文档
- `siyuan_rename_doc`：重命名文档
- `siyuan_move_docs`：移动文档
- `siyuan_remove_doc`：删除文档，必须提供匹配的 `confirmId`

### 块编辑

- `siyuan_insert_block`：按 `previousID`、`nextID` 或 `parentID` 精确插入块
- `siyuan_append_block` / `siyuan_prepend_block`：追加或前置块
- `siyuan_batch_insert_blocks`：批量插入块；同一父块下的批量插入会保持输入顺序
- `siyuan_update_block` / `siyuan_batch_update_blocks`：更新一个或多个块
- `siyuan_delete_block`：删除块，必须提供匹配的 `confirmId`
- `siyuan_move_block`：移动块

### 属性与笔记本

- `siyuan_get_block_attrs` / `siyuan_batch_get_block_attrs`：读取块属性
- `siyuan_set_block_attrs` / `siyuan_batch_set_block_attrs`：设置或移除块属性
- `siyuan_get_notebook_info`：读取笔记本信息
- `siyuan_create_notebook` / `siyuan_rename_notebook`：创建或重命名笔记本
- `siyuan_set_notebook_icon`：设置笔记本图标
- `siyuan_open_notebook` / `siyuan_close_notebook`：打开或关闭笔记本
- `siyuan_remove_notebook`：删除笔记本，默认隐藏；需要 `SIYUAN_ENABLE_DANGEROUS_TOOLS=true`，并同时提供 `confirmId` 和精确 `confirmText`

## MCP 资源

| URI | 内容 |
|---|---|
| `siyuan://doc/{id}` | 文档 Markdown |
| `siyuan://block/{id}` | 块 kramdown |
| `siyuan://notebook/{id}` | 笔记本 JSON 元数据 |

## 推荐工作流

1. 定位：使用 `siyuan_list_notebooks`、`siyuan_list_docs` 或 `siyuan_search_notes`。
2. 理解上下文：使用 `siyuan_get_doc_outline`、`siyuan_get_backlinks`、`siyuan_get_block_breadcrumb`。
3. 读取：使用 `siyuan_read_doc`、`siyuan_get_block`、`siyuan_batch_get_blocks` 或 MCP 资源。
4. 编辑：简单追加用 append/prepend，精确位置用 insert，多块变更用 batch 工具，重组内容用 move 工具。
5. 分析：优先使用 `siyuan_query_blocks`，只有高级只读场景才使用 `siyuan_sql_query`。
6. 记录：日记和 inbox 场景使用 daily-note 工具。

补充说明：

- Markdown 写入工具会在输入没有真实换行时，将 `\n` 这类字面转义换成真实换行，避免多行 Markdown 被 SiYuan 当成单行文本解析。
- `siyuan_create_doc` 在目标可读路径已存在时不会创建同名重复文档，而是返回已有文档 ID，并设置 `existed=true`、`created=false`。
- `siyuan_batch_insert_blocks` 对同一个 `parentID` 的 parentID-only 批量插入会在发送给 SiYuan 前反向提交，从而让最终文档顺序与输入顺序一致。

## 安全策略

- 大文档和大块内容会截断，并返回截断元数据。
- `siyuan_sql_query` 只允许单条 `SELECT`，必须带数字 `LIMIT <= 1000`，并拒绝写入和 DDL 关键字。
- 删除文档和删除块必须提供与目标 ID 相同的 `confirmId`。
- `SIYUAN_READ_ONLY=true` 会从工具列表中移除所有写入和状态变更工具。
- `SIYUAN_ENABLE_DANGEROUS_TOOLS=false` 默认隐藏高风险工具。
- 客户端会限制并发请求，并在 SiYuan 报告索引中时自动重试一次。
- 远程非 HTTPS 的 `SIYUAN_API_URL` 会输出明文 token 风险警告，日志会隐藏 URL 中嵌入的凭据。

## 客户端配置示例

Claude Code:

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

OpenCode:

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

## 手工验收

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

建议按以下链路验证：

`siyuan_health` -> `siyuan_list_notebooks` -> `siyuan_list_docs` -> `siyuan_search_notes` -> `siyuan_read_doc` -> `siyuan_get_doc_outline` -> `siyuan_create_doc` -> `siyuan_append_block` -> `siyuan_batch_update_blocks` -> `siyuan_delete_block` -> `siyuan_remove_doc` -> `siyuan_create_daily_note` -> `siyuan_append_daily_note_block`。

## 开发结构

```text
src/
  index.ts
  config.ts
  client.ts
  types.ts
  schemas.ts
  format.ts
  tooling.ts
  resources.ts
  tools/
test/
evaluation/
```

## License

MIT
