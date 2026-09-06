import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "../config.js";

const dbPath = path.resolve(config.dbPath);
mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
