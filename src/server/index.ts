
/**
 * MCP server setup and request handling
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { NotionClientWrapper } from "../client/index.js";
import { filterTools } from "../utils/index.js";
import * as schemas from "../types/schemas.js";
import * as args from "../types/args.js";
import http from "http";

function createServer(
  notionToken: string,
  enabledToolsSet: Set<string>,
  enableMarkdownConversion: boolean
) {
  const server = new Server(
    { name: "Notion MCP Server", version: "1.1.0" },
    { capabilities: { tools: {} } }
  );

  const notionClient = new NotionClientWrapper(notionToken);

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      try {
        if (!request.params.arguments) {
          throw new Error("No arguments provided");
        }

        let response;
        const input = request.params.arguments as any;

        switch (request.params.name) {
          case "notion_append_block_children":
            if (!input.block_id || !input.children) throw new Error("Missing required arguments: block_id and children");
            response = await notionClient.appendBlockChildren(input.block_id, input.children, input.after);
            break;
          case "notion_retrieve_block":
            if (!input.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.retrieveBlock(input.block_id);
            break;
          case "notion_retrieve_block_children":
            if (!input.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.retrieveBlockChildren(input.block_id, input.start_cursor, input.page_size);
            break;
          case "notion_delete_block":
            if (!input.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.deleteBlock(input.block_id);
            break;
          case "notion_update_block":
            if (!input.block_id || !input.block) throw new Error("Missing required arguments: block_id and block");
            response = await notionClient.updateBlock(input.block_id, input.block);
            break;
          case "notion_retrieve_page":
            if (!input.page_id) throw new Error("Missing required argument: page_id");
            response = await notionClient.retrievePage(input.page_id);
            break;
          case "notion_update_page_properties":
            if (!input.page_id || !input.properties) throw new Error("Missing required arguments: page_id and properties");
            response = await notionClient.updatePageProperties(input.page_id, input.properties);
            break;
          case "notion_create_page":
            if (!input.parent_id || !input.title) throw new Error("Missing required arguments: parent_id and title");
            response = await notionClient.createPage(input.parent_id, input.parent_type || "page_id", input.title, input.children, input.properties, input.icon);
            break;
          case "notion_list_all_users":
            response = await notionClient.listAllUsers(input.start_cursor, input.page_size);
            break;
          case "notion_retrieve_user":
            if (!input.user_id) throw new Error("Missing required argument: user_id");
            response = await notionClient.retrieveUser(input.user_id);
            break;
          case "notion_retrieve_bot_user":
            response = await notionClient.retrieveBotUser();
            break;
          case "notion_query_database":
            if (!input.database_id) throw new Error("Missing required argument: database_id");
            response = await notionClient.queryDatabase(input.database_id, input.filter, input.sorts, input.start_cursor, input.page_size);
            break;
          case "notion_create_database":
            response = await notionClient.createDatabase(input.parent, input.properties, input.title);
            break;
          case "notion_retrieve_database":
            response = await notionClient.retrieveDatabase(input.database_id);
            break;
          case "notion_update_database":
            response = await notionClient.updateDatabase(input.database_id, input.title, input.description, input.properties);
            break;
          case "notion_create_database_item":
            response = await notionClient.createDatabaseItem(input.database_id, input.properties);
            break;
          case "notion_create_comment":
            if (!input.parent && !input.discussion_id) throw new Error("Either parent.page_id or discussion_id must be provided");
            response = await notionClient.createComment(input.parent, input.discussion_id, input.rich_text);
            break;
          case "notion_retrieve_comments":
            if (!input.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.retrieveComments(input.block_id, input.start_cursor, input.page_size);
            break;
          case "notion_search":
            response = await notionClient.search(input.query, input.filter, input.sort, input.start_cursor, input.page_size);
            break;
          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }

        const requestedFormat = input.format || "markdown";
        if (enableMarkdownConversion && requestedFormat === "markdown") {
          return { content: [{ type: "text", text: await notionClient.toMarkdown(response) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        console.error("Error executing tool:", error);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          }],
        };
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const allTools = [
      schemas.appendBlockChildrenTool,
      schemas.retrieveBlockTool,
      schemas.retrieveBlockChildrenTool,
      schemas.deleteBlockTool,
      schemas.updateBlockTool,
      schemas.retrievePageTool,
      schemas.updatePagePropertiesTool,
      schemas.createPageTool,
      schemas.listAllUsersTool,
      schemas.retrieveUserTool,
      schemas.retrieveBotUserTool,
      schemas.createDatabaseTool,
      schemas.queryDatabaseTool,
      schemas.retrieveDatabaseTool,
      schemas.updateDatabaseTool,
      schemas.createDatabaseItemTool,
      schemas.createCommentTool,
      schemas.retrieveCommentsTool,
      schemas.searchTool,
    ];
    return { tools: filterTools(allTools, enabledToolsSet) };
  });

  return server;
}

export async function startServer(
  notionToken: string,
  enabledToolsSet: Set<string>,
  enableMarkdownConversion: boolean,
  transportType: "stdio" | "http" = "stdio",
  httpPort: number = 3000,
  authToken?: string
) {
  if (transportType === "http") {
    const token = authToken || process.env.MCP_AUTH_TOKEN;

    const httpServer = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://localhost:${httpPort}`);

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", tools: enabledToolsSet.size || "all" }));
        return;
      }

      if (url.pathname === "/.well-known/oauth-authorization-server" && req.method === "GET") {
        const base = `https://${req.headers.host}`;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          issuer: base,
          token_endpoint: `${base}/oauth/token`,
          grant_types_supported: ["client_credentials"],
        }));
        return;
      }

      if (url.pathname === "/oauth/token" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString();
        const params = new URLSearchParams(body);
        const accessToken = token || "your-token";

        if (!params.get("client_id") || !params.get("client_secret")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 86400,
        }));
        return;
      }

      if (token) {
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${token}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }

      if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
        if (req.method === "GET" || req.method === "DELETE") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed." },
            id: null,
          }));
          return;
        }

        const server = createServer(notionToken, enabledToolsSet, enableMarkdownConversion);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        res.on("close", () => {
          transport.close().catch(() => {});
          server.close().catch(() => {});
        });

        try {
          await server.connect(transport);
          await transport.handleRequest(req, res);
        } catch (error) {
          console.error("Error handling MCP request:", error);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            }));
          }
        }
        return;
      }

      res.writeHead(404);
      res.end("Not found. Use /mcp for MCP endpoint or /health for status.");
    });

    httpServer.listen(httpPort, "0.0.0.0", () => {
      console.error(`Notion MCP Server listening on port ${httpPort}`);
      console.error(`MCP endpoint: http://0.0.0.0:${httpPort}/mcp`);
    });
  } else {
    const server = createServer(notionToken, enabledToolsSet, enableMarkdownConversion);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
