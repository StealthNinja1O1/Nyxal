import { dirname, join, resolve } from "node:path";

declare const __COMPILED__: boolean | undefined;

const isCompiled = typeof __COMPILED__ !== "undefined" && __COMPILED__ === true;

export const appRoot = process.env.NYXAL_ROOT
  ? resolve(process.env.NYXAL_ROOT)
  : isCompiled
    ? dirname(process.execPath)
    : resolve(import.meta.dirname, "..");

export const webDistDir = join(appRoot, "web", "dist");
export const migrationsDir = join(appRoot, "server", "db", "migrations");
export const dbPath = process.env.NYXAL_DB_PATH || join(appRoot, "data", "nyxal.db");
