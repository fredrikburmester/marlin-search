import { createLogger, format, transports } from "winston";

const { colorize, combine, errors, printf, timestamp } = format;

export const logger = createLogger({
  level: process.env.LOG_LEVEL?.trim() || "info",
  format: combine(
    // Only colorize for terminals
    ...(process.stdout.isTTY ? [colorize()] : []),
    errors({ stack: true }),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    printf(
      ({ timestamp, level, message, stack }) =>
        `[${timestamp}] [${level}] ${stack ?? message}`
    )
  ),
  transports: [new transports.Console()],
});
