import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [operation, sourceArg, targetArg] = process.argv.slice(2);
if (!["migrate", "backup"].includes(operation) || !sourceArg || !targetArg) {
  throw new Error("usage: safe-database-copy.mjs <migrate|backup> <source> <target>");
}

const source = resolve(sourceArg);
const target = resolve(targetArg);
if (!existsSync(source)) process.exit(operation === "migrate" ? 2 : 0);
if (operation === "migrate" && existsSync(target)) {
  validateDatabase(target);
  process.exit(3);
}

mkdirSync(dirname(target), { recursive: true });
const temporary = `${target}.copy-${process.pid}-${Date.now()}.tmp`;
const sourceDb = new DatabaseSync(source, { readOnly: true });
try {
  await sqliteBackup(sourceDb, temporary);
} finally {
  sourceDb.close();
}

try {
  validateDatabase(temporary);
  renameSync(temporary, target);
  validateDatabase(target);
} catch (error) {
  rmSync(temporary, { force: true });
  throw error;
}

function validateDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = Object.values(db.prepare("PRAGMA integrity_check").get())[0];
    if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity}`);
    const required = new Set(["items", "people", "transactions", "audit_log"]);
    for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
      required.delete(row.name);
    }
    if (required.size) throw new Error(`database is missing tables: ${[...required].join(", ")}`);
    if (db.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("database has foreign-key violations");
    }
  } finally {
    db.close();
  }
}
