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
            response = await notionClient.createPage(
              input.parent_id,
              input.parent_type || "page_id",
              input.title,
              input.children,
              input.properties,
              input.icon
            );
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
            response = await notionClient.queryDatabase(
              input.database_id,
              input.filter,
              input.sorts,
              input.start_cursor,
              input.page_size
            );
            break;
          case "notion_create_database":
            response = await notionClient.createDatabase(input.parent, input.properties, input.title);
            break;
          case "notion_retrieve_database":
            response = await notionClient.retrieveDatabase(input.database_id);
            break;
          case "notion_update_database":
            response = await notionClient.updateDatabase(
              input.database_id,
              input.title,
              input.description,
              input.properties
            );
            break;
          case "notion_create_database_item":
            response = await notionClient.createDatabaseItem(input.database_id, input.properties);
            break;
          case "notion_create_comment":
            if (!input.parent && !input.discussion_id) {
              throw new Error("Either parent.page_id or discussion_id must be provided");
            }
            response = await notionClient.createComment(
              input.parent,
              input.discussion_id,
              input.rich_text
            );
            break;
          case "notion_retrieve_comments":
            if (!input.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.retrieveComments(
              input.block_id,
              input.start_cursor,
              input.page_size
            );
            break;
          case "notion_search":
            response = await notionClient.search(
              input.query,
              input.filter,
              input.sort,
              input.start_cursor,
              input.page_size
            );
            break;
          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }

        const requestedFormat = input.format || "markdown";

        if (enableMarkdownConversion && requestedFormat === "markdown") {
          return {
            content: [
              { type: "text", text: await notionClient.toMarkdown(response) },
            ],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        console.error("Error executing tool:", error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
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
    const publicBaseUrl =
      process.env.PUBLIC_URL || "https://mcp-notion-server-production-2ad6.up.railway.app";

    // This is a minimal compatibility implementation, not a full OAuth authorization server.
    // It supports Claude's client-credentials token request and validates bearer tokens on /mcp.
    const issuedTokens = new Map<string, number>();

    const httpServer = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, mcp-session-id"
      );

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", publicBaseUrl);

      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            tools: enabledToolsSet.size || "all",
          })
        );
        return;
      }

      if (
        url.pathname === "/.well-known/oauth-authorization-server" &&
        req.method === "GET"
      ) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(
          JSON.stringify({
            issuer: publicBaseUrl,
            token_endpoint: `${publicBaseUrl}/oauth/token`,
            grant_types_supported: ["client_credentials"],
            token_endpoint_auth_methods_supported: [
              "client_secret_post",
              "none",
            ],
            response_types_supported: ["token"],
          })
        );
        return;
      }

      if (url.pathname === "/oauth/token" && req.method === "POST") {
        const chunks: Buffer[] = [];

        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }

        const rawBody = Buffer.concat(chunks).toString("utf8");
        const contentType = String(req.headers["content-type"] || "");

        let params = new URLSearchParams();

        if (contentType.includes("application/json")) {
          try {
            const parsed = JSON.parse(rawBody);
            params = new URLSearchParams(
              Object.entries(parsed).map(([key, value]) => [
                key,
                String(value ?? ""),
              ])
            );
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_request" }));
            return;
          }
        } else {
          params = new URLSearchParams(rawBody);
        }

        const clientId = params.get("client_id");
        const clientSecret = params.get("client_secret");
        const grantType = params.get("grant_type");

        if (!clientId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "invalid_request",
              error_description: "client_id is required",
            })
          );
          return;
        }

        if (grantType && grantType !== "client_credentials") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "unsupported_grant_type",
            })
          );
          return;
        }

        // If MCP_AUTH_TOKEN is configured, issue that value only after validating
        // the configured shared secret when one is explicitly provided.
        // Claude may omit client_secret for public clients.
        const expectedClientSecret = process.env.OAUTH_CLIENT_SECRET;

        if (
          expectedClientSecret &&
          clientSecret !== expectedClientSecret
        ) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_client" }));
          return;
        }

        // Keep the bearer token stable for this server process. The endpoint
        // does not reveal NOTION_API_TOKEN.
        const accessToken = token || process.env.MCP_AUTH_TOKEN;

        if (!accessToken) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "server_error",
              error_description: "MCP_AUTH_TOKEN is not configured",
            })
          );
          return;
        }

        issuedTokens.set(accessToken, Date.now() + 24 * 60 * 60 * 1000);

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        });
        res.end(
          JSON.stringify({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: 86400,
          })
        );
        return;
      }

      if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
        // The MCP endpoint must accept only the configured bearer token.
        // OAuth-issued token is the configured MCP_AUTH_TOKEN.
        if (token) {
          const auth = req.headers.authorization || "";
          if (auth !== `Bearer ${token}`) {
            res.writeHead(401, {
              "Content-Type": "application/json",
              "WWW-Authenticate": 'Bearer realm="mcp"',
            });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
        }

        if (req.method === "GET" || req.method === "DELETE") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Method not allowed." },
              id: null,
            })
          );
          return;
        }

        const server = createServer(
          notionToken,
          enabledToolsSet,
          enableMarkdownConversion
        );

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        try {
          await server.connect(transport);
          await transport.handleRequest(req, res);
        } catch (error) {
          console.error("Error handling MCP request:", error);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32603,
                  message: "Internal server error",
                },
                id: null,
              })
            );
          }
        } finally {
          transport.close().catch(() => {});
          server.close().catch(() => {});
        }
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "not_found",
          message:
            "Use /.well-known/oauth-authorization-server, /oauth/token, /mcp, or /health",
        })
      );
    });

    httpServer.listen(httpPort, "0.0.0.0", () => {
      console.error(`Notion MCP Server listening on port ${httpPort}`);
      console.error(`MCP endpoint: ${publicBaseUrl}/mcp`);
    });
  } else {
    const server = createServer(
      notionToken,
      enabledToolsSet,
      enableMarkdownConversion
    );
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
