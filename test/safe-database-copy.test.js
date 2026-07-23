import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAppDatabase, closeDatabase, CURRENT_SCHEMA_VERSION } from "../src/db/database.js";
import { createItem } from "../src/db/repositories.js";

test("safe database copy includes committed WAL rows and validates the snapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "chungbuk-safe-copy-"));
  const source = join(directory, "source.sqlite");
  const target = join(directory, "target.sqlite");
  const db = createAppDatabase(source);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA wal_autocheckpoint = 0");
  createItem(db, { name: "WAL 최신 품목" });

  execFileSync(process.execPath, [
    join(process.cwd(), "scripts", "safe-database-copy.mjs"),
    "backup",
    source,
    target
  ]);

  const copied = new DatabaseSync(target, { readOnly: true });
  assert.equal(copied.prepare("SELECT name FROM items").get().name, "WAL 최신 품목");
  assert.equal(copied.prepare("PRAGMA user_version").get().user_version, CURRENT_SCHEMA_VERSION);
  copied.close();
  closeDatabase(db);
});

test("database initialization records and rejects unsupported schema versions", () => {
  const db = createAppDatabase();
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, CURRENT_SCHEMA_VERSION);
  closeDatabase(db);

  const newer = new DatabaseSync(":memory:");
  newer.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
  assert.throws(() => {
    // Persist the newer schema in a temporary file for createAppDatabase to inspect.
    const directory = mkdtempSync(join(tmpdir(), "chungbuk-schema-"));
    const path = join(directory, "newer.sqlite");
    const disk = new DatabaseSync(path);
    disk.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
    disk.close();
    createAppDatabase(path);
  }, /newer than supported/);
  newer.close();
});

test("safe database validation rejects incomplete and malformed schemas", () => {
  const directory = mkdtempSync(join(tmpdir(), "chungbuk-incomplete-"));
  const incomplete = join(directory, "incomplete.sqlite");
  const db = new DatabaseSync(incomplete);
  db.exec(`
    CREATE TABLE items (id INTEGER PRIMARY KEY);
    CREATE TABLE people (id INTEGER PRIMARY KEY);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY);
  `);
  db.close();

  assert.throws(
    () =>
      execFileSync(process.execPath, [
        join(process.cwd(), "scripts", "safe-database-copy.mjs"),
        "validate",
        incomplete
      ]),
    /missing/
  );
  assert.throws(() => createAppDatabase(incomplete), /missing columns/);
});
