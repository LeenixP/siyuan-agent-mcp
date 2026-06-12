# siyuan-agent-mcp

[![npm version](https://img.shields.io/npm/v/siyuan-agent-mcp.svg)](https://www.npmjs.com/package/siyuan-agent-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-4f46e5)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

面向 [SiYuan 笔记](https://github.com/siyuan-note/siyuan) 的高质量 MCP Server。它让 Claude Code、OpenCode、Cursor 等 MCP 客户端通过 SiYuan HTTP Kernel API 安全地读取、搜索、写入和整理你的本地笔记工作空间。

[English documentation](./README_EN.md) · [Release notes](./releases/v3.1.6.md) · [npm package](https://www.npmjs.com/package/siyuan-agent-mcp)

## 你可以用它做什么

| 场景 | 可以交给 MCP 客户端完成 |
|---|---|
| 搜索和问答 | 按关键词、查询语法或正则搜索笔记，读取文档、块、大纲、反链和上下文 |
| 整理知识库 | 批量移动文档、重命名文档、检查失效引用、发现未使用或缺失资产 |
| 写入和修订 | 创建文档、追加块、更新块、批量插入、批量更新，并在写入后立即刷新索引 |
| 日记和 inbox | 自动创建当天日记，将临时想法、会议纪要、任务或阅读摘录追加到日记 |
| 斜杠菜单富内容 | 上传或导入资源，插入图片、文件、音频、视频、iframe、HTML、公式、表格、callout 和图表代码块 |
| 安全分析 | 使用受限 SQL 或结构化 blocks 查询做只读分析，默认限制结果规模和危险语句 |
| 受控接入 | 只读模式、危险工具默认隐藏、删除操作强制确认，适合长期挂在 MCP 客户端里使用 |

## 5 分钟接入

### 1. 准备 SiYuan

先确认 SiYuan 正在运行，然后在 SiYuan 中复制 API token：

```text
设置 -> 关于 -> API token
```

用 token 验证本机可以访问 Kernel API：

```bash
export SIYUAN_API_TOKEN="your-api-token-here"
curl -H "Authorization: Token $SIYUAN_API_TOKEN" http://127.0.0.1:6806/api/system/version
```

如果你只是第一次试用，建议先设置 `SIYUAN_READ_ONLY=true`，确认连接和搜索正常后再打开写权限。

### 2. 配置 MCP 客户端

多数用户不需要克隆本仓库，直接让客户端通过 `npx` 启动即可。

<details open>
<summary><strong>Claude Code</strong></summary>

添加到 `~/.claude/settings.json`，或项目级 `.claude/settings.local.json`：

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
        "SIYUAN_READ_ONLY": "true"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

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
        "SIYUAN_READ_ONLY": "true"
      }
    }
  }
}
```

</details>

### 3. 第一次验证

重启或刷新 MCP 客户端后，按这个顺序调用工具：

| 步骤 | 工具 | 期望结果 |
|---|---|---|
| 1 | `siyuan_health` | 返回 Kernel 版本、模式、启动进度和笔记本可访问状态 |
| 2 | `siyuan_list_notebooks` | 能看到已打开的笔记本 ID 和名称 |
| 3 | `siyuan_search_notes` | 能按关键词搜到已有笔记 |
| 4 | `siyuan_read_workspace_overview` | 返回最近文档和最近更新块 |

验证读能力正常后，如果需要写入，把配置里的 `SIYUAN_READ_ONLY` 改为 `false` 并重启客户端。

## 常用任务速查

| 你想做的事 | 推荐工具组合 |
|---|---|
| 找一篇笔记 | `siyuan_search_notes` -> `siyuan_read_doc` |
| 了解一篇文档结构 | `siyuan_get_doc_outline` -> `siyuan_get_backlinks` -> `siyuan_get_doc_assets` |
| 围绕某个块继续阅读 | `siyuan_get_block` -> `siyuan_get_block_breadcrumb` -> `siyuan_get_child_blocks` |
| 创建结构化文档 | `siyuan_create_doc`，传入多行 Markdown；文档标签用 `tags` 参数 |
| 在文档末尾追加内容 | `siyuan_append_block` |
| 批量插入多段内容 | `siyuan_batch_insert_blocks` |
| 修订一段或多段内容 | `siyuan_update_block` 或 `siyuan_batch_update_blocks`，普通块的多块 Markdown 会保留首块并把后续块插入到目标块之后 |
| 删除内容 | `siyuan_delete_block` 或 `siyuan_remove_doc`，必须提供匹配的 `confirmId` |
| 记录到当天日记 | `siyuan_append_daily_note_block` |
| 查标签、书签和资产 | `siyuan_list_tags`、`siyuan_list_bookmarks`、`siyuan_search_assets` |
| 上传并插入图片/资源 | 小文件用 `siyuan_upload_assets`；大音视频或本机路径用 `siyuan_import_local_assets`；已有资源路径用 `siyuan_insert_asset_blocks` |
| 插入斜杠菜单内容 | `siyuan_insert_slash_block`，支持 image/audio/video/file/iframe/widget/html/code/math/callout/table/mermaid/plantuml 等 |
| 做只读统计分析 | 优先 `siyuan_query_blocks`，高级场景再用 `siyuan_sql_query` |

## 关键设计

| 设计点 | 说明 |
|---|---|
| MCP 友好的工具命名 | v3 起所有工具使用 `siyuan_*` 前缀，避免和其他 MCP Server 冲突 |
| 结构化输出 | 工具返回文本摘要和 typed structured content，方便客户端稳定解析 |
| 写入后可读 | 写入工具返回前会刷新 SiYuan transaction，减少“刚写完搜不到”的问题 |
| Markdown 保护 | 写入工具会把字面量 `\n` 转成真实换行；`siyuan_create_doc` 会抽取误放在正文里的 front matter/tag-only 行，避免元数据变成可见内容 |
| 资源写入工作流 | 支持 multipart 上传、内核本地路径导入、上传后自动插入，并返回可复用的 Markdown 片段 |
| 斜杠菜单语义工具 | 把 SiYuan `/` 菜单中的图片、音视频、iframe、HTML、公式、callout 和图表类内容提升为显式 MCP 工具 |
| 只读优先 | `SIYUAN_READ_ONLY=true` 会从工具列表中移除所有写入和状态变更工具 |
| 危险工具隐藏 | 删除笔记本等高风险工具默认不暴露，需要显式开启 |
| 删除强确认 | 删除块、删除文档、删除笔记本都需要匹配的确认参数 |
| SQL 有边界 | 只允许单条 `SELECT`，必须带数字 `LIMIT <= 1000`，并拒绝写入和 DDL 关键字 |

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

## MCP 资源

Server 注册了以下 URI 模板，客户端可以直接获取上下文：

| 资源 URI | 内容 |
|---|---|
| `siyuan://doc/{id}` | 文档 Markdown |
| `siyuan://block/{id}` | 块 kramdown |
| `siyuan://notebook/{id}` | 笔记本 JSON 元数据 |

