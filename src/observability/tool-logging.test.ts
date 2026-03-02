import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { attachToolLogging } from "./tool-logging.js";

type ToolHandler = (args?: Record<string, unknown>) => Promise<unknown>;

function createHarness() {
  const tools = new Map<string, ToolHandler>();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const server = {
    registerTool(name: string, _config: unknown, cb: ToolHandler) {
      tools.set(name, cb);
      return {} as any;
    },
  } as unknown as McpServer;

  attachToolLogging(server, logger);

  return {
    logger,
    register(name: string, cb: ToolHandler) {
      server.registerTool(name, {}, cb as any);
    },
    async call(name: string, args?: Record<string, unknown>) {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }

      return tool(args);
    },
  };
}

describe("tool logging wrapper", () => {
  it("logs start and success for healthy tool calls", async () => {
    const harness = createHarness();
    harness.register("sample_tool", async () => ({ content: [] }));

    await harness.call("sample_tool", { a: 1 });

    expect(harness.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "sample_tool", input: '{"a":1}' }),
      "tool.start"
    );
    expect(harness.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "sample_tool", duration_ms: expect.any(Number) }),
      "tool.done"
    );
    expect(harness.logger.warn).not.toHaveBeenCalled();
    expect(harness.logger.error).not.toHaveBeenCalled();
  });

  it("logs done_error when tool returns isError", async () => {
    const harness = createHarness();
    harness.register("error_tool", async () => ({ isError: true, content: [] }));

    await harness.call("error_tool", { reason: "bad_input" });

    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "error_tool", duration_ms: expect.any(Number) }),
      "tool.done_error"
    );
  });

  it("logs crash and rethrows when handler throws", async () => {
    const harness = createHarness();
    harness.register("crash_tool", async () => {
      throw new Error("boom");
    });

    await expect(harness.call("crash_tool", { x: 42 })).rejects.toThrow("boom");

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "crash_tool",
        duration_ms: expect.any(Number),
        err: expect.any(Error),
      }),
      "tool.crash"
    );
  });
});
