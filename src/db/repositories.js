import {
  applyTransaction,
  assertValidStock,
  Buckets,
  buildDeltas,
  normalizeTransactionType,
  stockKey,
  totalForItem
} from "../domain/stock-engine.js";
import { withTransaction } from "./database.js";

export function createItem(db, { name }) {
  const cleanName = requireText(name, "item name");
  const existing = findItemByName(db, cleanName);
  if (existing) {
    if (!existing.isActive) {
      return setItemActive(db, existing.id, true, { reason: "reactivated by create" });
    }
    throw new Error(`item already exists: ${cleanName}`);
  }
  const result = db
    .prepare("INSERT INTO items (name) VALUES (?)")
    .run(cleanName);
  return getItem(db, Number(result.lastInsertRowid));
}

export function listItems(db) {
  return db
    .prepare("SELECT id, name, is_active AS isActive FROM items ORDER BY name")
    .all();
}

export function getItem(db, id) {
  const item = db
    .prepare("SELECT id, name, is_active AS isActive FROM items WHERE id = ?")
    .get(id);
  if (!item) {
    throw new Error(`item not found: ${id}`);
  }
  return item;
}

export function setItemActive(db, id, isActive, { reason = null } = {}) {
  return withTransaction(db, () => {
    const before = getItem(db, id);
    const nextActive = isActive ? 1 : 0;
    if (before.isActive === nextActive) {
      return before;
    }

    db.prepare(
      `UPDATE items
       SET is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(nextActive, id);

    const after = getItem(db, id);
    writeAudit(db, {
      action: isActive ? "restore" : "delete",
      entityType: "item",
      entityId: id,
      before,
      after,
      reason
    });
    return after;
  });
}

export function permanentlyDeleteItem(db, id, { reason = null } = {}) {
  return withTransaction(db, () => {
    const before = getItem(db, id);
    for (const [table, column] of [
      ["transactions", "item_id"],
      ["stock_adjustments", "item_id"],
      ["serial_numbers", "item_id"]
    ]) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(id);
      if (row.count > 0) {
        throw new Error("기록이나 재고가 연결된 품목은 영구 삭제할 수 없습니다. 대신 비활성화해 주세요.");
      }
    }
    db.prepare("DELETE FROM items WHERE id = ?").run(id);
    writeAudit(db, {
      action: "permanent_delete",
      entityType: "item",
      entityId: id,
      before,
      reason
    });
    return before;
  });
}

export function createPerson(db, { name }) {
  const cleanName = requireText(name, "person name");
  const existing = findPersonByName(db, cleanName);
  if (existing) {
    if (!existing.isActive) {
      return setPersonActive(db, existing.id, true, { reason: "reactivated by create" });
    }
    throw new Error(`person already exists: ${cleanName}`);
  }
  const result = db
    .prepare("INSERT INTO people (name) VALUES (?)")
    .run(cleanName);
  return getPerson(db, Number(result.lastInsertRowid));
}

export function listPeople(db) {
  return db
    .prepare("SELECT id, name, is_active AS isActive FROM people ORDER BY name")
    .all();
}

export function getPerson(db, id) {
  const person = db
    .prepare("SELECT id, name, is_active AS isActive FROM people WHERE id = ?")
    .get(id);
  if (!person) {
    throw new Error(`person not found: ${id}`);
  }
  return person;
}

export function setPersonActive(db, id, isActive, { reason = null } = {}) {
  return withTransaction(db, () => {
    const before = getPerson(db, id);
    const nextActive = isActive ? 1 : 0;
    if (before.isActive === nextActive) {
      return before;
    }

    db.prepare(
      `UPDATE people
       SET is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(nextActive, id);

    const after = getPerson(db, id);
    writeAudit(db, {
      action: isActive ? "restore" : "delete",
      entityType: "person",
      entityId: id,
      before,
      after,
      reason
    });
    return after;
  });
}

export function createSerialNumber(db, input) {
  return withTransaction(db, () => {
    assertItemExists(db, input.itemId);
    const result = db
      .prepare(
        `INSERT INTO serial_numbers
          (item_id, serial_text, holder_text, note)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        input.itemId,
        requireText(input.serialText, "serial number"),
        emptyToNull(input.holderText),
        emptyToNull(input.note)
      );

    const id = Number(result.lastInsertRowid);
    const after = getSerialNumber(db, id);
    writeAudit(db, {
      action: "create",
      entityType: "serial_number",
      entityId: id,
      after
    });
    return after;
  });
}

export function updateSerialNumber(db, id, input) {
  return withTransaction(db, () => {
    const before = getSerialNumber(db, id);
    if (!before.isActive) {
      throw new Error(`cannot update deleted serial number: ${id}`);
    }
    const itemId = input.itemId === undefined ? before.itemId : input.itemId;
    assertItemExists(db, itemId);

    db.prepare(
      `UPDATE serial_numbers
       SET item_id = ?,
           serial_text = ?,
           holder_text = ?,
           note = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      itemId,
      requireText(input.serialText ?? before.serialText, "serial number"),
      input.holderText === undefined ? before.holderText : emptyToNull(input.holderText),
      input.note === undefined ? before.note : emptyToNull(input.note),
      id
    );

    const after = getSerialNumber(db, id);
    writeAudit(db, {
      action: "update",
      entityType: "serial_number",
      entityId: id,
      before,
      after,
      reason: input.reason ?? null
    });
    return after;
  });
}

export function deactivateSerialNumber(db, id, { reason = null } = {}) {
  return withTransaction(db, () => {
    const before = getSerialNumber(db, id);
    if (!before.isActive) {
      return before;
    }

    db.prepare(
      `UPDATE serial_numbers
       SET is_active = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(id);

    const after = getSerialNumber(db, id);
    writeAudit(db, {
      action: "delete",
      entityType: "serial_number",
      entityId: id,
      before,
      after,
      reason
    });
    return after;
  });
}

export function restoreSerialNumber(db, id, { reason = null } = {}) {
  return withTransaction(db, () => {
    const before = getSerialNumber(db, id);
    if (before.isActive) {
      return before;
    }

    db.prepare(
      `UPDATE serial_numbers
       SET is_active = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(id);

    const after = getSerialNumber(db, id);
    writeAudit(db, {
      action: "restore",
      entityType: "serial_number",
      entityId: id,
      before,
      after,
      reason
    });
    return after;
  });
}

export function listSerialNumbers(db) {
  return db
    .prepare(
      `SELECT
        serial_numbers.id,
        serial_numbers.item_id AS itemId,
        items.name AS itemName,
        serial_numbers.serial_text AS serialText,
        serial_numbers.holder_text AS holderText,
        serial_numbers.note,
        serial_numbers.is_active AS isActive,
        serial_numbers.created_at AS createdAt,
        serial_numbers.updated_at AS updatedAt
       FROM serial_numbers
       JOIN items ON items.id = serial_numbers.item_id
       ORDER BY serial_numbers.id DESC`
    )
    .all()
    .map((row) => ({
      ...row,
      isActive: Boolean(row.isActive)
    }));
}

export function createStockAdjustment(db, input) {
  return withTransaction(db, () => {
    assertItemExists(db, input.itemId);
    assertValidAdjustmentInput(db, input);
    const adjustment = {
      type: "adjustment",
      itemId: input.itemId,
      bucket: input.bucket,
      holderId: input.holderId ?? null,
      quantity: input.quantityDelta
    };

    applyTransaction(calculateCurrentStockMap(db), adjustment);

    const result = db
      .prepare(
        `INSERT INTO stock_adjustments
          (occurred_on, item_id, bucket, holder_id, quantity_delta, reason)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        requireText(input.occurredOn, "occurred date"),
        input.itemId,
        input.bucket,
        input.holderId ?? null,
        input.quantityDelta,
        requireText(input.reason, "adjustment reason")
      );

    const id = Number(result.lastInsertRowid);
    writeAudit(db, {
      action: "create",
      entityType: "stock_adjustment",
      entityId: id,
      after: { ...input, id }
    });
    return getStockAdjustment(db, id);
  });
}

export function recordTransaction(db, input) {
  return withTransaction(db, () => {
    assertItemExists(db, input.itemId);
    const normalizedType = normalizeTransactionType(input.type);
    if (requiresPerson(normalizedType)) {
      assertPersonExists(db, input.personId);
    }

    const transaction = {
      type: normalizedType,
      itemId: input.itemId,
      personId: input.personId ?? null,
      quantity: input.quantity
    };
    assertTransactionLeavesValidStock(db, transaction);

    const result = db
      .prepare(
        `INSERT INTO transactions
          (occurred_on, type, item_id, person_id, quantity, serial_text, note, source_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        requireText(input.occurredOn, "occurred date"),
        normalizedType,
        input.itemId,
        input.personId ?? null,
        input.quantity,
        input.serialText ?? null,
        input.note ?? null,
        input.sourceLabel ?? input.type
      );

    const id = Number(result.lastInsertRowid);
    writeAudit(db, {
      action: "create",
      entityType: "transaction",
      entityId: id,
      after: { ...input, id, type: normalizedType }
    });
    return getTransaction(db, id);
  });
}

export function updateTransaction(db, id, input) {
  return withTransaction(db, () => {
    const before = getTransaction(db, id);
    if (before.isDeleted) {
      throw new Error(`cannot update deleted transaction: ${id}`);
    }

    const next = buildUpdatedTransaction(before, input);
    assertItemExists(db, next.itemId);
    if (requiresPerson(next.type)) {
      assertPersonExists(db, next.personId);
    }
    assertTransactionsLeaveValidStock(db, replacementTransactionRows(db, id, next));

    db.prepare(
      `UPDATE transactions
       SET occurred_on = ?,
           type = ?,
           item_id = ?,
           person_id = ?,
           quantity = ?,
           serial_text = ?,
           note = ?,
           source_label = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      next.occurredOn,
      next.type,
      next.itemId,
      next.personId ?? null,
      next.quantity,
      next.serialText ?? null,
      next.note ?? null,
      next.sourceLabel ?? before.sourceLabel,
      id
    );

    const after = getTransaction(db, id);
    writeAudit(db, {
      action: "update",
      entityType: "transaction",
      entityId: id,
      before,
      after,
      reason: input.reason ?? null
    });
    return after;
  });
}

export function deleteTransaction(db, id, { reason = null } = {}) {
  return withTransaction(db, () => {
    const before = getTransaction(db, id);
    if (before.isDeleted) {
      return before;
    }

    assertTransactionsLeaveValidStock(db, replacementTransactionRows(db, id, null));

    db.prepare(
      `UPDATE transactions
       SET is_deleted = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(id);

    const after = getTransaction(db, id);
    writeAudit(db, {
      action: "delete",
      entityType: "transaction",
      entityId: id,
      before,
      after,
      reason
    });
    return after;
  });
}

export function restoreTransaction(db, id, { reason = null } = {}) {
  return withTransaction(db, () => {
    const before = getTransaction(db, id);
    if (!before.isDeleted) {
      return before;
    }

    assertTransactionsLeaveValidStock(db, replacementTransactionRows(db, id, before));

    db.prepare(
      `UPDATE transactions
       SET is_deleted = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(id);

    const after = getTransaction(db, id);
    writeAudit(db, {
      action: "restore",
      entityType: "transaction",
      entityId: id,
      before,
      after,
      reason
    });
    return after;
  });
}

export function listTransactions(db) {
  return db
    .prepare(
      `SELECT
        id,
        occurred_on AS occurredOn,
        type,
        item_id AS itemId,
        person_id AS personId,
        quantity,
        serial_text AS serialText,
        note,
        source_label AS sourceLabel,
        is_deleted AS isDeleted
       FROM transactions
       ORDER BY occurred_on DESC, id DESC`
    )
    .all();
}

export function getTransaction(db, id) {
  const row = db
    .prepare(
      `SELECT
        id,
        occurred_on AS occurredOn,
        type,
        item_id AS itemId,
        person_id AS personId,
        quantity,
        serial_text AS serialText,
        note,
        source_label AS sourceLabel,
        is_deleted AS isDeleted
       FROM transactions
       WHERE id = ?`
    )
    .get(id);
  if (!row) {
    throw new Error(`transaction not found: ${id}`);
  }
  return row;
}

export function calculateCurrentStockMap(db) {
  const stock = new Map();

  for (const row of listStockAdjustmentRows(db)) {
    const key = stockKey(row.itemId, row.bucket, row.holderId);
    stock.set(key, (stock.get(key) ?? 0) + row.quantityDelta);
  }

  for (const row of listActiveTransactionRows(db)) {
    for (const entry of buildDeltas(row)) {
      const key = stockKey(row.itemId, entry.bucket, entry.holderId);
      stock.set(key, (stock.get(key) ?? 0) + entry.quantity);
    }
  }

  return stock;
}

export function listInventory(db) {
  const items = listItems(db);
  const stock = calculateCurrentStockMap(db);
  return items.map((item) => ({
    ...item,
    partRoomQuantity: quantityFor(stock, item.id, "part_room"),
    officeQuantity: quantityFor(stock, item.id, "office"),
    personalQuantity: quantityForBucket(stock, item.id, "person"),
    totalQuantity: totalForItem(stock, item.id)
  }));
}

export function listAuditLog(db) {
  return db
    .prepare(
      `SELECT
        id,
        action,
        entity_type AS entityType,
        entity_id AS entityId,
        before_json AS beforeJson,
        after_json AS afterJson,
        reason,
        created_at AS createdAt
       FROM audit_log
       ORDER BY id`
    )
    .all();
}

export function createBackupRecord(db, input) {
  const result = db
    .prepare(
      `INSERT INTO backups (file_path, reason, status, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      requireText(input.filePath, "backup file path"),
      requireText(input.reason, "backup reason"),
      input.status ?? "created",
      input.sizeBytes ?? null,
      normalizeTimestamp(input.createdAt ?? new Date())
    );
  return Number(result.lastInsertRowid);
}

export function createImportRunRecord(db, input) {
  const result = db
    .prepare(
      `INSERT INTO import_runs (source_file, source_kind, status, report_json)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      requireText(input.sourceFile, "import source file"),
      requireText(input.sourceKind, "import source kind"),
      requireText(input.status, "import status"),
      input.report ? JSON.stringify(input.report) : null
    );
  return Number(result.lastInsertRowid);
}

export function createLegacyUsageRecord(db, input) {
  const result = db
    .prepare(
      `INSERT INTO legacy_usage_records (
        source_file,
        source_sheet,
        row_number,
        occurred_on,
        legacy_label,
        app_type,
        person_name,
        item_name,
        serial_text,
        quantity,
        note
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      requireText(input.sourceFile, "legacy usage source file"),
      requireText(input.sourceSheet, "legacy usage source sheet"),
      Number(input.rowNumber),
      input.occurredOn ?? null,
      requireText(input.legacyLabel, "legacy usage label"),
      requireText(input.appType, "legacy usage app type"),
      emptyToNull(input.personName),
      requireText(input.itemName, "legacy usage item name"),
      emptyToNull(input.serialText),
      requirePositiveInteger(input.quantity, "legacy usage quantity"),
      emptyToNull(input.note)
    );
  return getLegacyUsageRecord(db, Number(result.lastInsertRowid));
}

export function listLegacyUsageRecords(db) {
  return db
    .prepare(
      `SELECT
        id,
        source_file AS sourceFile,
        source_sheet AS sourceSheet,
        row_number AS rowNumber,
        occurred_on AS occurredOn,
        legacy_label AS legacyLabel,
        app_type AS appType,
        person_name AS personName,
        item_name AS itemName,
        serial_text AS serialText,
        quantity,
        note,
        created_at AS createdAt
       FROM legacy_usage_records
       ORDER BY id DESC`
    )
    .all();
}

export function listImportRuns(db) {
  return db
    .prepare(
      `SELECT
        id,
        source_file AS sourceFile,
        source_kind AS sourceKind,
        status,
        report_json AS reportJson,
        created_at AS createdAt
       FROM import_runs
       ORDER BY id DESC`
    )
    .all()
    .map((row) => ({
      ...row,
      report: row.reportJson ? JSON.parse(row.reportJson) : null
    }));
}

function getLegacyUsageRecord(db, id) {
  const record = db
    .prepare(
      `SELECT
        id,
        source_file AS sourceFile,
        source_sheet AS sourceSheet,
        row_number AS rowNumber,
        occurred_on AS occurredOn,
        legacy_label AS legacyLabel,
        app_type AS appType,
        person_name AS personName,
        item_name AS itemName,
        serial_text AS serialText,
        quantity,
        note,
        created_at AS createdAt
       FROM legacy_usage_records
       WHERE id = ?`
    )
    .get(id);
  if (!record) {
    throw new Error(`legacy usage record not found: ${id}`);
  }
  return record;
}

export function listBackupRecords(db) {
  return db
    .prepare(
      `SELECT
        id,
        file_path AS filePath,
        reason,
        status,
        size_bytes AS sizeBytes,
        created_at AS createdAt
       FROM backups
       ORDER BY id DESC`
    )
    .all();
}

export function getBackupRecord(db, id) {
  return db
    .prepare(
      `SELECT
        id,
        file_path AS filePath,
        reason,
        status,
        size_bytes AS sizeBytes,
        created_at AS createdAt
       FROM backups
       WHERE id = ?`
    )
    .get(Number(id));
}

function getStockAdjustment(db, id) {
  const row = db
    .prepare(
      `SELECT
        id,
        occurred_on AS occurredOn,
        item_id AS itemId,
        bucket,
        holder_id AS holderId,
        quantity_delta AS quantityDelta,
        reason
       FROM stock_adjustments
       WHERE id = ?`
    )
    .get(id);
  if (!row) {
    throw new Error(`stock adjustment not found: ${id}`);
  }
  return row;
}

function getSerialNumber(db, id) {
  const row = db
    .prepare(
      `SELECT
        serial_numbers.id,
        serial_numbers.item_id AS itemId,
        items.name AS itemName,
        serial_numbers.serial_text AS serialText,
        serial_numbers.holder_text AS holderText,
        serial_numbers.note,
        serial_numbers.is_active AS isActive,
        serial_numbers.created_at AS createdAt,
        serial_numbers.updated_at AS updatedAt
       FROM serial_numbers
       JOIN items ON items.id = serial_numbers.item_id
       WHERE serial_numbers.id = ?`
    )
    .get(id);
  if (!row) {
    throw new Error(`serial number not found: ${id}`);
  }
  return {
    ...row,
    isActive: Boolean(row.isActive)
  };
}

function listStockAdjustmentRows(db) {
  return db
    .prepare(
      `SELECT
        item_id AS itemId,
        bucket,
        holder_id AS holderId,
        quantity_delta AS quantityDelta
       FROM stock_adjustments
       ORDER BY id`
    )
    .all();
}

function listActiveTransactionRows(db) {
  return db
    .prepare(
      `SELECT
        id,
        type,
        item_id AS itemId,
        person_id AS personId,
        quantity
       FROM transactions
       WHERE is_deleted = 0
       ORDER BY id`
    )
    .all();
}

function replacementTransactionRows(db, replacedId, replacement) {
  const rows = listActiveTransactionRows(db).filter((row) => row.id !== replacedId);
  if (replacement) {
    rows.push(toStockTransactionRow(replacement));
  }
  return rows;
}

function assertTransactionLeavesValidStock(db, transaction) {
  assertTransactionsLeaveValidStock(db, [...listActiveTransactionRows(db), toStockTransactionRow(transaction)]);
}

function assertTransactionsLeaveValidStock(db, transactionRows) {
  const stock = new Map();

  for (const row of listStockAdjustmentRows(db)) {
    const key = stockKey(row.itemId, row.bucket, row.holderId);
    stock.set(key, (stock.get(key) ?? 0) + row.quantityDelta);
  }

  for (const row of transactionRows) {
    for (const entry of buildDeltas(row)) {
      const key = stockKey(row.itemId, entry.bucket, entry.holderId);
      stock.set(key, (stock.get(key) ?? 0) + entry.quantity);
    }
  }

  assertValidStock(stock);
}

function toStockTransactionRow(transaction) {
  return {
    id: transaction.id ?? null,
    type: normalizeTransactionType(transaction.type),
    itemId: transaction.itemId,
    personId: transaction.personId ?? null,
    quantity: transaction.quantity
  };
}

function buildUpdatedTransaction(before, input) {
  const type = normalizeTransactionType(input.type ?? before.type);
  const itemId = input.itemId ?? before.itemId;
  const personId = input.personId ?? before.personId;

  return {
    occurredOn: requireText(input.occurredOn ?? before.occurredOn, "occurred date"),
    type,
    itemId,
    personId: requiresPerson(type) ? personId : null,
    quantity: input.quantity ?? before.quantity,
    serialText: input.serialText === undefined ? before.serialText : input.serialText,
    note: input.note === undefined ? before.note : input.note,
    sourceLabel: input.sourceLabel === undefined ? before.sourceLabel : input.sourceLabel
  };
}

function quantityFor(stock, itemId, bucket, holderId = null) {
  return stock.get(stockKey(itemId, bucket, holderId)) ?? 0;
}

function quantityForBucket(stock, itemId, bucket) {
  let total = 0;
  for (const [key, quantity] of stock.entries()) {
    const [entryItemId, entryBucket] = key.split("::");
    if (entryItemId === String(itemId) && entryBucket === bucket) {
      total += quantity;
    }
  }
  return total;
}

function writeAudit(db, { action, entityType, entityId, before = null, after = null, reason = null }) {
  db.prepare(
    `INSERT INTO audit_log
      (action, entity_type, entity_id, before_json, after_json, reason)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    action,
    entityType,
    entityId,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    reason
  );
}

function findItemByName(db, name) {
  return db
    .prepare("SELECT id, name, is_active AS isActive FROM items WHERE name = ?")
    .get(name);
}

function findPersonByName(db, name) {
  return db
    .prepare("SELECT id, name, is_active AS isActive FROM people WHERE name = ?")
    .get(name);
}

function assertItemExists(db, id) {
  getItem(db, id);
}

function assertPersonExists(db, id) {
  getPerson(db, id);
}

function assertValidAdjustmentInput(db, input) {
  const validBuckets = [Buckets.PART_ROOM, Buckets.OFFICE, Buckets.PERSON];
  if (!validBuckets.includes(input.bucket)) {
    throw new Error(`invalid stock adjustment bucket: ${input.bucket}`);
  }

  if (input.bucket === Buckets.PERSON) {
    if (!input.holderId) {
      throw new Error("holderId is required for person stock adjustment");
    }
    assertPersonExists(db, input.holderId);
    return;
  }

  if (input.holderId) {
    throw new Error(`holderId is not allowed for ${input.bucket} stock adjustment`);
  }
}

function requiresPerson(type) {
  return type === "personal_in" || type === "personal_out";
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function emptyToNull(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  throw new Error("createdAt must be a Date or timestamp string");
}
