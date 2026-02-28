import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import mineflayer from "mineflayer";
import { pathfinder, Movements, goals } from "mineflayer-pathfinder";
import { randomUUID } from "node:crypto";

/**
 * Define your MCP server.
 */
const server = new Server(
  {
    name: "mc-mcp-mineflayer",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

let bot: mineflayer.Bot | null = null;

/**
 * Helper to connect the bot.
 */
async function connectBot(host: string, port: number, username: string): Promise<string> {
  if (bot) {
    bot.quit();
  }

  return new Promise((resolve, reject) => {
    bot = mineflayer.createBot({
      host,
      port,
      username,
    });

    bot.loadPlugin(pathfinder);

    bot.once("spawn", () => {
      resolve(`Bot connected and spawned as ${username} on ${host}:${port}`);
    });

    bot.on("error", (err) => {
      reject(new Error(`Error connecting bot: ${err.message}`));
    });
  });
}

/**
 * List available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "connect_bot",
        description: "Connect the Mineflayer bot to a server",
        inputSchema: {
          type: "object",
          properties: {
            host: { type: "string", description: "Minecraft server host" },
            port: { type: "number", description: "Minecraft server port", default: 25565 },
            username: { type: "string", description: "Bot username", default: "MCP-Bot" },
          },
          required: ["host"],
        },
      },
      {
        name: "goto_coordinates",
        description: "Move the bot to specific coordinates using pathfinding",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          required: ["x", "y", "z"],
        },
      },
    ],
  };
});

/**
 * Handle tool calls.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "connect_bot") {
    const { host, port, username } = z
      .object({
        host: z.string(),
        port: z.number().default(25565),
        username: z.string().default("MCP-Bot"),
      })
      .parse(args);

    try {
      const message = await connectBot(host, port, username);
      return { content: [{ type: "text", text: message }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  }

  if (name === "goto_coordinates") {
    if (!bot) {
      return {
        content: [{ type: "text", text: "Bot is not connected. Use connect_bot first." }],
        isError: true,
      };
    }

    const { x, y, z: coordZ } = z
      .object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      })
      .parse(args);

    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(new goals.GoalBlock(x, y, coordZ));

    return {
      content: [{ type: "text", text: `Pathfinding to ${x}, ${y}, ${coordZ}...` }],
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

/**
 * Start the server.
 */
async function main() {
  // 1. Auto-connect if environment variables are set
  const autoHost = process.env.MC_HOST;
  const autoPort = parseInt(process.env.MC_PORT || "25565");
  const autoUsername = process.env.MC_USERNAME || "MCP-Bot";

  if (autoHost) {
    console.error(`Attempting auto-connect to ${autoHost}:${autoPort}...`);
    connectBot(autoHost, autoPort, autoUsername)
      .then((msg) => console.error(msg))
      .catch((err) => console.error(err.message));
  }

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
