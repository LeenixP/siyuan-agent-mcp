import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerKnowledgeTools } from "../dist/tools/knowledge.js";
import { registerDocTools } from "../dist/tools/docs.js";
import { registerBlockTools } from "../dist/tools/blocks.js";

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

test("siyuan_create_doc sends parentID and explicit id, and reports existing docs", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const docId = "20240101010101-abcdef0";
  const parentDocId = "20231224160424-2f5680o";
  const notebookId = "20210817205410-2kvfpfn";
  const client = new FakeClient(["/Parent", [docId], docId]);
  registerDocTools(server, client, options);

  const result = await server._registeredTools.siyuan_create_doc.handler({
    notebookId,
    title: "Child",
    parentDocId,
    docId,
    markdown: "",
  });

  assert.deepEqual(client.calls.slice(0, 3), [
    { endpoint: "/api/filetree/getHPathByID", body: { id: parentDocId } },
    { endpoint: "/api/filetree/getIDsByHPath", body: { notebook: notebookId, path: "/Parent/Child" } },
    {
      endpoint: "/api/filetree/createDocWithMd",
      body: {
        notebook: notebookId,
        path: "/Parent/Child",
        markdown: "",
        parentID: parentDocId,
        id: docId,
      },
    },
  ]);
  assert.equal(result.structuredContent.createdDocId, docId);
  assert.equal(result.structuredContent.existed, true);
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
  assert.equal(client.calls[1].endpoint, "/api/sqlite/flushTransaction");
});
