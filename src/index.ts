import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import mineflayer from "mineflayer";
import { pathfinder, Movements, goals } from "mineflayer-pathfinder";
import { randomUUID } from "node:crypto";
import pkg from "../package.json" with { type: "json" };

/**
 * Define your MCP server using the modern McpServer class.
 */
const server = new McpServer({
  name: pkg.name,
  version: pkg.version,
});

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

/**
 * Register the goto_coordinates tool.
 */
server.tool(
  "goto_coordinates",
  {
    x: z.number(),
    y: z.number(),
    z: z.number(),
  },
  async ({ x, y, z: coordZ }) => {
    if (!bot) {
      return {
        content: [{ type: "text", text: "Bot is not connected yet. Check MC_HOST/MC_PORT/MC_USERNAME." }],
        isError: true,
      };
    }

    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(new goals.GoalBlock(x, y, coordZ));

    return {
      content: [{ type: "text", text: `Pathfinding to ${x}, ${y}, ${coordZ}...` }],
    };
  }
);

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
    
    const app = createMcpExpressApp({ host });
    
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID()
    });

    await server.connect(transport);

    app.all("/mcp", async (req, res) => {
      await transport.handleRequest(req, res);
    });

    app.listen(port, host, () => {
      console.error(`MCP Remote server listening on http://${host}:${port}/mcp`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP server running on stdio");
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
