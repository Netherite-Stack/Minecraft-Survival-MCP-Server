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

### Screenshot Dependency (Optional)

The `capture_bot_view` tool needs `node-canvas-webgl`.

Use Node 24 LTS (or 22 LTS) before installing:

```bash
nvm install 24
nvm use 24
npm install github:PrismarineJS/node-canvas-webgl
```

## The Helix Approach & Key Improvements

Traditional Minecraft MCP implementations often treat the LLM as a "low-level controller." This results in high latency, token waste, and frequent failures due to the LLM struggling with 3D coordinate math or step-by-step block placement.

**mc-mcp** flips this model by implementing a "Transactional Body" architecture:

### 1. Intent vs. Execution (Mind/Body Split)
Instead of asking the LLM to "Move forward, then turn left, then jump," the LLM simply states "Go to the village at [X, Y, Z]." The MCP server (the Body) handles the A* pathfinding, obstacle avoidance, and physics calculations autonomously.

### 2. Transactional Operations
Complex tasks are exposed as single high-level transactions.
*   **Current:** `get_own_position`, `move_to_coordinates`, `move_to_player`, `mine_block_by_coords`, `mine_room`, `break_tree`, `mine_stairs`, `place_block_at`, `place_wall`, `place_ceiling`, `capture_bot_view`, `locate_blocks_in_area`, `locate_dropped_items`, `search_blocks_wiki`, `search_items_wiki`, `list_players`, `find_player`, `get_player_coordinates`, `distance_to_player`, `find_nearest_players`.
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
*   `ENABLE_VIEWER`: Set to `1`/`true` to start prismarine-viewer web stream after bot spawn (default: disabled).
*   `VIEWER_PORT`: Port for prismarine-viewer (default: `3000`).
*   `ENABLE_IMAGES`: Set to `1`/`true` to enable registration of `capture_bot_view`.
*   `LOG_LEVEL`: Pino log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`; default: `info`).

## Available Tools

### Movement Module

- `get_own_position`: Get the bot's current coordinates.
- `move_to_coordinates`: Move to target coordinates. Inputs: `x`, `y`, `z`, `allow_block_breaking`, `allow_block_placement`, `timeout_ms`.
- `move_to_player`: Move near a player. Inputs: `username`, `range`, `allow_block_breaking`, `allow_block_placement`, `timeout_ms`.

### Mining Module

- `mine_block_by_coords`: Mine one block with mineability/tool checks. Inputs: `x`, `y`, `z`, `timeout_ms`.
- `mine_room`: Mine a cuboid area layer-by-layer. Inputs: `start_x`, `start_y`, `start_z`, `length`, `width`, `depth`, `timeout_ms`.
- `break_tree`: Break all connected log-like blocks (`log`, `stem`, `hyphae`). Inputs: `x`, `y`, `z`, `timeout_ms`, `allow_build_up_if_needed`.
- `mine_stairs`: Create a descending stair tunnel to a target depth. Inputs: `depth`, `timeout_ms`.

### Building Module

- `place_block_at`: Place one block at coordinates with support/entity/inventory checks. Inputs: `block_name`, `x`, `y`, `z`, `timeout_ms`.
- `place_wall`: Place a wall plane from start coordinates. Inputs: `block_name`, `start_x`, `start_y`, `start_z`, `x_length`, `y_height`, `z_length`, optional `x_direction`, `y_direction`, `z_direction`, `timeout_ms`. Resource check is enforced before building.
- `place_ceiling`: Place a ceiling plane from start coordinates. Inputs: `block_name`, `start_x`, `start_y`, `start_z`, `x_length`, `z_length`, optional `x_direction`, `z_direction`, `timeout_ms`. Resource check is enforced before building.

### Vision Module

- `capture_bot_view`: Capture a first-person screenshot from the bot. Inputs: `width` (default `800`), `height` (default `400`), `view_distance` in blocks (default `96`), `quality`, `look_at_x`, `look_at_y`, `look_at_z`.
- `locate_blocks_in_area`: Locate blocks by name/id/wildcard, sorted by nearest. Inputs: `query`, `radius`, `max_results`, optional `center_x`, `center_y`, `center_z`.
- `locate_dropped_items`: Locate dropped item entities, sorted by nearest. Inputs: `radius`, `max_results`, optional `query`.

### Wiki Module

- `search_blocks_wiki`: Search block names and ids from Mineflayer's built-in registry. Inputs: `query`, `max_results`.
- `search_items_wiki`: Search item names and ids from Mineflayer's built-in registry. Inputs: `query`, `max_results`.

### Multiplayer Module

- `list_players`: Get all currently known players on the server.
- `find_player`: Search players by partial username (case-insensitive). Inputs: `query`.
- `get_player_coordinates`: Get coordinates of a visible player. Inputs: `username`.
- `distance_to_player`: Calculate 3D distance from the bot to a player in blocks. Inputs: `username`.
- `find_nearest_players`: Find nearest visible players. Inputs: `x_parameter`.

The server manages exactly one bot process and attempts connection automatically on startup.

## License

MIT