## 工具目录

日常使用时优先看上面的“常用任务速查”。下面是完整工具清单，便于做客户端能力审计或排查。

<details>
<summary><strong>导航与搜索</strong></summary>

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

</details>

<details>
<summary><strong>读取与上下文</strong></summary>

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

</details>

<details>
<summary><strong>知识发现与资产</strong></summary>

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

</details>

<details>
<summary><strong>富内容与资源写入</strong></summary>

| 工具 | 说明 |
|---|---|
| `siyuan_upload_assets` | 通过 `/api/asset/upload` 上传本机小文件、base64 或文本内容；可在上传后直接插入生成的资源块 |
| `siyuan_import_local_assets` | 让 SiYuan Kernel 直接导入或链接其可访问的本地路径，适合大视频、大音频和目录 |
| `siyuan_insert_asset_blocks` | 将已有 `assets/...`、`file://` 或 http(s) 资源路径插入为图片、音频、视频或文件链接块 |
| `siyuan_insert_slash_block` | 插入常见 `/` 菜单内容：图片/文件/音频/视频链接、iframe、widget、HTML、代码块、数学公式、callout、表格、ABC、ECharts、FlowChart、Graphviz、Mermaid、Mind map、PlantUML |

</details>

<details>
<summary><strong>文档管理</strong></summary>

