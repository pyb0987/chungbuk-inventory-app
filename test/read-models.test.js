import test from "node:test";
import assert from "node:assert/strict";
import { Buckets } from "../src/domain/stock-engine.js";
import { closeDatabase, createAppDatabase } from "../src/db/database.js";
import {
  createBackupRecord,
  createItem,
  createPerson,
  createSerialNumber,
  createStockAdjustment,
  deactivateSerialNumber,
  deleteTransaction,
  recordTransaction,
  restoreSerialNumber,
  restoreTransaction
} from "../src/db/repositories.js";
import {
  getAuditLogView,
  getBackupListView,
  getDashboardView,
  getInventoryWorkbookView,
  getSerialNumberView,
  getTransactionHistoryView
} from "../src/services/read-models.js";

test("dashboard view exposes Excel-familiar totals", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "공유기" });
    const person = createPerson(db, { name: "김현수" });

    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 10,
      reason: "opening balance"
    });
    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: person.id,
      quantity: 3
    });
    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "사무실 사용/보유",
      itemId: item.id,
      quantity: 2
    });
    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "서울로 반납",
      itemId: item.id,
      quantity: 1
    });
    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "서울 입고",
      itemId: item.id,
      quantity: 4
    });
    const deletedTransaction = recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: person.id,
      quantity: 1
    });
    deleteTransaction(db, deletedTransaction.id, { reason: "dashboard deleted count" });
    const deletedSerial = createSerialNumber(db, {
      itemId: item.id,
      serialText: "SER-DELETED",
      holderText: "파트실"
    });
    createSerialNumber(db, {
      itemId: item.id,
      serialText: "SER-ACTIVE",
      holderText: "파트실"
    });
    deactivateSerialNumber(db, deletedSerial.id, { reason: "dashboard deleted serial count" });
    createBackupRecord(db, {
      filePath: "backups/sample.sqlite",
      reason: "manual",
      status: "created"
    });

    const dashboard = getDashboardView(db);
    assert.equal(dashboard.totalStock, 13);
    assert.equal(dashboard.partRoomStock, 8);
    assert.equal(dashboard.personalVehicleStock, 3);
    assert.equal(dashboard.officeStock, 2);
    assert.equal(dashboard.seoulReturnedCount, 1);
    assert.equal(dashboard.seoulReceivedCount, 4);
    assert.equal(dashboard.activeTransactionCount, 4);
    assert.equal(dashboard.deletedTransactionCount, 1);
    assert.equal(dashboard.activeSerialCount, 1);
    assert.equal(dashboard.deletedSerialCount, 1);
    assert.equal(dashboard.backupCount, 1);
  } finally {
    closeDatabase(db);
  }
});

test("inventory workbook view mirrors part-room, holder, office, and total columns", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "모뎀" });
    const personA = createPerson(db, { name: "정상호" });
    const personB = createPerson(db, { name: "정진원" });

    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 7,
      reason: "opening balance"
    });
    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: personA.id,
      quantity: 2
    });
    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: personB.id,
      quantity: 1
    });
    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "사무실 사용/보유",
      itemId: item.id,
      quantity: 1
    });

    const view = getInventoryWorkbookView(db);
    const [row] = view.rows;
    assert.deepEqual(view.columns, [
      "품목",
      "파트실",
      "정상호",
      "정진원",
      "사무실",
      "개인/사무실 합계",
      "합계"
    ]);
    assert.equal(row.partRoomQuantity, 3);
    assert.equal(row.personHoldings["정상호"], 2);
    assert.equal(row.personHoldings["정진원"], 1);
    assert.equal(row.officeQuantity, 1);
    assert.equal(row.holderTotal, 4);
    assert.equal(row.totalQuantity, 7);
  } finally {
    closeDatabase(db);
  }
});

test("transaction history view uses user-facing labels and marks deleted rows", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "리모컨" });
    const person = createPerson(db, { name: "정다훈" });
    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 3,
      reason: "opening balance"
    });

    const transaction = recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: person.id,
      quantity: 1,
      serialText: "SN-1"
    });
    deleteTransaction(db, transaction.id, { reason: "wrong row" });

    const [row] = getTransactionHistoryView(db);
    assert.equal(row.label, "출고");
    assert.equal(row.itemId, item.id);
    assert.equal(row.itemName, "리모컨");
    assert.equal(row.personId, person.id);
    assert.equal(row.personName, "정다훈");
    assert.equal(row.serialText, "SN-1");
    assert.equal(row.isDeleted, true);
  } finally {
    closeDatabase(db);
  }
});

