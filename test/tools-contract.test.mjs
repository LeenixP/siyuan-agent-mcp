import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerKnowledgeTools } from "../dist/tools/knowledge.js";
import { registerDocTools } from "../dist/tools/docs.js";
import { registerBlockTools } from "../dist/tools/blocks.js";
import { registerAssetTools } from "../dist/tools/assets.js";
import { registerAttrTools } from "../dist/tools/attrs.js";

const options = {
  readOnlyMode: false,
  enableLegacyAliases: false,
  enableSql: true,
  enableDangerousTools: false,
};

class FakeClient {
  constructor(responses = []) {
    this.responses = [...responses];
    this.calls = [];
  }

  async request(endpoint, body) {
    this.calls.push({ endpoint, body });
    if (this.responses.length === 0) {
      throw new Error(`No fake response queued for ${endpoint}`);
    }
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return typeof response === "function" ? response(endpoint, body) : response;
  }

  async requestForm(endpoint, form) {
    this.calls.push({ endpoint, form });
    if (this.responses.length === 0) {
      throw new Error(`No fake response queued for ${endpoint}`);
    }
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return typeof response === "function" ? response(endpoint, form) : response;
  }

  async flushTransaction() {
    this.calls.push({ endpoint: "/api/sqlite/flushTransaction", body: undefined });
  }
}

test("siyuan_search_asset_content uses SiYuan asset-content order codes", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const client = new FakeClient([{ assetContents: [], matchedAssetCount: 0, pageCount: 0 }]);
  registerKnowledgeTools(server, client, options);

  const tool = server._registeredTools.siyuan_search_asset_content;
  assert.equal(
    tool.inputSchema.safeParse({ query: "asset", orderBy: "createdAsc" }).success,
    false
  );

  const result = await tool.handler({
    query: "asset",
    method: "keyword",
    orderBy: "relevanceDesc",
    page: 1,
    pageSize: 20,
  });

  assert.equal(client.calls[0].endpoint, "/api/search/fullTextSearchAssetContent");
  assert.equal(client.calls[0].body.orderBy, 0);
  assert.equal(result.structuredContent.count, 0);
});

test("siyuan_create_doc creates with normalized markdown, parentID, and explicit id", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const docId = "20240101010101-abcdef0";
  const parentDocId = "20231224160424-2f5680o";
  const notebookId = "20210817205410-2kvfpfn";
  const client = new FakeClient(["/Parent", [], docId]);
  registerDocTools(server, client, options);

  const result = await server._registeredTools.siyuan_create_doc.handler({
    notebookId,
    title: "Child",
    parentDocId,
    docId,
    markdown: "# Heading\\n\\nBody",
  });

  assert.deepEqual(client.calls.slice(0, 3), [
    { endpoint: "/api/filetree/getHPathByID", body: { id: parentDocId } },
    { endpoint: "/api/filetree/getIDsByHPath", body: { notebook: notebookId, path: "/Parent/Child" } },
    {
      endpoint: "/api/filetree/createDocWithMd",
      body: {
        notebook: notebookId,
        path: "/Parent/Child",
        markdown: "# Heading\n\nBody",
        parentID: parentDocId,
        id: docId,
      },
    },
  ]);
  assert.equal(result.structuredContent.createdDocId, docId);
  assert.equal(result.structuredContent.existed, false);
  assert.equal(result.structuredContent.created, true);
});

test("siyuan_create_doc returns existing same-path document without creating duplicates", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const docId = "20240101010101-abcdef0";
  const notebookId = "20210817205410-2kvfpfn";
  const client = new FakeClient([[docId]]);
  registerDocTools(server, client, options);

  const result = await server._registeredTools.siyuan_create_doc.handler({
    notebookId,
    title: "Existing",
    markdown: "# New content that should not create a duplicate",
  });

  assert.deepEqual(client.calls, [
    { endpoint: "/api/filetree/getIDsByHPath", body: { notebook: notebookId, path: "/Existing" } },
  ]);
  assert.equal(result.structuredContent.createdDocId, docId);
  assert.equal(result.structuredContent.path, "/Existing");
  assert.equal(result.structuredContent.existed, true);
  assert.equal(result.structuredContent.created, false);
});

