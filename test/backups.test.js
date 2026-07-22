import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, createAppDatabase } from "../src/db/database.js";
import { Buckets } from "../src/domain/stock-engine.js";
import {
  createItem,
  createPerson,
  createSerialNumber,
  createStockAdjustment,
  listBackupRecords,
  listItems,
  recordTransaction
} from "../src/db/repositories.js";
import {
  createDatabaseBackup,
  ensureDailyBackup,
  restoreDatabaseFile,
  validateSqliteFile
} from "../src/services/backups.js";

test("createDatabaseBackup writes a SQLite backup and records metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chungbuk-backup-test-"));
  const dbPath = join(dir, "app.sqlite");
  const backupDir = join(dir, "backups");
  const db = createAppDatabase(dbPath);

  try {
    createItem(db, { name: "모뎀" });

    const backup = await createDatabaseBackup(db, {
      backupDir,
      reason: "manual backup",
      createdAt: new Date("2026-07-14T00:00:00.000Z")
    });

    const records = listBackupRecords(db);
    assert.equal(existsSync(backup.filePath), true);
    assert.equal(backup.sizeBytes > 0, true);
    assert.equal(records.length, 1);
    assert.equal(records[0].reason, "manual backup");
    assert.equal(records[0].status, "created");
    validateSqliteFile(backup.filePath);
  } finally {
    closeDatabase(db);
  }
});

test("ensureDailyBackup creates at most one automatic backup per day", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chungbuk-daily-backup-test-"));
  const dbPath = join(dir, "app.sqlite");
  const backupDir = join(dir, "backups");
  const db = createAppDatabase(dbPath);

  try {
    const first = await ensureDailyBackup(db, {
      backupDir,
      createdAt: new Date("2026-07-14T03:00:00.000Z")
    });
    createItem(db, { name: "공유기" });
    const second = await ensureDailyBackup(db, {
      backupDir,
      createdAt: new Date("2026-07-14T08:00:00.000Z")
    });

    const records = listBackupRecords(db);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.backup.id, first.backup.id);
    assert.equal(records.length, 1);
    assert.match(records[0].reason, /automatic daily backup 2026-07-14/);
  } finally {
    closeDatabase(db);
  }
});

test("restoreDatabaseFile replaces a database with a validated backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chungbuk-restore-test-"));
  const dbPath = join(dir, "app.sqlite");
  const backupDir = join(dir, "backups");

  const db = createAppDatabase(dbPath);
  let backupPath;
  try {
    createItem(db, { name: "공유기" });
    const backup = await createDatabaseBackup(db, {
      backupDir,
      reason: "before bad edit",
      createdAt: new Date("2026-07-14T01:00:00.000Z")
    });
    backupPath = backup.filePath;
    createItem(db, { name: "잘못 추가된 품목" });
  } finally {
    closeDatabase(db);
  }

  const result = restoreDatabaseFile({ backupPath, databasePath: dbPath });
  assert.equal(result.sizeBytes > 0, true);

  const restored = createAppDatabase(dbPath);
  try {
    assert.deepEqual(
      listItems(restored).map((item) => item.name),
      ["공유기"]
    );
  } finally {
    closeDatabase(restored);
  }
});

test("restoreDatabaseFile rejects non-SQLite backup files", () => {
  const dir = mkdtempSync(join(tmpdir(), "chungbuk-invalid-backup-test-"));
  const dbPath = join(dir, "app.sqlite");
  const badBackupPath = join(dir, "bad.sqlite");
  writeFileSync(badBackupPath, "not sqlite");

  assert.throws(
    () => restoreDatabaseFile({ backupPath: badBackupPath, databasePath: dbPath }),
    /file is not a database|database disk image is malformed|SQLite/
  );
});

test("restoreDatabaseFile rejects SQLite files that are not app backups", () => {
  const dir = mkdtempSync(join(tmpdir(), "chungbuk-wrong-schema-restore-test-"));
  const dbPath = join(dir, "app.sqlite");
  const wrongBackupPath = join(dir, "wrong-schema.sqlite");
  const wrongDb = new DatabaseSync(wrongBackupPath);
  wrongDb.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
  wrongDb.close();

  assert.throws(
    () => restoreDatabaseFile({ backupPath: wrongBackupPath, databasePath: dbPath }),
    /missing app tables/
  );
});

