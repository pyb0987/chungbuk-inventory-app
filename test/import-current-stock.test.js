import test from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, createAppDatabase } from "../src/db/database.js";
import { listImportRuns, listItems, listPeople } from "../src/db/repositories.js";
import { importCurrentStockRows } from "../src/services/import-current-stock.js";
import {
  getDashboardView,
  getImportRunListView,
  getInventoryWorkbookView
} from "../src/services/read-models.js";

test("new app database starts empty before user import", () => {
  const db = createAppDatabase();
  try {
    const dashboard = getDashboardView(db);
    assert.equal(listItems(db).length, 0);
    assert.equal(listPeople(db).length, 0);
    assert.equal(dashboard.totalStock, 0);
    assert.equal(dashboard.partRoomStock, 0);
    assert.equal(dashboard.personalVehicleStock, 0);
    assert.equal(dashboard.officeStock, 0);
  } finally {
    closeDatabase(db);
  }
});

test("importCurrentStockRows imports user-provided current stock rows", () => {
  const db = createAppDatabase();
  try {
    const report = importCurrentStockRows(db, {
      sourceFile: "user-selected-stock.xlsx",
      occurredOn: "2026-07-14",
      rows: [
        {
          rowNumber: 8,
          itemName: "공유기",
          partRoomQuantity: 5,
          officeQuantity: 1,
          personHoldings: {
            정상호: 2,
            김현수: 1
          }
        },
        {
          rowNumber: 9,
          itemName: "모뎀",
          partRoomQuantity: 3,
          personHoldings: {
            정상호: 1
          }
        }
      ]
    });

    const dashboard = getDashboardView(db);
    const inventory = getInventoryWorkbookView(db);
    const runs = listImportRuns(db);
    const importRunView = getImportRunListView(db);

    assert.equal(report.status, "completed");
    assert.equal(report.importedRows, 2);
    assert.equal(report.skippedRows, 0);
    assert.equal(report.createdItems, 2);
    assert.equal(report.createdPeople, 2);
    assert.equal(dashboard.totalStock, 13);
    assert.equal(dashboard.partRoomStock, 8);
    assert.equal(dashboard.personalVehicleStock, 4);
    assert.equal(dashboard.officeStock, 1);
    assert.deepEqual(inventory.columns, [
      "품목",
      "파트실",
      "김현수",
      "정상호",
      "사무실",
      "개인/사무실 합계",
      "합계"
    ]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].sourceFile, "user-selected-stock.xlsx");
    assert.equal(runs[0].status, "completed");
    assert.equal(importRunView[0].report.importedRows, 2);
  } finally {
    closeDatabase(db);
  }
});

test("importCurrentStockRows does not mutate stock when validation fails by default", () => {
  const db = createAppDatabase();
  try {
    const report = importCurrentStockRows(db, {
      sourceFile: "user-selected-stock.xlsx",
      occurredOn: "2026-07-14",
      rows: [
        {
          rowNumber: 1,
          itemName: "정상 품목",
          partRoomQuantity: 1
        },
        {
          rowNumber: 2,
          itemName: "",
          partRoomQuantity: 5
        },
        {
          rowNumber: 3,
          itemName: "잘못된 수량",
          partRoomQuantity: -1
        }
      ]
    });

    const dashboard = getDashboardView(db);
    const runs = listImportRuns(db);

    assert.equal(report.status, "failed_validation");
    assert.equal(report.importedRows, 0);
    assert.equal(report.skippedRows, 2);
    assert.equal(report.errors.length, 2);
    assert.equal(dashboard.totalStock, 0);
    assert.equal(runs[0].report.errors.length, 2);
  } finally {
    closeDatabase(db);
  }
});

test("importCurrentStockRows allows partial import only when explicitly requested", () => {
  const db = createAppDatabase();
  try {
    const report = importCurrentStockRows(db, {
      sourceFile: "user-selected-stock.xlsx",
      occurredOn: "2026-07-14",
      allowPartial: true,
      rows: [
        {
          rowNumber: 1,
          itemName: "정상 품목",
          partRoomQuantity: 1
        },
        {
          rowNumber: 2,
          itemName: "",
          partRoomQuantity: 5
        }
      ]
    });

    const dashboard = getDashboardView(db);
    assert.equal(report.status, "completed_with_errors");
    assert.equal(report.importedRows, 1);
    assert.equal(report.skippedRows, 1);
    assert.equal(dashboard.totalStock, 1);
  } finally {
    closeDatabase(db);
  }
});

test("importCurrentStockRows blocks duplicate opening import by default", () => {
  const db = createAppDatabase();
  try {
    const input = {
      sourceFile: "user-selected-stock.xlsx",
      occurredOn: "2026-07-14",
      rows: [
        {
          itemName: "공유기",
          partRoomQuantity: 5
        }
      ]
    };

    importCurrentStockRows(db, input);
    assert.throws(
      () => importCurrentStockRows(db, input),
      /current stock has already been imported/
    );
    assert.equal(getDashboardView(db).totalStock, 5);
  } finally {
    closeDatabase(db);
  }
});

test("importCurrentStockRows blocks duplicate additive import unless explicitly allowed", () => {
  const db = createAppDatabase();
  try {
    const input = {
      sourceFile: "user-selected-stock.xlsx",
      occurredOn: "2026-07-14",
      rows: [
        {
          itemName: "공유기",
          partRoomQuantity: 5
        }
      ]
    };

    importCurrentStockRows(db, input);
    assert.throws(
      () =>
        importCurrentStockRows(db, {
          ...input,
          mode: "additive"
        }),
      /duplicate current stock import is blocked/
    );
    assert.equal(getDashboardView(db).totalStock, 5);

    const allowedDuplicate = importCurrentStockRows(db, {
      ...input,
      mode: "additive",
      allowDuplicate: true
    });

    assert.equal(allowedDuplicate.status, "completed");
    assert.equal(allowedDuplicate.allowDuplicate, true);
    assert.equal(getDashboardView(db).totalStock, 10);
  } finally {
    closeDatabase(db);
  }
});

test("importCurrentStockRows allows additive import when snapshot content changes", () => {
  const db = createAppDatabase();
  try {
    importCurrentStockRows(db, {
      sourceFile: "user-selected-stock.xlsx",
      occurredOn: "2026-07-14",
      rows: [
        {
          itemName: "공유기",
          partRoomQuantity: 5
        }
      ]
    });

    const report = importCurrentStockRows(db, {
      sourceFile: "user-selected-stock.xlsx",
      occurredOn: "2026-07-14",
      mode: "additive",
      rows: [
        {
          itemName: "공유기",
          partRoomQuantity: 6
        }
      ]
    });

    assert.equal(report.status, "completed");
    assert.equal(getDashboardView(db).totalStock, 11);
  } finally {
    closeDatabase(db);
  }
});
