# siyuan-agent-mcp

面向 [SiYuan 笔记](https://github.com/siyuan-note/siyuan) 的 MCP Server，让 Claude Code、OpenCode、Cursor 等 MCP 客户端可以通过 SiYuan HTTP API 读取、搜索、写入和整理笔记。

English documentation: [README_EN.md](./README_EN.md)

当前版本 3.1.1 聚焦生产级 MCP 使用体验：`siyuan_*` 工具命名、可选旧版别名、只读模式、受限 SQL、类型化结构输出、MCP 资源链接、更安全的写入确认、日记工作流、批量编辑、资产检查，以及对 SiYuan 原生导航、搜索、统计接口的更完整覆盖。

## 环境要求

- Node.js >= 18
- SiYuan 笔记正在运行，并启用 Kernel HTTP API
- SiYuan API token，可在 SiYuan 的 设置 -> 关于 -> API token 中获取

## 安装与构建

```bash
npm install
npm run build
npm test      # 运行单元测试套件
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
| `SIYUAN_ENABLE_LEGACY_ALIASES` | `false` | 设为 `true` 时同时注册 v3 之前的工具名，如 `read_doc` |
| `SIYUAN_ENABLE_SQL` | `true` | 设为 `false` 时隐藏原始 SQL 查询工具 |
| `SIYUAN_ENABLE_DANGEROUS_TOOLS` | `false` | 设为 `true` 时暴露额外高风险工具，如删除笔记本 |

## 工具能力

### 导航与搜索

| 工具 | 说明 |
|---|---|
| `siyuan_health` | 检查 Kernel 连通性、版本、启动进度、笔记本访问状态和 MCP 模式 |
| `siyuan_list_notebooks` | 列出所有笔记本，包括 ID 和打开/关闭状态 |
| `siyuan_list_docs` | 使用文档树优先的方式分页列出文档 |
| `siyuan_list_docs_by_path` | 按笔记本路径列出直接子文档或文件 |
| `siyuan_get_doc_path` | 根据文档或块 ID 获取可读路径、完整可读路径和存储路径 |
| `siyuan_resolve_doc_path` | 根据笔记本中的可读路径解析文档 ID |
| `siyuan_search_notes` | 全文搜索，支持关键词、查询语法、正则、类型过滤和资源链接 |
| `siyuan_query_blocks` | 对 `blocks` 索引执行类型化、受限查询 |
| `siyuan_sql_query` | 受限只读 SELECT 查询；必须带数字 `LIMIT <= 1000` |

### 读取

| 工具 | 说明 |
|---|---|
| `siyuan_read_doc` | 读取文档 Markdown，并返回截断元数据 |
| `siyuan_get_block` | 读取单个块的 kramdown、属性、元数据和警告信息 |
| `siyuan_batch_get_blocks` | 批量读取最多 50 个块的 kramdown |
| `siyuan_get_doc_outline` | 读取文档标题层级大纲 |
| `siyuan_get_doc_info` | 读取 SiYuan 文档元数据 |
| `siyuan_get_backlinks` | 读取反链和未链接提及，并返回数量 |
| `siyuan_get_child_blocks` | 读取一个块的直接子块 |
| `siyuan_get_tail_child_blocks` | 读取一个块最后 N 个直接子块 |
| `siyuan_get_block_breadcrumb` | 读取块面包屑 |
| `siyuan_get_block_siblings` | 读取块的父块、前一个块、后一个块 ID |
| `siyuan_get_block_index` | 读取块在同级中的索引 |
| `siyuan_get_ref_ids` | 读取引用定义和原始引用块 ID |
| `siyuan_get_ref_text` | 读取块引用显示文本 |
| `siyuan_check_block_exists` | 检查块是否存在 |
| `siyuan_get_recent_docs` | 读取 SiYuan 存储中的最近文档 |
| `siyuan_get_recent_updated_blocks` | 读取最近更新块 |
| `siyuan_get_tree_stat` | 读取文档树统计信息 |
| `siyuan_get_blocks_word_count` | 读取块字数统计 |
| `siyuan_read_workspace_overview` | 读取紧凑的工作区概览 |

### 知识发现

| 工具 | 说明 |
|---|---|
| `siyuan_list_tags` | 列出 SiYuan 构建的标签 |
| `siyuan_search_tags` | 搜索标签名称 |
| `siyuan_list_bookmarks` | 列出书签分组 |
| `siyuan_search_assets` | 按文件名搜索资产 |
| `siyuan_get_doc_assets` | 列出文档引用的资产，可选择只返回图片 |
| `siyuan_get_missing_assets` | 列出缺失资产引用 |
| `siyuan_get_unused_assets` | 列出未引用资产，并在客户端侧做数量限制 |
| `siyuan_resolve_asset_path` | 将工作空间资产路径解析为本地路径 |
| `siyuan_search_asset_content` | 全文搜索已索引的资产内容 |
| `siyuan_get_asset_content` | 读取单个资产的已索引内容 |
| `siyuan_list_invalid_refs` | 查找失效块引用 |

### 文档管理

| 工具 | 说明 |
|---|---|
| `siyuan_create_doc` | 创建文档，支持嵌套路径和初始 Markdown；同路径已有文档时返回已有文档 |
| `siyuan_create_daily_note` | 创建或打开当天日记 |
| `siyuan_append_daily_note_block` | 创建或打开当天日记，并向末尾追加块 |
| `siyuan_prepend_daily_note_block` | 创建或打开当天日记，并向开头前置块 |
| `siyuan_duplicate_doc` | 按 ID 复制文档 |
| `siyuan_rename_doc` | 按 ID 重命名文档 |
| `siyuan_move_docs` | 将文档移动到父文档下或笔记本根目录 |
| `siyuan_remove_doc` | 删除文档及其子文档；必须提供 `confirmId` |

### 块编辑

| 工具 | 说明 |
|---|---|
| `siyuan_insert_block` | 在精确位置插入 Markdown 块 |
| `siyuan_append_block` | 将块追加为父块的最后一个子块 |
| `siyuan_prepend_block` | 将块前置为父块的第一个子块 |
| `siyuan_batch_insert_blocks` | 一次批量插入最多 50 个 Markdown 块；同父块插入会保持输入顺序 |
| `siyuan_update_block` | 用新的 Markdown 替换块内容 |
| `siyuan_batch_update_blocks` | 一次批量替换最多 50 个块 |
| `siyuan_delete_block` | 删除块及其子块；必须提供 `confirmId` |
| `siyuan_move_block` | 将块移动到新位置 |

### 属性与笔记本

| 工具 | 说明 |
|---|---|
| `siyuan_get_block_attrs` | 读取块属性 |
| `siyuan_batch_get_block_attrs` | 批量读取最多 100 个块的属性 |
| `siyuan_set_block_attrs` | 设置或移除属性，支持 `name`、`alias`、`memo`、`bookmark` 和 `custom-*` |
| `siyuan_batch_set_block_attrs` | 批量设置或移除最多 100 个块的属性 |
| `siyuan_get_notebook_info` | 读取已打开笔记本的详细元数据 |
| `siyuan_create_notebook` | 创建笔记本 |
| `siyuan_rename_notebook` | 重命名笔记本 |
| `siyuan_set_notebook_icon` | 设置笔记本图标 |
| `siyuan_open_notebook` | 打开或挂载笔记本，使其文档可被索引 |
| `siyuan_close_notebook` | 关闭或卸载笔记本 |
| `siyuan_remove_notebook` | 删除笔记本；默认隐藏，只有 `SIYUAN_ENABLE_DANGEROUS_TOOLS=true` 时暴露，并且必须提供 `confirmId` 和 `confirmText` |

## MCP 资源

Server 注册了以下 URI 模板，客户端可以直接获取上下文：

| 资源 URI | 内容 |
|---|---|
| `siyuan://doc/{id}` | 文档 Markdown |
| `siyuan://block/{id}` | 块 kramdown |
| `siyuan://notebook/{id}` | 笔记本 JSON 元数据 |

## 推荐工作流

这些工具可以组合使用。典型流程如下：

1. **定位**：使用 `siyuan_list_notebooks`、`siyuan_list_docs` 或 `siyuan_search_notes`。
2. **理解上下文**：使用 `siyuan_get_doc_outline`、`siyuan_get_backlinks`、`siyuan_get_block_breadcrumb`。
3. **读取**：使用 `siyuan_read_doc`、`siyuan_get_block`、`siyuan_batch_get_blocks` 或 MCP 资源。
4. **编辑**：简单追加用 `siyuan_append_block` 或 `siyuan_prepend_block`，精确位置用 `siyuan_insert_block`，多块变更用批量工具，修订内容用 `siyuan_update_block`，重组内容用 `siyuan_move_block` 或 `siyuan_move_docs`。
5. **分析**：优先使用 `siyuan_query_blocks`；只有高级只读查询场景才使用 `siyuan_sql_query`。
6. **记录**：日记和 inbox 场景使用 `siyuan_create_daily_note` 或 daily-note 块工具。

补充说明：

- 写入工具返回前会刷新 SiYuan transaction，因此写入后的读取和搜索能看到新数据。
- Markdown 写入工具会在输入没有真实换行时，将 `\n` 这类字面转义转换成真实换行，避免多行 Markdown 被 SiYuan 当成单行文本解析。
- `siyuan_create_doc` 在目标可读路径已存在时不会创建同名重复文档，而是返回已有文档 ID，并设置 `existed=true`、`created=false`。
- `siyuan_insert_block` 必须且只能提供一个锚点：`previousID`、`nextID` 或 `parentID`。
- `siyuan_batch_insert_blocks` 对同一个 `parentID` 的 parentID-only 批量插入会在发送给 SiYuan 前反向提交，从而让最终文档顺序与输入顺序一致。
- `siyuan_remove_doc` 和 `siyuan_delete_block` 必须提供与目标 ID 相同的 `confirmId`。
- `siyuan_remove_notebook` 默认隐藏；启用需要 `SIYUAN_ENABLE_DANGEROUS_TOOLS=true`，每次调用还必须提供 `confirmId` 和精确 `confirmText`。
- 只有已打开笔记本中的文档会被搜索索引覆盖。

## 安全策略

- `siyuan_read_doc` 和 `siyuan_get_block` 会截断超大内容，并返回截断元数据。
- `siyuan_sql_query` 强制只读，必须带数字 `LIMIT <= 1000`，并拒绝多语句和字符串字面量之外的写入关键字。
- 破坏性工具必须提供显式 `confirmId`，并标记 `destructiveHint`。
- `SIYUAN_READ_ONLY=true` 会从暴露的 MCP 工具列表中移除所有写入和状态变更工具。
- `SIYUAN_ENABLE_DANGEROUS_TOOLS=false` 会将删除笔记本等高风险工具从暴露的 MCP 工具列表中隐藏。
- 客户端会限制发往 Kernel 的并发请求，并在 SiYuan 报告索引中时自动重试一次。
- 远程非 HTTPS 的 `SIYUAN_API_URL` 会输出明文 token 风险警告，日志会隐藏 URL 中嵌入的凭据。

## 客户端配置示例

### Claude Code

添加到 `~/.claude/settings.json` 或项目级 `.claude/settings.local.json`：

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

添加到 `opencode.json` 的 `mcp` 字段下：

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

添加到 `~/.cursor/mcp.json`：

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

## 手工端到端检查

在 SiYuan 正在运行时执行：

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

建议按以下链路验证：

`siyuan_health` -> `siyuan_list_notebooks` -> `siyuan_list_docs` -> `siyuan_search_notes`（关键词和正则）-> `siyuan_read_doc` -> `siyuan_get_doc_outline` / `siyuan_get_backlinks` -> 写入链路（`siyuan_create_doc` -> `siyuan_append_block` -> `siyuan_batch_update_blocks` -> `siyuan_search_notes` 确认已索引 -> 带 `confirmId` 调用 `siyuan_delete_block` -> 带 `confirmId` 调用 `siyuan_remove_doc`）-> 日记链路（`siyuan_create_daily_note` -> `siyuan_append_daily_note_block`）-> 验证 `siyuan_sql_query` 会拒绝 `DELETE FROM blocks`。

## 开发结构

```text
src/
  index.ts            # 组装 server，注册工具，连接 stdio
  config.ts           # 环境变量解析与校验
  client.ts           # SiYuanClient：认证、错误处理、flushTransaction
  types.ts            # SiYuan 数据结构
  schemas.ts          # 共享 Zod schema
  format.ts           # ID 校验、响应格式化、转义、截断
  tooling.ts          # 工具注册辅助和 annotations
  resources.ts        # MCP resource templates
  tools/              # 按工具分组拆分模块
test/                 # node --test 单元测试和工具契约测试，针对 dist/ 运行
evaluation/           # mcp-builder 评估套件
```

## License

MIT
