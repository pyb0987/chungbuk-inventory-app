import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateCurrentStockMap,
  createBackupRecord,
  listBackupRecords
} from "../db/repositories.js";
import { CURRENT_SCHEMA_VERSION, isDatabasePathOpen } from "../db/database.js";
import { assertDatabaseSchema } from "../db/schema-contract.js";
import { assertValidStock, Buckets, TransactionTypes } from "../domain/stock-engine.js";

export async function createDatabaseBackup(db, options) {
  const backupDir = requireText(options.backupDir, "backup directory");
  const reason = requireText(options.reason, "backup reason");
  const createdAt = options.createdAt ?? new Date();

  mkdirSync(backupDir, { recursive: true });
  const targetPath = resolve(backupDir, buildBackupFilename(createdAt));

  await sqliteBackup(db, targetPath);

  const sizeBytes = statSync(targetPath).size;
  const id = createBackupRecord(db, {
    filePath: targetPath,
    reason,
    status: "created",
    sizeBytes,
    createdAt
  });

  return {
    id,
    filePath: targetPath,
    reason,
    status: "created",
    sizeBytes,
    createdAt
  };
}

export async function ensureDailyBackup(db, options) {
  const backupDir = requireText(options.backupDir, "backup directory");
  const createdAt = options.createdAt ?? new Date();
  const dayKey = createdAt.toISOString().slice(0, 10);
  const reason = options.reason ?? `automatic daily backup ${dayKey}`;
  const existing = listBackupRecords(db).find(
    (backup) =>
      backup.status === "created" &&
      backup.reason.startsWith("automatic daily backup") &&
      String(backup.createdAt).slice(0, 10) === dayKey
  );

  if (existing) {
    return { created: false, backup: existing };
  }

  const backup = await createDatabaseBackup(db, {
    backupDir,
    reason,
    createdAt
  });
  return { created: true, backup };
}

export function restoreDatabaseFile({ backupPath, databasePath }) {
  const source = resolve(requireText(backupPath, "backup path"));
  const target = resolve(requireText(databasePath, "database path"));
  if (isDatabasePathOpen(target)) {
    throw new Error("database must be closed before restore");
  }
  const tempTarget = `${target}.restore-${process.pid}-${Date.now()}.tmp`;

  validateSqliteFile(source);
  try {
    copyFileSync(source, tempTarget);
    validateAppDatabaseFile(tempTarget);
    renameSync(tempTarget, target);
  } catch (error) {
    try {
      unlinkSync(tempTarget);
    } catch {
      // Ignore cleanup failures; the original database was not replaced.
    }
    throw error;
  }

  return {
    restoredFrom: source,
    restoredTo: target,
    sizeBytes: statSync(target).size
  };
}

export function validateSqliteFile(filePath) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA integrity_check").get();
    const result = Object.values(row)[0];
    if (result !== "ok") {
      throw new Error(`sqlite integrity check failed: ${result}`);
    }
  } finally {
    db.close();
  }
}

export function validateAppDatabaseFile(filePath) {
  validateSqliteFile(filePath);
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    assertDatabaseSchema(db);
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new Error(`backup schema ${version} is newer than supported ${CURRENT_SCHEMA_VERSION}`);
    }
    validateForeignKeys(db);
    validatePersistedStockRows(db);
    assertValidStock(calculateCurrentStockMap(db));
  } finally {
    db.close();
  }
}

function validateForeignKeys(db) {
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new Error("backup has foreign key violations");
  }
}

function validatePersistedStockRows(db) {
  validateBooleanColumns(db);
  validateStockAdjustments(db);
  validateTransactions(db);
  validateSerialNumbers(db);
}

function validateBooleanColumns(db) {
  validateBooleanColumn(db, "items", "is_active");
  validateBooleanColumn(db, "people", "is_active");
  validateBooleanColumn(db, "transactions", "is_deleted");
  validateBooleanColumn(db, "serial_numbers", "is_active");
}

function validateBooleanColumn(db, tableName, columnName) {
  const rows = db
    .prepare(
      `SELECT id, ${columnName} AS value
       FROM ${tableName}
       WHERE ${columnName} NOT IN (0, 1)`
    )
    .all();

  if (rows.length > 0) {
    throw new Error(
      `backup has invalid boolean ${tableName}.${columnName} at row ${rows[0].id}: ${rows[0].value}`
    );
  }
}

function validateStockAdjustments(db) {
  const validBuckets = [Buckets.PART_ROOM, Buckets.OFFICE, Buckets.PERSON];
  const rows = db
    .prepare("SELECT id, bucket, holder_id AS holderId FROM stock_adjustments")
    .all();

  for (const row of rows) {
    if (!validBuckets.includes(row.bucket)) {
      throw new Error(`backup has invalid stock adjustment bucket at row ${row.id}: ${row.bucket}`);
    }
    if (row.bucket === Buckets.PERSON) {
      if (!row.holderId) {
        throw new Error(`backup has person stock without holder at row ${row.id}`);
      }
      const person = db.prepare("SELECT id FROM people WHERE id = ?").get(row.holderId);
      if (!person) {
        throw new Error(`backup has person stock with unknown holder at row ${row.id}`);
      }
      continue;
    }
    if (row.holderId) {
      throw new Error(`backup has holder on ${row.bucket} stock at row ${row.id}`);
    }
  }
}

function validateTransactions(db) {
  const validTypes = Object.values(TransactionTypes).filter(
    (type) => type !== TransactionTypes.ADJUSTMENT
  );
  const rows = db.prepare("SELECT id, type, person_id AS personId FROM transactions").all();

  for (const row of rows) {
    if (!validTypes.includes(row.type)) {
      throw new Error(`backup has invalid transaction type at row ${row.id}: ${row.type}`);
    }
    const requiresPerson = [
      TransactionTypes.PERSONAL_IN,
      TransactionTypes.PERSONAL_OUT,
      TransactionTypes.PERSONAL_INSTALL,
      TransactionTypes.PERSONAL_RECOVER
    ].includes(row.type);
    if (requiresPerson && !row.personId) {
      throw new Error(`backup has personal transaction without person at row ${row.id}`);
    }
    if (!requiresPerson && row.personId) {
      throw new Error(`backup has non-personal transaction with person at row ${row.id}`);
    }
  }
}

function validateSerialNumbers(db) {
  const rows = db
    .prepare(
      `SELECT id, serial_text AS serialText
       FROM serial_numbers
       WHERE trim(serial_text) = ''`
    )
    .all();

  if (rows.length > 0) {
    throw new Error(`backup has blank serial number at row ${rows[0].id}`);
  }
}

function buildBackupFilename(date) {
  const timestamp = date
    .toISOString()
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replace("T", "_")
    .replace("Z", "");
  return `chungbuk-inventory_${timestamp}.sqlite`;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}
