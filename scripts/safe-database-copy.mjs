import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateAppDatabaseFile } from "../src/services/backups.js";

const [operation, sourceArg, targetArg] = process.argv.slice(2);
if (!["migrate", "backup", "validate"].includes(operation) || !sourceArg) {
  throw new Error("usage: safe-database-copy.mjs <migrate|backup|validate> <source> [target]");
}

const source = resolve(sourceArg);
if (operation === "validate") {
  validateAppDatabaseFile(source);
  process.exit(0);
}
if (!targetArg) throw new Error("target is required");
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
  validateAppDatabaseFile(path);
}