test("siyuan_create_doc extracts tags and removes visible front matter from markdown", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const docId = "20240101010101-abcdef0";
  const notebookId = "20210817205410-2kvfpfn";
  const client = new FakeClient([[], docId]);
  registerDocTools(server, client, options);

  const result = await server._registeredTools.siyuan_create_doc.handler({
    notebookId,
    title: "00-项目总览与当前状态",
    markdown: [
      "##泰山派# #RK3576# #in-cell# #MIPI-DSI#",
      "",
      "# 00-项目总览与当前状态",
      "",
      "---",
      "title: 00-项目总览与当前状态",
      "date: 2026-06-12T12:18:59+08:00",
      "tags:",
      "  - '#硬件 #上电测试 #TCA9554 #TPS65131'",
      "---",
      "",
      "项目目标",
    ].join("\n"),
  });

  assert.equal(client.calls[1].endpoint, "/api/filetree/createDocWithMd");
  assert.deepEqual(client.calls[1].body, {
    notebook: notebookId,
    path: "/00-项目总览与当前状态",
    markdown: "# 00-项目总览与当前状态\n\n项目目标",
    tags: "泰山派,RK3576,in-cell,MIPI-DSI,硬件,上电测试,TCA9554,TPS65131",
  });
  assert.deepEqual(result.structuredContent.tags, [
    "泰山派",
    "RK3576",
    "in-cell",
    "MIPI-DSI",
    "硬件",
    "上电测试",
    "TCA9554",
    "TPS65131",
  ]);
  assert.equal(result.structuredContent.metadataNormalized, true);
  assert.match(result.structuredContent.warnings[0], /Extracted document metadata/);
});

test("siyuan_create_doc normalizes explicit tag input", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const docId = "20240101010101-abcdef0";
  const notebookId = "20210817205410-2kvfpfn";
  const client = new FakeClient([[], docId]);
  registerDocTools(server, client, options);

  const result = await server._registeredTools.siyuan_create_doc.handler({
    notebookId,
    title: "Tagged",
    markdown: "Body",
    tags: ["#硬件#", "#上电测试#", "TCA9554"],
  });

  assert.equal(client.calls[1].body.tags, "硬件,上电测试,TCA9554");
  assert.deepEqual(result.structuredContent.tags, ["硬件", "上电测试", "TCA9554"]);
  assert.equal(result.structuredContent.metadataNormalized, true);
});

test("siyuan_batch_insert_blocks maps anchors and returns transaction IDs", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const parentID = "20210817205410-2kvfpfn";
  const insertedID = "20240101010101-abcdef0";
  const client = new FakeClient([
    [{ doOperations: [{ id: insertedID, action: "insert" }] }],
  ]);
  registerBlockTools(server, client, options);

  const result = await server._registeredTools.siyuan_batch_insert_blocks.handler({
    blocks: [{ parentID, markdown: "hello" }],
  });

  assert.equal(client.calls[0].endpoint, "/api/block/batchInsertBlock");
  assert.deepEqual(client.calls[0].body, {
    blocks: [
      {
        dataType: "markdown",
        data: "hello",
        previousID: "",
        nextID: "",
        parentID,
      },
    ],
  });
  assert.deepEqual(result.structuredContent.insertedBlockIds, [insertedID]);
  assert.equal(result.structuredContent.orderAdjusted, false);
  assert.equal(client.calls[1].endpoint, "/api/sqlite/flushTransaction");
});

test("siyuan_batch_insert_blocks reverses same-parent inserts to preserve final order", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const parentID = "20210817205410-2kvfpfn";
  const client = new FakeClient([
    [{ doOperations: [{ id: "20240101010101-abcdef0" }, { id: "20240101010102-abcdef1" }] }],
  ]);
  registerBlockTools(server, client, options);

  const result = await server._registeredTools.siyuan_batch_insert_blocks.handler({
    blocks: [
      { parentID, markdown: "first" },
      { parentID, markdown: "second" },
    ],
  });

  assert.deepEqual(client.calls[0].body.blocks.map((block) => block.data), ["second", "first"]);
  assert.equal(result.structuredContent.orderAdjusted, true);
});

