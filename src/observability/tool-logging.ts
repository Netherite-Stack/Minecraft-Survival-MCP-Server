import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LoggerLike } from "./logger.js";

function serializeToolInput(input: unknown) {
  if (input === undefined) {
    return "{}";
  }

  try {
    const json = JSON.stringify(input);
    if (!json) {
      return "{}";
    }

    if (json.length > 1000) {
      return `${json.slice(0, 1000)}...`;
    }

    return json;
  } catch {
    return "<unserializable-input>";
  }
}

export function attachToolLogging(server: McpServer, logger: LoggerLike) {
  const registerTool = server.registerTool.bind(server);

  (server as any).registerTool = ((
    toolName: string,
    config: unknown,
    handler: (args: unknown) => Promise<unknown>
  ) => {
    const wrappedHandler = async (args: unknown) => {
      const startedAt = Date.now();
      logger.info({ tool: toolName, input: serializeToolInput(args) }, "tool.start");

      try {
        const result = await handler(args);
        const durationMs = Date.now() - startedAt;
        const isError = Boolean((result as { isError?: boolean } | undefined)?.isError);

        if (isError) {
          logger.warn({ tool: toolName, duration_ms: durationMs }, "tool.done_error");
        } else {
          logger.info({ tool: toolName, duration_ms: durationMs }, "tool.done");
        }

        return result;
      } catch (error: unknown) {
        const durationMs = Date.now() - startedAt;
        logger.error(
          {
            tool: toolName,
            duration_ms: durationMs,
            err: error,
          },
          "tool.crash"
        );
        throw error;
      }
    };

    return registerTool(toolName, config as any, wrappedHandler as any);
  }) as typeof server.registerTool;
}
