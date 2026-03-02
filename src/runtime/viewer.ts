import type mineflayer from "mineflayer";
import type { LoggerLike } from "../observability/logger.js";

type ViewerStarter = (bot: mineflayer.Bot, options: { port: number; firstPerson: boolean }) => void;

type ViewerModule = {
  mineflayer?: ViewerStarter;
  viewer?: {
    mineflayer?: ViewerStarter;
  };
};

function isTruthyEnv(value: string | undefined) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function startViewerIfEnabled(
  bot: mineflayer.Bot,
  viewerModule: ViewerModule,
  env: NodeJS.ProcessEnv,
  logger: LoggerLike
) {
  if (!isTruthyEnv(env.ENABLE_VIEWER)) {
    return false;
  }

  const viewerPort = parseInt(env.VIEWER_PORT || "3000", 10);
  const startViewer = viewerModule.mineflayer || viewerModule.viewer?.mineflayer;

  if (typeof startViewer !== "function") {
    logger.error(
      {
        module_keys: Object.keys(viewerModule),
      },
      "viewer.start_failed_invalid_export"
    );
    return false;
  }

  try {
    startViewer(bot, { port: viewerPort, firstPerson: true });
    logger.info({ port: viewerPort }, "viewer.started");
    return true;
  } catch (error: unknown) {
    logger.error({ err: error, port: viewerPort }, "viewer.start_failed");
    return false;
  }
}