test("siyuan_append_block warns when markdown looks like document metadata", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const parentID = "20210817205410-2kvfpfn";
  const insertedID = "20240101010101-abcdef0";
  const markdown = "---\ntags: #硬件#\n---\n\n正文";
  const client = new FakeClient([
    [{ doOperations: [{ id: insertedID, action: "insert" }] }],
  ]);
  registerBlockTools(server, client, options);

  const result = await server._registeredTools.siyuan_append_block.handler({
    parentID,
    markdown,
  });

  assert.equal(client.calls[0].body.data, markdown);
  assert.equal(result.structuredContent.warnings.length, 1);
  assert.match(result.structuredContent.warnings[0], /document metadata/);
});

test("siyuan_update_block expands multi-block markdown after the updated block", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const blockId = "20240101010101-abcdef0";
  const docId = "20240101010100-docroot";
  const insertedId = "20240101010102-abcdef1";
  const client = new FakeClient([
    { rootID: docId },
    [{ doOperations: [{ id: blockId, action: "update" }] }],
    [{ doOperations: [{ id: insertedId, action: "insert" }] }],
  ]);
  registerBlockTools(server, client, options);

  const result = await server._registeredTools.siyuan_update_block.handler({
    blockId,
    markdown: "## Updated title\n\nUpdated body",
  });

  assert.deepEqual(client.calls.slice(0, 3), [
    {
      endpoint: "/api/block/getBlockInfo",
      body: {
        id: blockId,
      },
    },
    {
      endpoint: "/api/block/updateBlock",
      body: {
        dataType: "markdown",
        data: "## Updated title",
        id: blockId,
      },
    },
    {
      endpoint: "/api/block/insertBlock",
      body: {
        dataType: "markdown",
        data: "Updated body",
        previousID: blockId,
        nextID: "",
        parentID: "",
      },
    },
  ]);
  assert.deepEqual(client.calls[3], { endpoint: "/api/sqlite/flushTransaction", body: undefined });
  assert.equal(result.structuredContent.updated, blockId);
  assert.deepEqual(result.structuredContent.insertedBlockIds, [insertedId]);
  assert.deepEqual(result.structuredContent.operationIds, [blockId, insertedId]);
  assert.equal(result.structuredContent.expanded, true);
});

test("siyuan_update_block leaves document multi-block markdown to SiYuan document update", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const docId = "20240101010101-abcdef0";
  const client = new FakeClient([
    { rootID: docId },
    [{ doOperations: [{ id: docId, action: "update" }] }],
  ]);
  registerBlockTools(server, client, options);

  const markdown = "# Document title\n\nBody";
  const result = await server._registeredTools.siyuan_update_block.handler({
    blockId: docId,
    markdown,
  });

  assert.deepEqual(client.calls, [
    {
      endpoint: "/api/block/getBlockInfo",
      body: {
        id: docId,
      },
    },
    {
      endpoint: "/api/block/updateBlock",
      body: {
        dataType: "markdown",
        data: markdown,
        id: docId,
      },
    },
    { endpoint: "/api/sqlite/flushTransaction", body: undefined },
  ]);
  assert.equal(result.structuredContent.updated, docId);
  assert.deepEqual(result.structuredContent.insertedBlockIds, []);
  assert.deepEqual(result.structuredContent.operationIds, [docId]);
  assert.equal(result.structuredContent.expanded, false);
});

test("siyuan_update_block keeps single-block markdown on updateBlock only", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const blockId = "20240101010101-abcdef0";
  const client = new FakeClient([[{ doOperations: [{ id: blockId, action: "update" }] }]]);
  registerBlockTools(server, client, options);

  const result = await server._registeredTools.siyuan_update_block.handler({
    blockId,
    markdown: "First line\nSecond line",
  });

  assert.deepEqual(client.calls, [
    {
      endpoint: "/api/block/updateBlock",
      body: {
        dataType: "markdown",
        data: "First line\nSecond line",
        id: blockId,
      },
    },
    { endpoint: "/api/sqlite/flushTransaction", body: undefined },
  ]);
  assert.deepEqual(result.structuredContent.insertedBlockIds, []);
  assert.equal(result.structuredContent.expanded, false);
});

