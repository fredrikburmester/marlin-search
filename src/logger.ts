import { createLogger, format, transports } from "winston";
import "winston-daily-rotate-file";

export const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.printf(
      ({ timestamp, level, message }) => `[${timestamp}] [${level}] ${message}`
    )
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple()),
    }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new transports.DailyRotateFile({
      filename: "app-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxFiles: "14d",
    })
  );
}
