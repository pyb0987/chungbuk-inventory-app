import test from "node:test";
import assert from "node:assert/strict";
import {
  Buckets,
  TransactionTypes,
  applyTransaction,
  normalizeTransactionType,
  stockKey,
  totalForItem
} from "../src/domain/stock-engine.js";

test("개인 출고 moves stock from part room to selected person", () => {
  const stock = new Map([[stockKey(1, Buckets.PART_ROOM), 3]]);

  const next = applyTransaction(stock, {
    type: TransactionTypes.PERSONAL_OUT,
    itemId: 1,
    personId: 10,
    quantity: 2
  });

  assert.equal(next.get(stockKey(1, Buckets.PART_ROOM)), 1);
  assert.equal(next.get(stockKey(1, Buckets.PERSON, 10)), 2);
  assert.equal(totalForItem(next, 1), 3);
});

test("개인 반납 moves stock from selected person back to part room", () => {
  const stock = new Map([
    [stockKey(1, Buckets.PART_ROOM), 1],
    [stockKey(1, Buckets.PERSON, 10), 2]
  ]);

  const next = applyTransaction(stock, {
    type: "입고",
    itemId: 1,
    personId: 10,
    quantity: 1
  });

  assert.equal(next.get(stockKey(1, Buckets.PART_ROOM)), 2);
  assert.equal(next.get(stockKey(1, Buckets.PERSON, 10)), 1);
});

test("서울로 반납 decreases part-room stock", () => {
  const stock = new Map([[stockKey(1, Buckets.PART_ROOM), 5]]);

  const next = applyTransaction(stock, {
    type: "서울로 반납",
    itemId: 1,
    quantity: 3
  });

  assert.equal(next.get(stockKey(1, Buckets.PART_ROOM)), 2);
  assert.equal(totalForItem(next, 1), 2);
});

test("서울에서 파트실로 택배 and 서울 입고 increase part-room stock", () => {
  const stock = new Map([[stockKey(1, Buckets.PART_ROOM), 1]]);

  const next = applyTransaction(stock, {
    type: "서울 입고",
    itemId: 1,
    quantity: 4
  });

  assert.equal(next.get(stockKey(1, Buckets.PART_ROOM)), 5);
  assert.equal(totalForItem(next, 1), 5);
});

test("사무실 반출 moves office stock back to the part room", () => {
  const stock = new Map([
    [stockKey(1, Buckets.PART_ROOM), 1],
    [stockKey(1, Buckets.OFFICE), 3]
  ]);

  const next = applyTransaction(stock, {
    type: TransactionTypes.OFFICE_IN,
    itemId: 1,
    quantity: 2
  });

  assert.equal(next.get(stockKey(1, Buckets.PART_ROOM)), 3);
  assert.equal(next.get(stockKey(1, Buckets.OFFICE)), 1);
});

test("개인 설치 removes stock only from the selected person's holdings", () => {
  const stock = new Map([
    [stockKey(1, Buckets.PART_ROOM), 5],
    [stockKey(1, Buckets.PERSON, 10), 3]
  ]);

  const next = applyTransaction(stock, {
    type: TransactionTypes.PERSONAL_INSTALL,
    itemId: 1,
    personId: 10,
    quantity: 1
  });

  assert.equal(next.get(stockKey(1, Buckets.PART_ROOM)), 5);
  assert.equal(next.get(stockKey(1, Buckets.PERSON, 10)), 2);
  assert.equal(totalForItem(next, 1), 7);
});

test("개인 회수 adds stock only to the selected person's holdings", () => {
  const stock = new Map([
    [stockKey(1, Buckets.PART_ROOM), 5],
    [stockKey(1, Buckets.PERSON, 10), 2]
  ]);

  const next = applyTransaction(stock, {
    type: TransactionTypes.PERSONAL_RECOVER,
    itemId: 1,
    personId: 10,
    quantity: 1
  });

  assert.equal(next.get(stockKey(1, Buckets.PART_ROOM)), 5);
  assert.equal(next.get(stockKey(1, Buckets.PERSON, 10)), 3);
  assert.equal(totalForItem(next, 1), 8);
});

test("negative internal stock is blocked", () => {
  const stock = new Map([[stockKey(1, Buckets.PART_ROOM), 1]]);

  assert.throws(
    () =>
      applyTransaction(stock, {
        type: TransactionTypes.PERSONAL_OUT,
        itemId: 1,
        personId: 10,
        quantity: 2
      }),
    /negative stock is not allowed/
  );
});

test("legacy labels normalize to confirmed transaction types", () => {
  assert.equal(normalizeTransactionType("개인 반납"), TransactionTypes.PERSONAL_IN);
  assert.equal(normalizeTransactionType("개인 입고"), TransactionTypes.PERSONAL_IN);
  assert.equal(normalizeTransactionType("반납"), TransactionTypes.RETURN_TO_SEOUL);
  assert.equal(
    normalizeTransactionType("서울_파트실_택배"),
    TransactionTypes.SEOUL_TO_PART_ROOM
  );
  assert.equal(normalizeTransactionType("서울 입고"), TransactionTypes.SEOUL_TO_PART_ROOM);
  assert.equal(normalizeTransactionType("개인 설치"), TransactionTypes.PERSONAL_INSTALL);
  assert.equal(normalizeTransactionType("개인 회수"), TransactionTypes.PERSONAL_RECOVER);
  assert.equal(normalizeTransactionType("사무실 반출"), TransactionTypes.OFFICE_IN);
  assert.equal(normalizeTransactionType("사무실 입고"), TransactionTypes.OFFICE_IN);
});
