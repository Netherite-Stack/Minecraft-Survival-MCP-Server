import pino from "pino";

const defaultLevel = process.env.LOG_LEVEL || "info";

export const logger = pino({
  level: defaultLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type LoggerLike = Pick<typeof logger, "info" | "warn" | "error" | "debug">;