| 工具 | 说明 |
|---|---|
| `siyuan_create_doc` | 创建文档，支持嵌套路径、初始 Markdown 和 `tags` 文档标签；同路径已有文档时返回已有文档 |
| `siyuan_create_daily_note` | 创建或打开当天日记 |
| `siyuan_append_daily_note_block` | 创建或打开当天日记，并向末尾追加块 |
| `siyuan_prepend_daily_note_block` | 创建或打开当天日记，并向开头前置块 |
| `siyuan_duplicate_doc` | 按 ID 复制文档 |
| `siyuan_rename_doc` | 按 ID 重命名文档 |
| `siyuan_move_docs` | 将文档移动到父文档下或笔记本根目录 |
| `siyuan_remove_doc` | 删除文档及其子文档；必须提供 `confirmId` |

</details>

<details>
<summary><strong>块编辑</strong></summary>

| 工具 | 说明 |
|---|---|
| `siyuan_insert_block` | 在精确位置插入 Markdown 块 |
| `siyuan_append_block` | 将块追加为父块的最后一个子块 |
| `siyuan_prepend_block` | 将块前置为父块的第一个子块 |
| `siyuan_batch_insert_blocks` | 一次批量插入最多 50 个 Markdown 块；同父块插入会保持输入顺序 |
| `siyuan_update_block` | 用新的 Markdown 替换块内容；普通块的多块 Markdown 会把首块更新到原 ID，并将后续块插入到原块之后 |
| `siyuan_batch_update_blocks` | 一次批量替换最多 50 个块；普通块包含多块 Markdown 时会自动展开，避免后续块丢失 |
| `siyuan_delete_block` | 删除块及其子块；必须提供 `confirmId` |
| `siyuan_move_block` | 将块移动到新位置 |

</details>

<details>
<summary><strong>属性与笔记本</strong></summary>

| 工具 | 说明 |
|---|---|
| `siyuan_get_block_attrs` | 读取块属性 |
| `siyuan_batch_get_block_attrs` | 批量读取最多 100 个块的属性 |
| `siyuan_set_block_attrs` | 设置或移除属性，支持 `name`、`alias`、`memo`、`bookmark`、`tags` 和 `custom-*` |
| `siyuan_batch_set_block_attrs` | 批量设置或移除最多 100 个块的属性，支持规范化 `tags` |
| `siyuan_get_notebook_info` | 读取已打开笔记本的详细元数据 |
| `siyuan_create_notebook` | 创建笔记本 |
| `siyuan_rename_notebook` | 重命名笔记本 |
| `siyuan_set_notebook_icon` | 设置笔记本图标 |
| `siyuan_open_notebook` | 打开或挂载笔记本，使其文档可被索引 |
| `siyuan_close_notebook` | 关闭或卸载笔记本 |
| `siyuan_remove_notebook` | 删除笔记本；默认隐藏，只有 `SIYUAN_ENABLE_DANGEROUS_TOOLS=true` 时暴露，并且必须提供 `confirmId` 和 `confirmText` |

</details>

## 推荐工作流