test("siyuan_batch_update_blocks expands multi-block replacements without batchUpdateBlock data loss", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const blockId = "20240101010101-abcdef0";
  const docId = "20240101010100-docroot";
  const firstInsertedId = "20240101010102-abcdef1";
  const secondInsertedId = "20240101010103-abcdef2";
  const client = new FakeClient([
    { rootID: docId },
    [{ doOperations: [{ id: blockId, action: "update" }] }],
    [{ doOperations: [{ id: firstInsertedId, action: "insert" }] }],
    [{ doOperations: [{ id: secondInsertedId, action: "insert" }] }],
  ]);
  registerBlockTools(server, client, options);

  const result = await server._registeredTools.siyuan_batch_update_blocks.handler({
    blocks: [{ blockId, markdown: "First\n\nSecond\n\nThird" }],
  });

  assert.equal(client.calls[0].endpoint, "/api/block/getBlockInfo");
  assert.equal(client.calls[1].endpoint, "/api/block/updateBlock");
  assert.equal(client.calls[1].body.data, "First");
  assert.equal(client.calls[2].endpoint, "/api/block/insertBlock");
  assert.equal(client.calls[2].body.data, "Second");
  assert.equal(client.calls[2].body.previousID, blockId);
  assert.equal(client.calls[3].endpoint, "/api/block/insertBlock");
  assert.equal(client.calls[3].body.data, "Third");
  assert.equal(client.calls[3].body.previousID, firstInsertedId);
  assert.equal(client.calls[4].endpoint, "/api/sqlite/flushTransaction");
  assert.deepEqual(result.structuredContent.insertedBlockIds, [firstInsertedId, secondInsertedId]);
  assert.deepEqual(result.structuredContent.operationIds, [
    blockId,
    firstInsertedId,
    secondInsertedId,
  ]);
  assert.equal(result.structuredContent.expanded, true);
});

test("siyuan_move_block omits absent anchors for parentID-only moves", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const blockId = "20240101010101-abcdef0";
  const parentID = "20240101010100-docroot";
  const client = new FakeClient([
    [{ doOperations: [{ id: blockId, action: "move" }] }],
  ]);
  registerBlockTools(server, client, options);

  const result = await server._registeredTools.siyuan_move_block.handler({
    blockId,
    parentID,
  });

  assert.deepEqual(client.calls, [
    {
      endpoint: "/api/block/moveBlock",
      body: {
        id: blockId,
        parentID,
      },
    },
    { endpoint: "/api/sqlite/flushTransaction", body: undefined },
  ]);
  assert.equal(result.structuredContent.moved, blockId);
  assert.deepEqual(result.structuredContent.operationIds, [blockId]);
});

test("siyuan_move_block omits absent anchors for previousID-only moves", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const blockId = "20240101010101-abcdef0";
  const previousID = "20240101010100-previous";
  const client = new FakeClient([
    [{ doOperations: [{ id: blockId, action: "move" }] }],
  ]);
  registerBlockTools(server, client, options);

  const result = await server._registeredTools.siyuan_move_block.handler({
    blockId,
    previousID,
  });

  assert.deepEqual(client.calls[0], {
    endpoint: "/api/block/moveBlock",
    body: {
      id: blockId,
      previousID,
    },
  });
  assert.equal(result.structuredContent.moved, blockId);
});

test("siyuan_set_block_attrs accepts and normalizes tags", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const blockId = "20240101010101-abcdef0";
  const client = new FakeClient([{}]);
  registerAttrTools(server, client, options);

  const result = await server._registeredTools.siyuan_set_block_attrs.handler({
    blockId,
    attrs: {
      tags: "#硬件# #上电测试# #TCA9554#",
      "custom-owner": "mcp",
    },
  });

  assert.deepEqual(client.calls[0], {
    endpoint: "/api/attr/setBlockAttrs",
    body: {
      id: blockId,
      attrs: {
        tags: "硬件,上电测试,TCA9554",
        "custom-owner": "mcp",
      },
    },
  });
  assert.equal(result.structuredContent.attrs.tags, "硬件,上电测试,TCA9554");
});

