import test from "node:test";
import assert from "node:assert/strict";
import { Buckets, stockKey } from "../src/domain/stock-engine.js";
import { closeDatabase, createAppDatabase } from "../src/db/database.js";
import {
  calculateCurrentStockMap,
  createBackupRecord,
  createItem,
  createPerson,
  createSerialNumber,
  createStockAdjustment,
  deactivateSerialNumber,
  deleteTransaction,
  listAuditLog,
  listInventory,
  listItems,
  listPeople,
  listSerialNumbers,
  listTransactions,
  recordTransaction,
  restoreSerialNumber,
  restoreTransaction,
  setItemActive,
  setPersonActive,
  updateSerialNumber,
  updateTransaction
} from "../src/db/repositories.js";

test("database initializes core tables", () => {
  const db = createAppDatabase();
  try {
    assert.deepEqual(listItems(db), []);
    assert.deepEqual(listPeople(db), []);
    assert.deepEqual(listTransactions(db), []);
  } finally {
    closeDatabase(db);
  }
});

test("items and people can be created and listed", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "모뎀" });
    const person = createPerson(db, { name: "정상호" });

    assert.equal(item.name, "모뎀");
    assert.equal(person.name, "정상호");
    assert.equal(listItems(db).length, 1);
    assert.equal(listPeople(db).length, 1);
  } finally {
    closeDatabase(db);
  }
});

test("items and people can be deactivated and reactivated without deleting history", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "임시 품목" });
    const person = createPerson(db, { name: "임시 개인" });

    const inactiveItem = setItemActive(db, item.id, false, { reason: "not used" });
    const inactivePerson = setPersonActive(db, person.id, false, { reason: "not used" });

    assert.equal(inactiveItem.isActive, 0);
    assert.equal(inactivePerson.isActive, 0);
    assert.equal(listItems(db).find((entry) => entry.id === item.id).name, "임시 품목");
    assert.equal(listPeople(db).find((entry) => entry.id === person.id).name, "임시 개인");

    const reactivatedItem = createItem(db, { name: "임시 품목" });
    const reactivatedPerson = createPerson(db, { name: "임시 개인" });

    assert.equal(reactivatedItem.id, item.id);
    assert.equal(reactivatedItem.isActive, 1);
    assert.equal(reactivatedPerson.id, person.id);
    assert.equal(reactivatedPerson.isActive, 1);
    assert.deepEqual(
      listAuditLog(db).map((row) => row.entityType),
      ["item", "person", "item", "person"]
    );
  } finally {
    closeDatabase(db);
  }
});

test("serial numbers can be registered with duplicates and soft-deleted", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "LTE" });
    const first = createSerialNumber(db, {
      itemId: item.id,
      serialText: "SN-001",
      holderText: "파트실",
      note: "first"
    });
    const second = createSerialNumber(db, {
      itemId: item.id,
      serialText: "SN-001",
      holderText: "사무실",
      note: "duplicate allowed"
    });

    deactivateSerialNumber(db, first.id, { reason: "wrong holder" });

    const serials = listSerialNumbers(db);
    assert.equal(second.serialText, "SN-001");
    assert.equal(serials.length, 2);
    assert.equal(serials.find((serial) => serial.id === first.id).isActive, false);
    assert.equal(serials.find((serial) => serial.id === second.id).isActive, true);
    assert.equal(listAuditLog(db).filter((row) => row.entityType === "serial_number").length, 3);

    const restored = restoreSerialNumber(db, first.id, { reason: "wrong holder was correct" });
    assert.equal(restored.isActive, true);
    assert.equal(listSerialNumbers(db).find((serial) => serial.id === first.id).isActive, true);
    assert.equal(listAuditLog(db).filter((row) => row.entityType === "serial_number").length, 4);

    const updated = updateSerialNumber(db, first.id, {
      itemId: item.id,
      serialText: "SN-002",
      holderText: "차량",
      note: "corrected",
      reason: "serial typo"
    });
    assert.equal(updated.serialText, "SN-002");
    assert.equal(updated.holderText, "차량");
    assert.equal(updated.note, "corrected");
    const audit = listAuditLog(db).filter((row) => row.entityType === "serial_number");
    assert.equal(audit.length, 5);
    assert.equal(audit.at(-1).action, "update");
    assert.equal(audit.at(-1).reason, "serial typo");
  } finally {
    closeDatabase(db);
  }
});

