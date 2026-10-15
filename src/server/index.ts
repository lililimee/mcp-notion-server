```typescript
/**
 * MCP server setup and request handling
 * Supports stdio and stateless Streamable HTTP with OAuth 2.0 authorization code + PKCE.
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
import http from "node:http";
import crypto from "node:crypto";

function createServer(
  notionToken: string,
  enabledToolsSet: Set<string>,
  enableMarkdownConversion: boolean
) {
  const server = new Server(
    { name: "Notion MCP Server", version: "2.1.0" },
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

        const input = request.params.arguments as any;
        let response: any;

        switch (request.params.name) {
          case "notion_append_block_children": {
            const a = input as args.AppendBlockChildrenArgs;
            if (!a.block_id || !a.children) {
              throw new Error("Missing required arguments: block_id and children");
            }
            response = await notionClient.appendBlockChildren(
              a.block_id, a.children, a.after
            );
            break;
          }
          case "notion_retrieve_block": {
            const a = input as args.RetrieveBlockArgs;
            if (!a.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.retrieveBlock(a.block_id);
            break;
          }
          case "notion_retrieve_block_children": {
            const a = input as args.RetrieveBlockChildrenArgs;
            if (!a.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.retrieveBlockChildren(
              a.block_id, a.start_cursor, a.page_size
            );
            break;
          }
          case "notion_delete_block": {
            const a = input as args.DeleteBlockArgs;
            if (!a.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.deleteBlock(a.block_id);
            break;
          }
          case "notion_update_block": {
            const a = input as args.UpdateBlockArgs;
            if (!a.block_id || !a.block) {
              throw new Error("Missing required arguments: block_id and block");
            }
            response = await notionClient.updateBlock(a.block_id, a.block);
            break;
          }
          case "notion_retrieve_page": {
            const a = input as args.RetrievePageArgs;
            if (!a.page_id) throw new Error("Missing required argument: page_id");
            response = await notionClient.retrievePage(a.page_id);
            break;
          }
          case "notion_update_page_properties": {
            const a = input as args.UpdatePagePropertiesArgs;
            if (!a.page_id || !a.properties) {
              throw new Error("Missing required arguments: page_id and properties");
            }
            response = await notionClient.updatePageProperties(
              a.page_id, a.properties
            );
            break;
          }
          case "notion_create_page": {
            const a = input as args.CreatePageArgs;
            if (!a.parent_id || !a.title) {
              throw new Error("Missing required arguments: parent_id and title");
            }
            response = await notionClient.createPage(
              a.parent_id, a.parent_type || "page_id", a.title,
              a.children, a.properties, a.icon
            );
            break;
          }
          case "notion_list_all_users": {
            const a = input as args.ListAllUsersArgs;
            response = await notionClient.listAllUsers(a.start_cursor, a.page_size);
            break;
          }
          case "notion_retrieve_user": {
            const a = input as args.RetrieveUserArgs;
            if (!a.user_id) throw new Error("Missing required argument: user_id");
            response = await notionClient.retrieveUser(a.user_id);
            break;
          }
          case "notion_retrieve_bot_user":
            response = await notionClient.retrieveBotUser();
            break;
          case "notion_query_database": {
            const a = input as args.QueryDatabaseArgs;
            if (!a.database_id) throw new Error("Missing required argument: database_id");
            response = await notionClient.queryDatabase(
              a.database_id, a.filter, a.sorts, a.start_cursor, a.page_size
            );
            break;
          }
          case "notion_create_database": {
            const a = input as args.CreateDatabaseArgs;
            response = await notionClient.createDatabase(
              a.parent, a.properties, a.title
            );
            break;
          }
          case "notion_retrieve_database": {
            const a = input as args.RetrieveDatabaseArgs;
            response = await notionClient.retrieveDatabase(a.database_id);
            break;
          }
          case "notion_update_database": {
            const a = input as args.UpdateDatabaseArgs;
            response = await notionClient.updateDatabase(
              a.database_id, a.title, a.description, a.properties
            );
            break;
          }
          case "notion_create_database_item": {
            const a = input as args.CreateDatabaseItemArgs;
            response = await notionClient.createDatabaseItem(
              a.database_id, a.properties
            );
            break;
          }
          case "notion_create_comment": {
            const a = input as args.CreateCommentArgs;
            if (!a.parent && !a.discussion_id) {
              throw new Error("Either parent.page_id or discussion_id must be provided");
            }
            response = await notionClient.createComment(
              a.parent, a.discussion_id, a.rich_text
            );
            break;
          }
          case "notion_retrieve_comments": {
            const a = input as args.RetrieveCommentsArgs;
            if (!a.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.retrieveComments(
              a.block_id, a.start_cursor, a.page_size
            );
            break;
          }
          case "notion_search": {
            const a = input as args.SearchArgs;
            response = await notionClient.search(
              a.query, a.filter, a.sort, a.start_cursor, a.page_size
            );
            break;
          }
          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }

        const format = input.format || "markdown";
        if (enableMarkdownConversion && format === "markdown") {
          return {
            content: [{ type: "text", text: await notionClient.toMarkdown(response) }],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        console.error("Error executing tool:", error);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
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
  httpPort = 3000,
  authToken?: string
) {
  if (transportType !== "http") {
    const server = createServer(
      notionToken, enabledToolsSet, enableMarkdownConversion
    );
    await server.connect(new StdioServerTransport());
    return;
  }

  const baseUrl = (
    process.env.PUBLIC_URL ||
    "https://mcp-notion-server-production-2ad6.up.railway.app"
  ).replace(/\/+$/, "");

  const redirectAllowlist = new Set([
    "https://claude.ai/api/mcp/auth_callback",
  ]);

  const codes = new Map<string, {
    clientId: string;
    redirectUri: string;
    challenge: string;
    expiresAt: number;
  }>();

  const tokens = new Map<string, {
    expiresAt: number;
    clientId: string;
    resource: string;
  }>();

  const json = (
    res: http.ServerResponse,
    status: number,
    data: unknown
  ) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    });
    res.end(JSON.stringify(data));
  };

  const readForm = async (req: http.IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const contentType = String(req.headers["content-type"] || "");

    if (contentType.includes("application/json")) {
      const body = JSON.parse(raw || "{}");
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        form.set(key, String(value ?? ""));
      }
      return form;
    }
    return new URLSearchParams(raw);
  };

  const htmlEscape = (s: string) =>
    s.replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const httpServer = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id"
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "WWW-Authenticate, Mcp-Session-Id"
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", baseUrl);
    const resource = `${baseUrl}/mcp`;
    const now = Date.now();

    for (const [key, value] of codes) {
      if (value.expiresAt <= now) codes.delete(key);
    }
    for (const [key, value] of tokens) {
      if (value.expiresAt <= now) tokens.delete(key);
    }

    // Public health endpoint.
    if (url.pathname === "/health" && req.method === "GET") {
      json(res, 200, {
        status: "ok",
        tools: enabledToolsSet.size || "all",
      });
      return;
    }

    // Public OAuth discovery endpoints: do not put bearer auth before these.
    if (
      req.method === "GET" &&
      url.pathname === "/.well-known/oauth-authorization-server"
    ) {
      json(res, 200, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        authorization_response_iss_parameter_supported: true,
      });
      return;
    }

    if (
      req.method === "GET" &&
      (
        url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === "/.well-known/oauth-protected-resource/mcp"
      )
    ) {
      json(res, 200, {
        resource,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"],
      });
      return;
    }

    // OAuth authorization-code endpoint.
    if (url.pathname === "/authorize" && req.method === "GET") {
      const responseType = url.searchParams.get("response_type") || "";
      const clientId = url.searchParams.get("client_id") || "";
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      const state = url.searchParams.get("state") || "";
      const challenge = url.searchParams.get("code_challenge") || "";
      const method = url.searchParams.get("code_challenge_method") || "";
      const requestedResource = url.searchParams.get("resource") || resource;

      if (
        responseType !== "code" ||
        !clientId ||
        !state ||
        !redirectAllowlist.has(redirectUri) ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
        method !== "S256" ||
        requestedResource !== resource
      ) {
        json(res, 400, {
          error: "invalid_request",
          error_description: "Invalid OAuth authorization request",
        });
        return;
      }

      const transaction = crypto.randomBytes(24).toString("base64url");
      codes.set(`pending:${transaction}`, {
        clientId,
        redirectUri,
        challenge,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      const form = `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Notion MCP</title>
