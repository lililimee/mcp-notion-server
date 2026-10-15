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
import http from "node:http";
import crypto from "node:crypto";

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

        let response: any;
        const input = request.params.arguments as any;

        switch (request.params.name) {
          case "notion_append_block_children":
            if (!input.block_id || !input.children)
              throw new Error("Missing required arguments: block_id and children");
            response = await notionClient.appendBlockChildren(
              input.block_id, input.children, input.after
            );
            break;

          case "notion_retrieve_block":
            if (!input.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.retrieveBlock(input.block_id);
            break;

          case "notion_retrieve_block_children":
            if (!input.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.retrieveBlockChildren(
              input.block_id, input.start_cursor, input.page_size
            );
            break;

          case "notion_delete_block":
            if (!input.block_id) throw new Error("Missing required argument: block_id");
            response = await notionClient.deleteBlock(input.block_id);
            break;

          case "notion_update_block":
            if (!input.block_id || !input.block)
              throw new Error("Missing required arguments: block_id and block");
            response = await notionClient.updateBlock(input.block_id, input.block);
            break;

          case "notion_retrieve_page":
            if (!input.page_id) throw new Error("Missing required argument: page_id");
            response = await notionClient.retrievePage(input.page_id);
            break;

          case "notion_update_page_properties":
            if (!input.page_id || !input.properties)
              throw new Error("Missing required arguments: page_id and properties");
            response = await notionClient.updatePageProperties(
              input.page_id, input.properties
            );
            break;

          case "notion_create_page":
            if (!input.parent_id || !input.title)
              throw new Error("Missing required arguments: parent_id and title");
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
            response = await notionClient.listAllUsers(
              input.start_cursor, input.page_size
            );
            break;

          case "notion_retrieve_user":
            if (!input.user_id) throw new Error("Missing required argument: user_id");
            response = await notionClient.retrieveUser(input.user_id);
            break;

          case "notion_retrieve_bot_user":
            response = await notionClient.retrieveBotUser();
            break;

          case "notion_query_database":
            if (!input.database_id)
              throw new Error("Missing required argument: database_id");
            response = await notionClient.queryDatabase(
              input.database_id,
              input.filter,
              input.sorts,
              input.start_cursor,
              input.page_size
            );
            break;

          case "notion_create_database":
            response = await notionClient.createDatabase(
              input.parent, input.properties, input.title
            );
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
            response = await notionClient.createDatabaseItem(
              input.database_id, input.properties
            );
            break;

          case "notion_create_comment":
            if (!input.parent && !input.discussion_id) {
              throw new Error("Either parent.page_id or discussion_id must be provided");
            }
            response = await notionClient.createComment(
              input.parent, input.discussion_id, input.rich_text
            );
            break;

          case "notion_retrieve_comments":
            if (!input.block_id)
              throw new Error("Missing required argument: block_id");
            response = await notionClient.retrieveComments(
              input.block_id, input.start_cursor, input.page_size
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
  httpPort: number = 3000,
  authToken?: string
) {
  if (transportType !== "http") {
    const server = createServer(
      notionToken, enabledToolsSet, enableMarkdownConversion
    );
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  const configuredSecret = authToken || process.env.MCP_AUTH_TOKEN;

  const baseUrl = (
    process.env.PUBLIC_URL ||
    "https://mcp-notion-server-production-2ad6.up.railway.app"
  ).replace(/\/+$/, "");

  const allowedRedirectUris = new Set([
    "https://claude.ai/api/mcp/auth_callback",
  ]);

  const authorizationCodes = new Map<
    string,
    {
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      expiresAt: number;
    }
  >();

  const accessTokens = new Map<string, number>();

  const sendJson = (
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

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  async function readBody(
    req: http.IncomingMessage
  ): Promise<URLSearchParams> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }

    const raw = Buffer.concat(chunks).toString("utf8");
    const contentType = String(req.headers["content-type"] || "");

    if (contentType.includes("application/json")) {
      const data = JSON.parse(raw || "{}");

      return new URLSearchParams(
        Object.entries(data).map(([key, value]) => [
          key,
          String(value ?? ""),
        ])
      );
    }

    return new URLSearchParams(raw);
  }

  const httpServer = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, mcp-session-id, MCP-Protocol-Version"
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Mcp-Session-Id, WWW-Authenticate"
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", baseUrl);
    const now = Date.now();

    for (const [code, entry] of authorizationCodes) {
      if (entry.expiresAt <= now) authorizationCodes.delete(code);
    }

    for (const [token, expiry] of accessTokens) {
      if (expiry <= now) accessTokens.delete(token);
    }

    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        tools: enabledToolsSet.size || "all",
      });
      return;
    }

    if (
      url.pathname === "/.well-known/oauth-authorization-server" &&
      req.method === "GET"
    ) {
      sendJson(res, 200, {
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
      url.pathname === "/.well-known/oauth-protected-resource" &&
      req.method === "GET"
    ) {
      sendJson(res, 200, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"],
      });
      return;
    }

    if (url.pathname === "/authorize" && req.method === "GET") {
      const responseType = url.searchParams.get("response_type") || "";
      const clientId = url.searchParams.get("client_id") || "";
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      const state = url.searchParams.get("state") || "";
      const codeChallenge = url.searchParams.get("code_challenge") || "";
      const challengeMethod =
        url.searchParams.get("code_challenge_method") || "";

      if (
        responseType !== "code" ||
        !clientId ||
        !state ||
        !allowedRedirectUris.has(redirectUri) ||
        !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
        challengeMethod !== "S256"
      ) {
        sendJson(res, 400, {
          error: "invalid_request",
          error_description: "Invalid OAuth authorization request",
        });
        return;
      }

      const hiddenInputs = [
        ["clientId", clientId],
        ["redirectUri", redirectUri],
        ["state", state],
        ["codeChallenge", codeChallenge],
      ]
        .map(
          ([key, value]) =>
            `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`
        )
        .join("");

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });

      res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Notion MCP</title>
</head>
<body style="font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#222">
<h2>Connect Claude to your Notion MCP server?</h2>
<p>Approving allows Claude to use the Notion integration configured on this server.</p>
<p>Only continue if you trust this server and its owner.</p>
<form method="post" action="/authorize/approve">
${hiddenInputs}
<button type="submit" style="padding:12px 20px;font-size:16px;cursor:pointer">
Authorize Claude
</button>
</form>
</body>
</html>`);
      return;
    }

    if (url.pathname === "/authorize/approve" && req.method === "POST") {
      let params: URLSearchParams;

      try {
        params = await readBody(req);
      } catch {
        sendJson(res, 400, { error: "invalid_request" });
        return;
      }

      const clientId = params.get("clientId") || "";
      const redirectUri = params.get("redirectUri") || "";
      const state = params.get("state") || "";
      const codeChallenge = params.get("codeChallenge") || "";

      if (
        !clientId ||
        !state ||
        !allowedRedirectUris.has(redirectUri) ||
        !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
      ) {
        sendJson(res, 400, { error: "invalid_request" });
        return;
      }

      const code = crypto.randomBytes(32).toString("base64url");

      authorizationCodes.set(code, {
        clientId,
        redirectUri,
        codeChallenge,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      const callback = new URL(redirectUri);
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

    if (url.pathname === "/oauth/token" && req.method === "POST") {
      let params: URLSearchParams;

      try {
        params = await readBody(req);
      } catch {
        sendJson(res, 400, { error: "invalid_request" });
        return;
      }

      if (params.get("grant_type") !== "authorization_code") {
        sendJson(res, 400, { error: "unsupported_grant_type" });
        return;
      }

      const code = params.get("code") || "";
      const clientId = params.get("client_id") || "";
      const redirectUri = params.get("redirect_uri") || "";
      const verifier = params.get("code_verifier") || "";
      const saved = authorizationCodes.get(code);

      if (
        !saved ||
        saved.expiresAt <= Date.now() ||
        saved.clientId !== clientId ||
        saved.redirectUri !== redirectUri ||
        !allowedRedirectUris.has(redirectUri) ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
      ) {
        sendJson(res, 400, { error: "invalid_grant" });
        return;
      }

      const calculatedChallenge = crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url");

      if (calculatedChallenge !== saved.codeChallenge) {
        sendJson(res, 400, {
          error: "invalid_grant",
          error_description: "PKCE verification failed",
        });
        return;
      }

      // Authorization codes are one-time use.
      authorizationCodes.delete(code);

      // Issue a separate OAuth access token. Never expose the Notion token.
      const accessToken = crypto.randomBytes(32).toString("base64url");
      accessTokens.set(accessToken, Date.now() + 24 * 60 * 60 * 1000);

      sendJson(res, 200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 86400,
      });
      return;
    }

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const authorization = req.headers.authorization || "";
      const presentedToken = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";

      const tokenExpiry = accessTokens.get(presentedToken) || 0;
      const validAccessToken =
        Boolean(presentedToken) && tokenExpiry > Date.now();

      if (!configuredSecret || !validAccessToken) {
        res.setHeader(
          "WWW-Authenticate",
          `Bearer realm="mcp", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
        );
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        sendJson(res, 405, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        });
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
          sendJson(res, 500, {
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error",
            },
            id: null,
          });
        }
      } finally {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      }

      return;
    }

    sendJson(res, 404, { error: "not_found" });
  });

  httpServer.listen(httpPort, "0.0.0.0", () => {
    console.error(`Notion MCP Server listening on port ${httpPort}`);
    console.error(`MCP endpoint: ${baseUrl}/mcp`);
  });
}
