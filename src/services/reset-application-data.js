import { withTransaction } from "../db/database.js";
import { createBackupRecord } from "../db/repositories.js";

const applicationTables = [
  "transactions",
  "stock_adjustments",
  "serial_numbers",
  "legacy_usage_records",
  "audit_log",
  "import_runs",
  "backups",
  "items",
  "people"
];

export function resetApplicationData(db, emergencyBackup) {
  return withTransaction(db, () => {
    for (const table of applicationTables) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.exec("DELETE FROM sqlite_sequence");

    const backupId = createBackupRecord(db, {
      filePath: emergencyBackup.filePath,
      reason: emergencyBackup.reason,
      status: emergencyBackup.status,
      sizeBytes: emergencyBackup.sizeBytes,
      createdAt: emergencyBackup.createdAt
    });

    return { ...emergencyBackup, id: backupId };
  });
}
