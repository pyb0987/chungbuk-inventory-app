import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { schemaSql } from "./schema.js";

const transactionDepth = new WeakMap();
const transactionCounter = new WeakMap();
const databasePath = new WeakMap();
const openDatabasePaths = new Map();

export function createAppDatabase(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec(schemaSql);
  const resolvedPath = resolveDatabasePath(filename);
  if (resolvedPath) {
    databasePath.set(db, resolvedPath);
    openDatabasePaths.set(resolvedPath, (openDatabasePaths.get(resolvedPath) ?? 0) + 1);
  }
  return db;
}

export function closeDatabase(db) {
  const resolvedPath = databasePath.get(db);
  if (resolvedPath) {
    const count = openDatabasePaths.get(resolvedPath) ?? 0;
    if (count <= 1) {
      openDatabasePaths.delete(resolvedPath);
    } else {
      openDatabasePaths.set(resolvedPath, count - 1);
    }
  }
  db.close();
}

export function withTransaction(db, fn) {
  const depth = transactionDepth.get(db) ?? 0;
  if (depth > 0) {
    const savepoint = nextSavepointName(db);
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = fn();
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  transactionDepth.set(db, 1);
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    transactionDepth.set(db, 0);
  }
}

export function isDatabasePathOpen(filename) {
  const resolvedPath = resolveDatabasePath(filename);
  return resolvedPath ? (openDatabasePaths.get(resolvedPath) ?? 0) > 0 : false;
}

function nextSavepointName(db) {
  const next = (transactionCounter.get(db) ?? 0) + 1;
  transactionCounter.set(db, next);
  return `sp_${next}`;
}

function resolveDatabasePath(filename) {
  if (!filename || filename === ":memory:") {
    return null;
  }
  return resolve(filename);
}
