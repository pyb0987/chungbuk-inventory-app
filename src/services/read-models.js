import { Buckets, TransactionLabels, TransactionTypes } from "../domain/stock-engine.js";
import {
  calculateCurrentStockMap,
  listAuditLog,
  listBackupRecords,
  listImportRuns,
  listItems,
  listLegacyUsageRecords,
  listPeople,
  listSerialNumbers,
  listTransactions
} from "../db/repositories.js";

export function getDashboardView(db) {
  const stock = calculateCurrentStockMap(db);
  const transactions = listTransactions(db);
  const activeTransactions = transactions.filter((transaction) => !transaction.isDeleted);
  const backups = listBackupRecords(db);
  const serials = listSerialNumbers(db);
  const activeSerials = serials.filter((serial) => serial.isActive);

  return {
    totalStock: sumInternalStock(stock),
    partRoomStock: sumBucket(stock, Buckets.PART_ROOM),
    personalVehicleStock: sumBucket(stock, Buckets.PERSON),
    officeStock: sumBucket(stock, Buckets.OFFICE),
    seoulReceivedCount: sumTransactionQuantity(activeTransactions, TransactionTypes.SEOUL_TO_PART_ROOM),
    seoulReturnedCount: sumTransactionQuantity(activeTransactions, TransactionTypes.RETURN_TO_SEOUL),
    activeTransactionCount: activeTransactions.length,
    deletedTransactionCount: transactions.length - activeTransactions.length,
    activeSerialCount: activeSerials.length,
    deletedSerialCount: serials.length - activeSerials.length,
    backupCount: backups.length,
    latestBackup: backups[0] ?? null
  };
}

export function getInventoryWorkbookView(db) {
  const items = listItems(db);
  const people = listPeople(db);
  const stock = calculateCurrentStockMap(db);

  return {
    columns: [
      "품목",
      "파트실",
      ...people.map((person) => person.name),
      "사무실",
      "개인/사무실 합계",
      "합계"
    ],
    people,
    rows: items.map((item) => {
      const personHoldings = Object.fromEntries(
        people.map((person) => [
          person.name,
          quantityFor(stock, item.id, Buckets.PERSON, person.id)
        ])
      );
      const personalTotal = Object.values(personHoldings).reduce(
        (sum, quantity) => sum + quantity,
        0
      );
      const officeQuantity = quantityFor(stock, item.id, Buckets.OFFICE);
      const holderTotal = personalTotal + officeQuantity;
      const partRoomQuantity = quantityFor(stock, item.id, Buckets.PART_ROOM);

      return {
        itemId: item.id,
        itemName: item.name,
        partRoomQuantity,
        personHoldings,
        officeQuantity,
        holderTotal,
        totalQuantity: partRoomQuantity + holderTotal
      };
    })
  };
}

export function getTransactionHistoryView(db) {
  const itemsById = new Map(listItems(db).map((item) => [item.id, item]));
  const peopleById = new Map(listPeople(db).map((person) => [person.id, person]));

  return listTransactions(db).map((transaction) => ({
    id: transaction.id,
    date: transaction.occurredOn,
    type: transaction.type,
    label: TransactionLabels[transaction.type] ?? transaction.sourceLabel ?? transaction.type,
    sourceLabel: transaction.sourceLabel,
    itemId: transaction.itemId,
    itemName: itemsById.get(transaction.itemId)?.name ?? "",
    personId: transaction.personId,
    personName: transaction.personId ? peopleById.get(transaction.personId)?.name ?? "" : "",
    quantity: transaction.quantity,
    serialText: transaction.serialText,
    note: transaction.note,
    isDeleted: Boolean(transaction.isDeleted)
  }));
}

export function getBackupListView(db) {
  return listBackupRecords(db).map((backup) => ({
    id: backup.id,
    filePath: backup.filePath,
    reason: backup.reason,
    status: backup.status,
    sizeBytes: backup.sizeBytes,
    createdAt: backup.createdAt
  }));
}

export function getImportRunListView(db) {
  return listImportRuns(db).map((run) => ({
    id: run.id,
    sourceFile: run.sourceFile,
    sourceKind: run.sourceKind,
    status: run.status,
    report: run.report,
    createdAt: run.createdAt
  }));
}