test("backup list view is suitable for a backup screen", () => {
  const db = createAppDatabase();
  try {
    createBackupRecord(db, {
      filePath: "backups/a.sqlite",
      reason: "manual",
      status: "created",
      sizeBytes: 100
    });

    const [backup] = getBackupListView(db);
    assert.equal(backup.filePath, "backups/a.sqlite");
    assert.equal(backup.reason, "manual");
    assert.equal(backup.status, "created");
    assert.equal(backup.sizeBytes, 100);
  } finally {
    closeDatabase(db);
  }
});

test("audit log view summarizes create update and delete history", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "공유기" });
    const person = createPerson(db, { name: "정상호" });
    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 5,
      reason: "opening balance"
    });
    const transaction = recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: person.id,
      quantity: 1,
      note: "first"
    });
    deleteTransaction(db, transaction.id, { reason: "wrong row" });

    const view = getAuditLogView(db);
    assert.equal(view.length, 3);
    assert.equal(view[0].actionLabel, "삭제");
    assert.equal(view[0].entityLabel, "입출고");
    assert.equal(view[0].reason, "wrong row");
    assert.match(view[0].beforeSummary, /출고/);
    assert.match(view[0].beforeSummary, /품목#\d+ 공유기/);
    assert.match(view[0].beforeSummary, /개인#\d+ 정상호/);
    assert.match(view[1].afterSummary, /수량 1/);
    assert.equal(view[2].entityLabel, "재고 조정");
    assert.match(view[2].afterSummary, /품목#\d+ 공유기/);
  } finally {
    closeDatabase(db);
  }
});

test("audit log view labels transaction and serial restores", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "ONT" });
    const person = createPerson(db, { name: "정상호" });
    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 3,
      reason: "opening balance"
    });

    const transaction = recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: person.id,
      quantity: 1,
      note: "wrongly deleted"
    });
    deleteTransaction(db, transaction.id, { reason: "mistake" });
    restoreTransaction(db, transaction.id, { reason: "restore transaction" });

    const serial = createSerialNumber(db, {
      itemId: item.id,
      serialText: "SER-1",
      holderText: "정상호",
      note: "registered"
    });
    deactivateSerialNumber(db, serial.id, { reason: "wrong serial delete" });
    restoreSerialNumber(db, serial.id, { reason: "restore serial" });

    const view = getAuditLogView(db);
    const transactionRestore = view.find(
      (row) => row.action === "restore" && row.entityType === "transaction"
    );
    const serialRestore = view.find(
      (row) => row.action === "restore" && row.entityType === "serial_number"
    );

    assert.equal(transactionRestore.actionLabel, "복원");
    assert.equal(transactionRestore.entityLabel, "입출고");
    assert.equal(transactionRestore.reason, "restore transaction");
    assert.match(transactionRestore.afterSummary, /출고/);
    assert.match(transactionRestore.afterSummary, /품목#\d+ ONT/);
    assert.match(transactionRestore.afterSummary, /개인#\d+ 정상호/);
    assert.equal(serialRestore.actionLabel, "복원");
    assert.equal(serialRestore.entityLabel, "시리얼");
    assert.equal(serialRestore.reason, "restore serial");
    assert.match(serialRestore.afterSummary, /품목#\d+ ONT/);
    assert.match(serialRestore.afterSummary, /시리얼 SER-1/);
  } finally {
    closeDatabase(db);
  }
});

test("serial number view exposes registered serials with item names", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "LTE" });
    createSerialNumber(db, {
      itemId: item.id,
      serialText: "SN-100",
      holderText: "정상호",
      note: "테스트"
    });

    const [serial] = getSerialNumberView(db);
    assert.equal(serial.itemName, "LTE");
    assert.equal(serial.serialText, "SN-100");
    assert.equal(serial.holderText, "정상호");
    assert.equal(serial.isActive, true);
  } finally {
    closeDatabase(db);
  }
});
