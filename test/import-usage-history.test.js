import test from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, createAppDatabase } from "../src/db/database.js";
import {
  createItem,
  createStockAdjustment,
  listImportRuns,
  listLegacyUsageRecords
} from "../src/db/repositories.js";
import { Buckets } from "../src/domain/stock-engine.js";
import { getDashboardView } from "../src/services/read-models.js";
import { importUsageHistoryRows } from "../src/services/import-usage-history.js";

test("importUsageHistoryRows stores reference rows without changing stock", () => {
  const db = createAppDatabase(":memory:");
  try {
    const item = createItem(db, { name: "공유기" });
    createStockAdjustment(db, {
      occurredOn: "2026-06-01",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 5,
      reason: "opening"
    });
    const before = getDashboardView(db);

    const report = importUsageHistoryRows(db, {
      sourceFile: "usage.xlsx",
      rows: [
        {
          sourceSheet: "출고",
          rowNumber: 3,
          occurredOn: "2026-02-01",
          legacyLabel: "출고",
          appType: "personal_out",
          personName: "정상호",
          itemName: "공유기",
          serialText: "SN-1",
          quantity: 2,
          note: "테스트"
        }
      ]
    });
    const after = getDashboardView(db);

    assert.equal(report.status, "completed");
    assert.equal(report.importedRows, 1);
    assert.equal(listLegacyUsageRecords(db).length, 1);
    assert.equal(after.totalStock, before.totalStock);
    assert.equal(after.partRoomStock, before.partRoomStock);
  } finally {
    closeDatabase(db);
  }
});

test("importUsageHistoryRows blocks duplicate reference imports by default", () => {
  const db = createAppDatabase(":memory:");
  try {
    const input = {
      sourceFile: "usage.xlsx",
      rows: [
        {
          sourceSheet: "반납",
          rowNumber: 2,
          legacyLabel: "반납",
          appType: "return_to_seoul",
          itemName: "공유기",
          quantity: 1
        }
      ]
    };

    importUsageHistoryRows(db, input);
    assert.throws(() => importUsageHistoryRows(db, input), /duplicate usage history import is blocked/);
    assert.equal(listImportRuns(db).length, 1);
  } finally {
    closeDatabase(db);
  }
});