```text
定位笔记
  -> siyuan_list_notebooks / siyuan_list_docs / siyuan_search_notes

理解上下文
  -> siyuan_get_doc_outline / siyuan_get_backlinks / siyuan_get_block_breadcrumb

读取内容
  -> siyuan_read_doc / siyuan_get_block / siyuan_batch_get_blocks / MCP resources

编辑整理
  -> siyuan_append_block / siyuan_insert_block / siyuan_update_block / batch tools / move tools

富内容写入
  -> siyuan_upload_assets / siyuan_import_local_assets / siyuan_insert_asset_blocks / siyuan_insert_slash_block

分析和归档
  -> siyuan_query_blocks / siyuan_sql_query / daily-note tools
```

重要行为：

- `siyuan_create_doc` 在目标可读路径已存在时不会创建同名重复文档，而是返回已有文档 ID，并设置 `existed=true`、`created=false`。
- `siyuan_create_doc` 的 `tags` 可传逗号字符串、字符串数组或 `#标签#` 形式；若初始 Markdown 顶部误带 YAML front matter 或纯标签行，会抽取 tags 并从正文移除。
- `siyuan_set_block_attrs` 和 `siyuan_batch_set_block_attrs` 支持 `tags` 属性，并会把 `#硬件# #上电测试#` 规范化为思源需要的 `硬件,上电测试`。
- `siyuan_insert_block` 必须且只能提供一个锚点：`previousID`、`nextID` 或 `parentID`。
- `siyuan_batch_insert_blocks` 对同一个 `parentID` 的 parentID-only 批量插入会在发送给 SiYuan 前反向提交，从而让最终文档顺序与输入顺序一致。
- `siyuan_upload_assets` 会把文件流经 MCP 进程，默认单文件上限 512MB；大文件优先用 `siyuan_import_local_assets` 让 SiYuan Kernel 直接复制。
- `siyuan_insert_slash_block` 使用 SiYuan 可解析的 Markdown/HTML 片段插入富内容，避免调用方手写 `<video>`、`<iframe>` 或图表代码块模板。
- `siyuan_remove_doc` 和 `siyuan_delete_block` 必须提供与目标 ID 相同的 `confirmId`。
- `siyuan_remove_notebook` 默认隐藏；启用需要 `SIYUAN_ENABLE_DANGEROUS_TOOLS=true`，每次调用还必须提供 `confirmId` 和精确 `confirmText`。
- 只有已打开笔记本中的文档会被搜索索引覆盖。

## 手工端到端检查

在 SiYuan 正在运行时执行：

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

建议按以下链路验证：

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
  -> siyuan_search_notes 确认已索引
  -> siyuan_delete_block with confirmId
  -> siyuan_remove_doc with confirmId
  -> siyuan_create_daily_note
  -> siyuan_append_daily_note_block
  -> siyuan_sql_query 拒绝 DELETE FROM blocks
```

## 常见问题

### `siyuan_health` 连接失败

先确认 SiYuan 正在运行，`SIYUAN_API_URL` 指向 Kernel API 地址，而不是普通网页地址。默认本机地址通常是 `http://127.0.0.1:6806`。

### 客户端看不到写入工具

检查 `SIYUAN_READ_ONLY` 是否为 `true`。只读模式会直接移除所有写入和状态变更工具。

### 搜索不到刚写入的内容

写入工具会刷新 transaction，但 SiYuan 索引仍可能短暂延迟。服务端默认会在索引中状态下等待 `SIYUAN_RETRY_INDEXING_MS` 后自动重试一次。

### SQL 被拒绝

`siyuan_sql_query` 只允许只读 `SELECT`，必须带数字 `LIMIT <= 1000`。写入、DDL、多语句或超大查询都会被拒绝。

### 删除工具调用失败

删除文档和块时，`confirmId` 必须和目标 ID 完全一致。删除笔记本还需要开启 `SIYUAN_ENABLE_DANGEROUS_TOOLS=true`，并提供精确的 `confirmText`。

## 本地开发

克隆仓库后执行：

```bash
npm install
npm run build
npm test
```

项目结构：

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