</head>
<body style="font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#222">
<h2>Connect Claude to your Notion MCP server?</h2>
<p>Claude will be able to use the Notion integration configured on this server.</p>
<form method="post" action="/authorize/approve">
<input type="hidden" name="transaction" value="${htmlEscape(transaction)}">
<input type="hidden" name="state" value="${htmlEscape(state)}">
<input type="hidden" name="resource" value="${htmlEscape(requestedResource)}">
<button type="submit" style="padding:12px 20px;font-size:16px;cursor:pointer">Authorize Claude</button>
</form>
</body>
</html>`;

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(form);
      return;
    }

    if (url.pathname === "/authorize/approve" && req.method === "POST") {
      let form: URLSearchParams;
      try {
        form = await readForm(req);
      } catch {
        json(res, 400, { error: "invalid_request" });
        return;
      }

      const transaction = form.get("transaction") || "";
      const state = form.get("state") || "";
      const requestedResource = form.get("resource") || "";
      const key = `pending:${transaction}`;
      const pending = codes.get(key);

      if (
        !pending ||
        pending.expiresAt <= Date.now() ||
        !state ||
        requestedResource !== resource
      ) {
        json(res, 400, { error: "invalid_request" });
        return;
      }

      codes.delete(key);

      const code = crypto.randomBytes(32).toString("base64url");
      codes.set(code, {
        ...pending,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      const callback = new URL(pending.redirectUri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", state);
      callback.searchParams.set("iss", baseUrl);

      res.writeHead(302, {
        Location: callback.toString(),
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    // Exchange a one-time authorization code for a bearer token.
    if (url.pathname === "/oauth/token" && req.method === "POST") {
      let form: URLSearchParams;
      try {
        form = await readForm(req);
      } catch {
        json(res, 400, { error: "invalid_request" });
        return;
      }

      if (form.get("grant_type") !== "authorization_code") {
        json(res, 400, { error: "unsupported_grant_type" });
        return;
      }

      const code = form.get("code") || "";
      const clientId = form.get("client_id") || "";
      const redirectUri = form.get("redirect_uri") || "";
      const verifier = form.get("code_verifier") || "";
      const requestedResource = form.get("resource") || resource;
      const entry = codes.get(code);

      if (
        !entry ||
        entry.expiresAt <= Date.now() ||
        entry.clientId !== clientId ||
        entry.redirectUri !== redirectUri ||
        !redirectAllowlist.has(redirectUri) ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
        requestedResource !== resource
      ) {
        json(res, 400, { error: "invalid_grant" });
        return;
      }

      const actualChallenge = crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url");

      if (actualChallenge !== entry.challenge) {
        json(res, 400, { error: "invalid_grant" });
        return;
      }

      codes.delete(code);

      const accessToken = crypto.randomBytes(32).toString("base64url");
      tokens.set(accessToken, {
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        clientId,
        resource,
      });

      json(res, 200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 86400,
        resource,
      });
      return;
    }

    // Only the MCP resource endpoint requires OAuth bearer authentication.
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const header = req.headers.authorization || "";
      const bearer = header.startsWith("Bearer ")
        ? header.slice(7)
        : "";
      const token = tokens.get(bearer);

      if (!token || token.expiresAt <= Date.now() || token.resource !== resource) {
        res.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
        );
        json(res, 401, { error: "Unauthorized" });
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        json(res, 405, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        });
        return;
      }

      const server = createServer(
        notionToken, enabledToolsSet, enableMarkdownConversion
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
          json(res, 500, {
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      } finally {
        await transport.close().catch(() => {});
        await server.close().catch(() => {});
      }
      return;
    }

    json(res, 404, { error: "not_found" });
  });

  httpServer.listen(httpPort, "0.0.0.0", () => {
    console.error(`Notion MCP Server listening on port ${httpPort}`);
    console.error(`MCP endpoint: ${baseUrl}/mcp`);
    console.error(`OAuth issuer: ${baseUrl}`);
    console.error(`Markdown conversion: ${enableMarkdownConversion}`);
    console.error(`Enabled tools: ${enabledToolsSet.size || "all"}`);
  });
}
```