export function getLegacyUsageHistoryView(db) {
  return listLegacyUsageRecords(db).map((record) => ({
    id: record.id,
    sourceFile: record.sourceFile,
    sourceSheet: record.sourceSheet,
    rowNumber: record.rowNumber,
    occurredOn: record.occurredOn,
    legacyLabel: record.legacyLabel,
    appType: record.appType,
    appLabel: TransactionLabels[record.appType] ?? record.appType,
    personName: record.personName,
    itemName: record.itemName,
    serialText: record.serialText,
    quantity: record.quantity,
    note: record.note,
    createdAt: record.createdAt
  }));
}

export function getAuditLogView(db) {
  const itemsById = new Map(listItems(db).map((item) => [item.id, item]));
  const peopleById = new Map(listPeople(db).map((person) => [person.id, person]));

  return listAuditLog(db)
    .slice()
    .reverse()
    .map((row) => {
      const before = parseJson(row.beforeJson);
      const after = parseJson(row.afterJson);
      return {
        id: row.id,
        action: row.action,
        actionLabel: actionLabel(row.action),
        entityType: row.entityType,
        entityLabel: entityLabel(row.entityType),
        entityId: row.entityId,
        reason: row.reason,
        before,
        after,
        beforeSummary: summarizeAuditPayload(before, { itemsById, peopleById }),
        afterSummary: summarizeAuditPayload(after, { itemsById, peopleById }),
        createdAt: row.createdAt
      };
    });
}

export function getSerialNumberView(db) {
  return listSerialNumbers(db).map((serial) => ({
    id: serial.id,
    itemId: serial.itemId,
    itemName: serial.itemName,
    serialText: serial.serialText,
    holderText: serial.holderText,
    note: serial.note,
    isActive: serial.isActive,
    createdAt: serial.createdAt,
    updatedAt: serial.updatedAt
  }));
}

function sumInternalStock(stock) {
  let total = 0;
  for (const [key, quantity] of stock.entries()) {
    const [, bucket] = key.split("::");
    if (bucket !== Buckets.SEOUL) {
      total += quantity;
    }
  }
  return total;
}

function sumBucket(stock, bucket) {
  let total = 0;
  for (const [key, quantity] of stock.entries()) {
    const [, entryBucket] = key.split("::");
    if (entryBucket === bucket) {
      total += quantity;
    }
  }
  return total;
}

function quantityFor(stock, itemId, bucket, holderId = null) {
  return stock.get(`${itemId}::${bucket}::${holderId ?? ""}`) ?? 0;
}

function sumTransactionQuantity(transactions, type) {
  return transactions
    .filter((transaction) => transaction.type === type)
    .reduce((sum, transaction) => sum + transaction.quantity, 0);
}

function parseJson(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function actionLabel(action) {
  return {
    create: "생성",
    update: "수정",
    delete: "삭제",
    restore: "복원"
  }[action] ?? action;
}

function entityLabel(entityType) {
  return {
    transaction: "입출고",
    stock_adjustment: "재고 조정",
    item: "품목",
    person: "개인",
    serial_number: "시리얼"
  }[entityType] ?? entityType;
}

function summarizeAuditPayload(payload, context = {}) {
  if (!payload) {
    return "";
  }
  const { itemsById = new Map(), peopleById = new Map() } = context;
  const parts = [];
  if (payload.type) {
    parts.push(TransactionLabels[payload.type] ?? payload.type);
  }
  if (payload.occurredOn) {
    parts.push(payload.occurredOn);
  }
  if (payload.itemId) {
    parts.push(formatNamedReference("품목", payload.itemId, payload.itemName ?? itemsById.get(payload.itemId)?.name));
  }
  if (payload.name) {
    parts.push(payload.name);
  }
  if (payload.personId) {
    parts.push(formatNamedReference("개인", payload.personId, peopleById.get(payload.personId)?.name));
  }
  if (payload.holderId) {
    parts.push(formatNamedReference("개인", payload.holderId, peopleById.get(payload.holderId)?.name));
  }
  if (payload.isActive !== undefined) {
    parts.push(payload.isActive ? "사용" : "비활성");
  }
  if (payload.bucket) {
    parts.push(payload.bucket);
  }
  if (payload.serialText) {
    parts.push(`시리얼 ${payload.serialText}`);
  }
  if (payload.holderText) {
    parts.push(payload.holderText);
  }
  const quantity = payload.quantity ?? payload.quantityDelta;
  if (quantity !== undefined) {
    parts.push(`수량 ${quantity}`);
  }
  if (payload.note) {
    parts.push(payload.note);
  }
  return parts.join(" / ");
}

function formatNamedReference(label, id, name) {
  return name ? `${label}#${id} ${name}` : `${label}#${id}`;
}