test("siyuan_upload_assets uploads multipart text payload and can insert generated asset markdown", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const parentID = "20240101010100-docroot";
  const insertedID = "20240101010101-abcdef0";
  const client = new FakeClient([
    { errFiles: [], succMap: { "sample.png": "assets/sample-20240101010101-abcdef0.png" } },
    [{ doOperations: [{ id: insertedID, action: "insert" }] }],
  ]);
  registerAssetTools(server, client, options);

  const result = await server._registeredTools.siyuan_upload_assets.handler({
    files: [{ sourceType: "text", filename: "sample.png", content: "fake image bytes" }],
    parentID,
    insertAfterUpload: true,
  });

  assert.equal(client.calls[0].endpoint, "/api/asset/upload");
  assert.ok(Array.from(client.calls[0].form.keys()).includes("file[]"));
  assert.equal(client.calls[1].endpoint, "/api/block/insertBlock");
  assert.equal(client.calls[1].body.parentID, parentID);
  assert.equal(
    client.calls[1].body.data,
    "![sample](<assets/sample-20240101010101-abcdef0.png>)"
  );
  assert.equal(result.structuredContent.inserted, true);
  assert.equal(result.structuredContent.insertedBlockId, insertedID);
});

test("siyuan_import_local_assets lets the kernel copy large local assets and insert them", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const docId = "20240101010100-docroot";
  const insertedID = "20240101010102-abcdef1";
  const client = new FakeClient([
    { succMap: { "clip.mp4": "assets/clip-20240101010101-abcdef0.mp4" } },
    [{ doOperations: [{ id: insertedID, action: "insert" }] }],
  ]);
  registerAssetTools(server, client, options);

  const result = await server._registeredTools.siyuan_import_local_assets.handler({
    docId,
    assetPaths: ["/Users/me/Videos/clip.mp4"],
    isUpload: true,
    insertAfterImport: true,
    parentID: docId,
  });

  assert.deepEqual(client.calls[0], {
    endpoint: "/api/asset/insertLocalAssets",
    body: {
      id: docId,
      assetPaths: ["/Users/me/Videos/clip.mp4"],
      isUpload: true,
    },
  });
  assert.equal(client.calls[1].body.data, '<video controls="controls" src="assets/clip-20240101010101-abcdef0.mp4"></video>');
  assert.equal(result.structuredContent.importedCount, 1);
  assert.equal(result.structuredContent.insertedBlockId, insertedID);
});

test("siyuan_insert_asset_blocks infers audio links and inserts safe HTML", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const parentID = "20240101010100-docroot";
  const insertedID = "20240101010103-abcdef2";
  const client = new FakeClient([
    [{ doOperations: [{ id: insertedID, action: "insert" }] }],
  ]);
  registerAssetTools(server, client, options);

  const result = await server._registeredTools.siyuan_insert_asset_blocks.handler({
    assets: [{ path: "assets/audio-20240101010101-abcdef0.mp3" }],
    parentID,
  });

  assert.equal(client.calls[0].endpoint, "/api/block/insertBlock");
  assert.equal(client.calls[0].body.data, '<audio controls="controls" src="assets/audio-20240101010101-abcdef0.mp3"></audio>');
  assert.equal(result.structuredContent.assets[0].kind, "audio");
});

test("siyuan_insert_slash_block creates iframe and diagram slash-menu blocks", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const parentID = "20240101010100-docroot";
  const client = new FakeClient([
    [{ doOperations: [{ id: "20240101010104-abcdef3", action: "insert" }] }],
    [{ doOperations: [{ id: "20240101010105-abcdef4", action: "insert" }] }],
  ]);
  registerAssetTools(server, client, options);

  await server._registeredTools.siyuan_insert_slash_block.handler({
    kind: "iframe",
    url: "https://example.com/embed",
    parentID,
  });
  const diagram = await server._registeredTools.siyuan_insert_slash_block.handler({
    kind: "mermaid",
    content: "graph TD\nA-->B",
    parentID,
  });

  assert.match(client.calls[0].body.data, /^<iframe sandbox=/);
  assert.match(client.calls[0].body.data, /src="https:\/\/example.com\/embed"/);
  assert.equal(client.calls[2].body.data, "```mermaid\ngraph TD\nA-->B\n```");
  assert.equal(diagram.structuredContent.kind, "mermaid");
});
