import { describe, expect, it, vi } from "vitest";
import { startViewerIfEnabled } from "./viewer.js";

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("viewer startup", () => {
  it("does not start viewer when ENABLE_VIEWER is disabled", () => {
    const logger = createLogger();
    const starter = vi.fn();

    const started = startViewerIfEnabled(
      {} as any,
      { mineflayer: starter },
      { ENABLE_VIEWER: "false", VIEWER_PORT: "8080" },
      logger
    );

    expect(started).toBe(false);
    expect(starter).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("starts viewer from top-level mineflayer export", () => {
    const logger = createLogger();
    const starter = vi.fn();

    const started = startViewerIfEnabled(
      {} as any,
      { mineflayer: starter },
      { ENABLE_VIEWER: "1", VIEWER_PORT: "8080" },
      logger
    );

    expect(started).toBe(true);
    expect(starter).toHaveBeenCalledWith(expect.anything(), { port: 8080, firstPerson: true });
    expect(logger.info).toHaveBeenCalledWith({ port: 8080 }, "viewer.started");
  });

  it("starts viewer from nested viewer.mineflayer export", () => {
    const logger = createLogger();
    const starter = vi.fn();

    const started = startViewerIfEnabled(
      {} as any,
      { viewer: { mineflayer: starter } },
      { ENABLE_VIEWER: "true", VIEWER_PORT: "9090" },
      logger
    );

    expect(started).toBe(true);
    expect(starter).toHaveBeenCalledWith(expect.anything(), { port: 9090, firstPerson: true });
  });

  it("logs invalid module export shape", () => {
    const logger = createLogger();

    const started = startViewerIfEnabled(
      {} as any,
      { viewer: {} },
      { ENABLE_VIEWER: "true" },
      logger
    );

    expect(started).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ module_keys: ["viewer"] }),
      "viewer.start_failed_invalid_export"
    );
  });
});
