import { db } from "../../db";
import { logs } from "../../db/schema";
import { pushLogLive } from "../ws/hub";

const LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
export type LogLevel = (typeof LEVELS)[number];

function ts(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function fmt(level: LogLevel, tag: string, args: unknown[]): string {
  const msg = args
    .map((a) =>
      typeof a === "string"
        ? a
        : a instanceof Error
          ? `${a.message}\n${a.stack}`
          : JSON.stringify(a),
    )
    .join(" ");
  return `[${ts()}] ${level.padEnd(5)} ${tag} ${msg}`;
}

export interface Logger {
  level: LogLevel;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  setLevel: (level: LogLevel) => void;
}

export function createLogger(tag: string, level: LogLevel = "INFO", botId: string | null = null): Logger {
  const logger: Logger = {
    level,
    debug: (...args) => {
      if (LEVELS.indexOf(logger.level) > LEVELS.indexOf("DEBUG")) return;
      const line = fmt("DEBUG", tag, args);
      process.stdout.write(line + "\n");
      void persist("DEBUG", tag, args);
    },
    info: (...args) => {
      if (LEVELS.indexOf(logger.level) > LEVELS.indexOf("INFO")) return;
      const line = fmt("INFO", tag, args);
      process.stdout.write(line + "\n");
      void persist("INFO", tag, args);
    },
    warn: (...args) => {
      if (LEVELS.indexOf(logger.level) > LEVELS.indexOf("WARN")) return;
      const line = fmt("WARN", tag, args);
      process.stderr.write(line + "\n");
      void persist("WARN", tag, args);
    },
    error: (...args) => {
      const line = fmt("ERROR", tag, args);
      process.stderr.write(line + "\n");
      void persist("ERROR", tag, args);
    },
    setLevel: (lvl) => {
      logger.level = lvl;
    },
  };
  return logger;

  // fire and forget: write to db AND push live over ws. never throw.
  async function persist(level: LogLevel, scope: string, args: unknown[]): Promise<void> {
    try {
      const message = args
        .map((a) =>
          typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(a),
        )
        .join(" ");
      const [inserted] = await db
        .insert(logs)
        .values({ botId, level, scope, message, createdAt: new Date() })
        .returning({ id: logs.id });

      pushLogLive({
        id: inserted?.id,
        botId,
        level,
        scope,
        message,
        createdAt: Date.now(),
      });
    } catch {
      // welp nothing we can do now :(
    }
  }
}

export const log = createLogger("system", "INFO", null);