test("restoreDatabaseFile rejects app backups with invalid stock rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chungbuk-invalid-stock-restore-test-"));
  const dbPath = join(dir, "app.sqlite");
  const backupDir = join(dir, "backups");
  const db = createAppDatabase(dbPath);
  let backupPath;
  try {
    createItem(db, { name: "공유기" });
    const backup = await createDatabaseBackup(db, {
      backupDir,
      reason: "before invalid stock row",
      createdAt: new Date("2026-07-14T01:30:00.000Z")
    });
    backupPath = backup.filePath;
  } finally {
    closeDatabase(db);
  }

  const backupDb = new DatabaseSync(backupPath);
  try {
    backupDb
      .prepare(
        `INSERT INTO stock_adjustments
          (occurred_on, item_id, bucket, holder_id, quantity_delta, reason)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("2026-07-14", 1, "partroom_typo", null, 7, "manual corruption");
  } finally {
    backupDb.close();
  }

  assert.throws(
    () => restoreDatabaseFile({ backupPath, databasePath: dbPath }),
    /invalid stock adjustment bucket/
  );
});

test("restoreDatabaseFile rejects app backups missing serial numbers table", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chungbuk-missing-serials-restore-test-"));
  const dbPath = join(dir, "app.sqlite");
  const backupDir = join(dir, "backups");
  const db = createAppDatabase(dbPath);
  let backupPath;
  try {
    const item = createItem(db, { name: "LTE" });
    createSerialNumber(db, {
      itemId: item.id,
      serialText: "SN-001",
      holderText: "파트실"
    });
    const backup = await createDatabaseBackup(db, {
      backupDir,
      reason: "before serial table corruption",
      createdAt: new Date("2026-07-14T01:40:00.000Z")
    });
    backupPath = backup.filePath;
  } finally {
    closeDatabase(db);
  }

  const backupDb = new DatabaseSync(backupPath);
  try {
    backupDb.exec("DROP TABLE serial_numbers");
  } finally {
    backupDb.close();
  }

  assert.throws(
    () => restoreDatabaseFile({ backupPath, databasePath: dbPath }),
    /missing app tables: serial_numbers/
  );
});

test("restoreDatabaseFile rejects app backups with invalid boolean flags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chungbuk-invalid-boolean-restore-test-"));
  const dbPath = join(dir, "app.sqlite");
  const backupDir = join(dir, "backups");
  const db = createAppDatabase(dbPath);
  let backupPath;
  try {
    const item = createItem(db, { name: "공유기" });
    const person = createPerson(db, { name: "정상호" });
    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 3,
      reason: "opening"
    });
    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: person.id,
      quantity: 1
    });
    const backup = await createDatabaseBackup(db, {
      backupDir,
      reason: "before boolean corruption",
      createdAt: new Date("2026-07-14T01:50:00.000Z")
    });
    backupPath = backup.filePath;
  } finally {
    closeDatabase(db);
  }

  const backupDb = new DatabaseSync(backupPath);
  try {
    backupDb.prepare("UPDATE transactions SET is_deleted = 2").run();
  } finally {
    backupDb.close();
  }

  assert.throws(
    () => restoreDatabaseFile({ backupPath, databasePath: dbPath }),
    /invalid boolean transactions\.is_deleted/
  );
});

test("restoreDatabaseFile rejects app backups with invalid active flags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chungbuk-invalid-active-restore-test-"));
  const dbPath = join(dir, "app.sqlite");
  const backupDir = join(dir, "backups");
  const db = createAppDatabase(dbPath);
  let backupPath;
  try {
    const item = createItem(db, { name: "LTE" });
    createSerialNumber(db, {
      itemId: item.id,
      serialText: "SN-001",
      holderText: "파트실"
    });
    const backup = await createDatabaseBackup(db, {
      backupDir,
      reason: "before active flag corruption",
      createdAt: new Date("2026-07-14T01:55:00.000Z")
    });
    backupPath = backup.filePath;
  } finally {
    closeDatabase(db);
  }

  const backupDb = new DatabaseSync(backupPath);
  try {
    backupDb.prepare("UPDATE serial_numbers SET is_active = 7").run();
  } finally {
    backupDb.close();
  }

  assert.throws(
    () => restoreDatabaseFile({ backupPath, databasePath: dbPath }),
    /invalid boolean serial_numbers\.is_active/
  );
});

test("restoreDatabaseFile rejects restore while target database is open", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chungbuk-open-restore-test-"));
  const dbPath = join(dir, "app.sqlite");
  const backupDir = join(dir, "backups");
  const db = createAppDatabase(dbPath);
  try {
    createItem(db, { name: "공유기" });
    const backup = await createDatabaseBackup(db, {
      backupDir,
      reason: "before restore",
      createdAt: new Date("2026-07-14T02:00:00.000Z")
    });

    assert.throws(
      () => restoreDatabaseFile({ backupPath: backup.filePath, databasePath: dbPath }),
      /database must be closed/
    );
  } finally {
    closeDatabase(db);
  }
});
