import { Database } from "bun:sqlite";

const db = new Database("./data/nyxal.db");
const rows = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all() as { name: string }[];

console.log("tables:", rows.map((r) => r.name).join(", "));
console.log("count:", rows.length);
