import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { randomUUID } from "node:crypto";
import pkg from "../package.json" with { type: "json" };
import { registerMovementTools } from "./tools/movement/index.js";
import { registerMiningTools } from "./tools/mining/index.js";
import { registerMultiplayerTools } from "./tools/multiplayer/index.js";
import { registerVisionTools } from "./tools/vision/index.js";
import { registerWikiTools } from "./tools/wiki/index.js";
import { registerBuildingTools } from "./tools/building/index.js";

const { pathfinder } = pathfinderPkg;

let bot: mineflayer.Bot | null = null;
let isConnecting = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const botConfig = {
  host: process.env.MC_HOST || "localhost",
  port: parseInt(process.env.MC_PORT || "25565", 10),
  username: process.env.MC_USERNAME || "MCP-Bot",
};

function scheduleReconnect(reason: string) {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.error(`Reconnecting bot after ${reason}...`);
    connectBot();
  }, 5000);
}

/**
 * Helper to connect the bot.
 */
function connectBot() {
  if (isConnecting || bot) {
    return;
  }

  isConnecting = true;
  const currentBot = mineflayer.createBot(botConfig);
  bot = currentBot;
  currentBot.loadPlugin(pathfinder);

  currentBot.once("spawn", () => {
    isConnecting = false;
    console.error(
      `Bot connected and spawned as ${botConfig.username} on ${botConfig.host}:${botConfig.port}`
    );
  });

  currentBot.once("error", (err) => {
    isConnecting = false;
    console.error(`Bot error: ${err.message}`);
    bot = null;
    scheduleReconnect("error");
  });

  currentBot.once("end", () => {
    isConnecting = false;
    bot = null;
    scheduleReconnect("disconnect");
  });
}

function createServer() {
  const server = new McpServer({
    name: pkg.name,
    version: pkg.version,
  });

  registerMultiplayerTools(server, () => bot);
  registerMovementTools(server, () => bot);
  registerMiningTools(server, () => bot);
  registerBuildingTools(server, () => bot);
  registerVisionTools(server, () => bot);
  registerWikiTools(server, () => bot);

  return server;
}

function getSessionId(headerValue: string | string[] | undefined) {
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return headerValue;
}

/**
 * Start the server.
 */
async function main() {
  connectBot();

  // 2. Select transport
  const transportMode = process.env.MCP_TRANSPORT || "stdio";

  if (transportMode === "remote") {
    const port = parseInt(process.env.PORT || "3000");
    const host = process.env.HOST || "0.0.0.0";
    const sessions = new Map<string, StreamableHTTPServerTransport>();

    const app = createMcpExpressApp({ host });

    app.post("/mcp", async (req, res) => {
      const sessionId = getSessionId(req.headers["mcp-session-id"]);

      if (sessionId && sessions.has(sessionId)) {
        const existingTransport = sessions.get(sessionId);
        await existingTransport?.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && req.body?.method === "initialize") {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, transport);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };

        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: Missing session or initialize request",
        },
        id: null,
      });
    });

    app.get("/mcp", async (req, res) => {
      const sessionId = getSessionId(req.headers["mcp-session-id"]);
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: Server not initialized",
          },
          id: null,
        });
        return;
      }

      const existingTransport = sessions.get(sessionId);
      await existingTransport?.handleRequest(req, res);
    });

    app.delete("/mcp", async (req, res) => {
      const sessionId = getSessionId(req.headers["mcp-session-id"]);
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: Invalid session",
          },
          id: null,
        });
        return;
      }

      const existingTransport = sessions.get(sessionId);
      await existingTransport?.handleRequest(req, res);
    });

    app.listen(port, host, () => {
      console.error(`MCP Remote server listening on http://${host}:${port}/mcp`);
    });
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP server running on stdio");
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