test("opening stock plus personal outbound updates current stock", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "공유기" });
    const person = createPerson(db, { name: "김현수" });

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
      quantity: 2,
      note: "테스트 출고"
    });

    const stock = calculateCurrentStockMap(db);
    assert.equal(transaction.type, "personal_out");
    assert.equal(stock.get(stockKey(item.id, Buckets.PART_ROOM)), 3);
    assert.equal(stock.get(stockKey(item.id, Buckets.PERSON, person.id)), 2);
    assert.equal(listInventory(db)[0].totalQuantity, 5);
  } finally {
    closeDatabase(db);
  }
});

test("negative stock transactions are rejected and not persisted", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "셋톱박스" });
    const person = createPerson(db, { name: "정다훈" });

    assert.throws(
      () =>
        recordTransaction(db, {
          occurredOn: "2026-07-14",
          type: "출고",
          itemId: item.id,
          personId: person.id,
          quantity: 1
        }),
      /negative stock is not allowed/
    );

    assert.equal(listTransactions(db).length, 0);
    assert.equal(listAuditLog(db).length, 0);
  } finally {
    closeDatabase(db);
  }
});

test("Seoul aliases are persisted as normalized transaction types", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "리모컨" });

    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "서울 입고",
      itemId: item.id,
      quantity: 4,
      sourceLabel: "서울 입고"
    });

    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "서울로 반납",
      itemId: item.id,
      quantity: 1
    });

    const transactions = listTransactions(db);
    const stock = calculateCurrentStockMap(db);

    assert.deepEqual(
      transactions.map((entry) => entry.type).sort(),
      ["return_to_seoul", "seoul_to_part_room"]
    );
    assert.equal(stock.get(stockKey(item.id, Buckets.PART_ROOM)), 3);
  } finally {
    closeDatabase(db);
  }
});

test("audit entries and backup metadata are recorded", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "케이블" });
    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 10,
      reason: "opening balance"
    });

    const backupId = createBackupRecord(db, {
      filePath: "backups/test.sqlite",
      reason: "manual backup",
      status: "created",
      sizeBytes: 1234
    });

    const audit = listAuditLog(db);
    assert.equal(backupId, 1);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].entityType, "stock_adjustment");
  } finally {
    closeDatabase(db);
  }
});

test("stock adjustments reject unknown buckets and invalid holders", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "검증 품목" });

    assert.throws(
      () =>
        createStockAdjustment(db, {
          occurredOn: "2026-07-14",
          itemId: item.id,
          bucket: "partroom_typo",
          quantityDelta: 1,
          reason: "bad bucket"
        }),
      /invalid stock adjustment bucket/
    );

    assert.throws(
      () =>
        createStockAdjustment(db, {
          occurredOn: "2026-07-14",
          itemId: item.id,
          bucket: Buckets.PERSON,
          quantityDelta: 1,
          reason: "missing holder"
        }),
      /holderId is required/
    );

    assert.throws(
      () =>
        createStockAdjustment(db, {
          occurredOn: "2026-07-14",
          itemId: item.id,
          bucket: Buckets.PART_ROOM,
          holderId: 123,
          quantityDelta: 1,
          reason: "bad holder"
        }),
      /holderId is not allowed/
    );
  } finally {
    closeDatabase(db);
  }
});

test("transactions can be updated when resulting stock remains valid", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "증폭기" });
    const person = createPerson(db, { name: "전성진" });

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
      quantity: 2
    });

    const updated = updateTransaction(db, transaction.id, {
      quantity: 3,
      reason: "correct count"
    });

    const stock = calculateCurrentStockMap(db);
    assert.equal(updated.quantity, 3);
    assert.equal(stock.get(stockKey(item.id, Buckets.PART_ROOM)), 2);
    assert.equal(stock.get(stockKey(item.id, Buckets.PERSON, person.id)), 3);
    assert.equal(listAuditLog(db).filter((row) => row.entityType === "transaction").length, 2);
  } finally {
    closeDatabase(db);
  }
});

