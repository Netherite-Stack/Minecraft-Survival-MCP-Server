# mc-mcp

A TypeScript Model Context Protocol (MCP) server for Minecraft, powered by [Mineflayer](https://github.com/PrismarineJS/mineflayer).

## Vision: The Helix Approach

This project is inspired by the architecture of **Figure AI’s Helix**. While existing implementations like [yuniko-software/minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server) provide a comprehensive set of low-level tools, **mc-mcp** is designed to shift the burden of "trivial" execution away from the LLM.

- **The Mind (LLM):** Focuses on high-level intent, strategy, and long-term goals.
- **The Body (MCP Server):** Handles the "transactions"—autonomous pathfinding, geometric math, block-by-block construction logic, and environmental processing.

The goal is to prevent the LLM from getting bogged down in coordinate arithmetic or individual tool selection, allowing it to act as a pure cognitive layer.

## Quick Start

### Installation

```bash
npm install
npm run build
```

## The Helix Approach & Key Improvements

Traditional Minecraft MCP implementations often treat the LLM as a "low-level controller." This results in high latency, token waste, and frequent failures due to the LLM struggling with 3D coordinate math or step-by-step block placement.

**mc-mcp** flips this model by implementing a "Transactional Body" architecture:

### 1. Intent vs. Execution (Mind/Body Split)
Instead of asking the LLM to "Move forward, then turn left, then jump," the LLM simply states "Go to the village at [X, Y, Z]." The MCP server (the Body) handles the A* pathfinding, obstacle avoidance, and physics calculations autonomously.

### 2. Transactional Operations
Complex tasks are exposed as single high-level transactions.
*   **Current:** `goto_coordinates`, `list_players`, `find_player`, `get_player_coordinates`, `distance_to_player`, `find_nearest_players`.
*   **Planned:** `build_structure` (Geometric templates handled by the server), `harvest_area` (Area scanning and path optimization).

### 3. Reduced Cognitive Load
By abstracting the "how," the LLM has more context window available for the "why"—allowing for more complex reasoning, multi-agent coordination, and creative problem-solving without being distracted by Minecraft's technical constraints.

### 4. Container-First Architecture
Designed to run in isolated environments (Docker/GHCR), making it easy to deploy "worker bees" that can be controlled by a centralized intelligence.

## Development & Deployment

### Local Development
```bash
npm install
npm run dev
```

### Environment Variables
*   `MCP_TRANSPORT`: Set to `remote` to enable the HTTP/SSE server (default: `stdio`).
*   `PORT`: Port for the remote server (default: `3000`).
*   `HOST`: Host for the remote server (default: `0.0.0.0`).
*   `MC_HOST`: Minecraft server host used at startup (default: `localhost`).
*   `MC_PORT`: Minecraft server port (default: `25565`).
*   `MC_USERNAME`: Bot username (default: `MCP-Bot`).

## Available Tools

- `goto_coordinates`: Autonomous navigation to a destination using A* pathfinding.
- `list_players`: Get all currently known players on the server.
- `find_player`: Search players by partial username (case-insensitive).
- `get_player_coordinates`: Get coordinates of a visible player.
- `distance_to_player`: Calculate 3D distance from the bot to a player in blocks.
- `find_nearest_players`: Find the nearest `x_parameter` visible players.

The server manages exactly one bot process and attempts connection automatically on startup.

## License

MIT