test("transaction updates are rejected when they would create negative stock", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "분배기" });
    const person = createPerson(db, { name: "정진원" });

    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 2,
      reason: "opening balance"
    });

    const transaction = recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: person.id,
      quantity: 1
    });

    assert.throws(
      () => updateTransaction(db, transaction.id, { quantity: 3 }),
      /negative stock is not allowed/
    );

    const stock = calculateCurrentStockMap(db);
    assert.equal(stock.get(stockKey(item.id, Buckets.PART_ROOM)), 1);
    assert.equal(stock.get(stockKey(item.id, Buckets.PERSON, person.id)), 1);
  } finally {
    closeDatabase(db);
  }
});

test("deleting a transaction is soft-delete and recalculates current stock", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "어댑터" });
    const person = createPerson(db, { name: "정상호" });

    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 4,
      reason: "opening balance"
    });

    const transaction = recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: person.id,
      quantity: 2
    });

    const deleted = deleteTransaction(db, transaction.id, { reason: "wrong entry" });
    const stock = calculateCurrentStockMap(db);
    const listed = listTransactions(db);

    assert.equal(deleted.isDeleted, 1);
    assert.equal(listed[0].isDeleted, 1);
    assert.equal(stock.get(stockKey(item.id, Buckets.PART_ROOM)), 4);
    assert.equal(stock.get(stockKey(item.id, Buckets.PERSON, person.id)) ?? 0, 0);
  } finally {
    closeDatabase(db);
  }
});

test("restoring a transaction recalculates stock and rejects invalid restoration", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "어댑터" });
    const person = createPerson(db, { name: "정상호" });

    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 4,
      reason: "opening balance"
    });

    const transaction = recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: person.id,
      quantity: 2
    });

    deleteTransaction(db, transaction.id, { reason: "wrong entry" });
    const restored = restoreTransaction(db, transaction.id, { reason: "not wrong" });
    let stock = calculateCurrentStockMap(db);
    assert.equal(restored.isDeleted, 0);
    assert.equal(stock.get(stockKey(item.id, Buckets.PART_ROOM)), 2);
    assert.equal(stock.get(stockKey(item.id, Buckets.PERSON, person.id)), 2);

    deleteTransaction(db, transaction.id, { reason: "wrong again" });
    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: -4,
      reason: "removed remaining part-room stock"
    });
    assert.throws(
      () => restoreTransaction(db, transaction.id, { reason: "would go negative" }),
      /negative stock is not allowed/
    );
    stock = calculateCurrentStockMap(db);
    assert.equal(stock.get(stockKey(item.id, Buckets.PART_ROOM)), 0);
  } finally {
    closeDatabase(db);
  }
});

test("inventory lists part-room, personal, office, and total quantities", () => {
  const db = createAppDatabase();
  try {
    const item = createItem(db, { name: "ONU" });
    const person = createPerson(db, { name: "최용빈" });

    createStockAdjustment(db, {
      occurredOn: "2026-07-14",
      itemId: item.id,
      bucket: Buckets.PART_ROOM,
      quantityDelta: 8,
      reason: "opening balance"
    });
    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId: item.id,
      personId: person.id,
      quantity: 2
    });
    recordTransaction(db, {
      occurredOn: "2026-07-14",
      type: "사무실 사용/보유",
      itemId: item.id,
      quantity: 1
    });

    const [inventory] = listInventory(db);
    assert.equal(inventory.partRoomQuantity, 5);
    assert.equal(inventory.personalQuantity, 2);
    assert.equal(inventory.officeQuantity, 1);
    assert.equal(inventory.totalQuantity, 8);
  } finally {
    closeDatabase(db);
  }
});
