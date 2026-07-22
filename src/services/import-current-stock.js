import { createHash } from "node:crypto";
import { Buckets } from "../domain/stock-engine.js";
import {
  createImportRunRecord,
  createItem,
  createPerson,
  createStockAdjustment,
  listImportRuns,
  listItems,
  listPeople
} from "../db/repositories.js";
import { withTransaction } from "../db/database.js";

export function importCurrentStockRows(db, input) {
  const sourceFile = requireText(input.sourceFile, "source file");
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const occurredOn = input.occurredOn ?? todayIsoDate();
  const mode = input.mode ?? "initial";
  const allowPartial = input.allowPartial === true;
  const allowDuplicate = input.allowDuplicate === true;
  const report = createEmptyReport(sourceFile, rows.length);
  report.mode = mode;

  if (hasSuccessfulCurrentStockImport(db) && mode !== "additive") {
    throw new Error("current stock has already been imported; choose explicit additive mode or reset first");
  }

  const normalizedRows = normalizeRows(rows, report);
  const importFingerprint = buildImportFingerprint(normalizedRows);
  report.importFingerprint = importFingerprint;
  report.allowDuplicate = allowDuplicate;

  if (report.errors.length > 0 && !allowPartial) {
    report.status = "failed_validation";
    const importRunId = createImportRunRecord(db, {
      sourceFile,
      sourceKind: "current_stock_rows",
      status: report.status,
      report
    });

    return {
      importRunId,
      ...report
    };
  }

  const duplicateImport = findDuplicateSuccessfulCurrentStockImport(db, {
    sourceFile,
    importFingerprint
  });
  if (duplicateImport && !allowDuplicate) {
    throw new Error(
      `duplicate current stock import is blocked; previous import #${duplicateImport.id} used the same snapshot`
    );
  }

  return withTransaction(db, () => {
    const itemByName = new Map(listItems(db).map((item) => [item.name, item]));
    const personByName = new Map(listPeople(db).map((person) => [person.name, person]));

    normalizedRows.forEach(({ normalized }) => {
      const item = getOrCreateItem(db, itemByName, normalized.itemName);

      addOpeningQuantity(db, {
        occurredOn,
        itemId: item.id,
        bucket: Buckets.PART_ROOM,
        quantity: normalized.partRoomQuantity,
        reason: `initial import: ${sourceFile}`
      });

      addOpeningQuantity(db, {
        occurredOn,
        itemId: item.id,
        bucket: Buckets.OFFICE,
        quantity: normalized.officeQuantity,
        reason: `initial import: ${sourceFile}`
      });

      for (const [personName, quantity] of Object.entries(normalized.personHoldings)) {
        const person = getOrCreatePerson(db, personByName, personName);
        if (person.wasCreated) {
          report.createdPeople += 1;
        }
        addOpeningQuantity(db, {
          occurredOn,
          itemId: item.id,
          bucket: Buckets.PERSON,
          holderId: person.id,
          quantity,
          reason: `initial import: ${sourceFile}`
        });
      }

      report.importedRows += 1;
      report.createdItems += item.wasCreated ? 1 : 0;
      report.totalPartRoomQuantity += normalized.partRoomQuantity;
      report.totalOfficeQuantity += normalized.officeQuantity;
      report.totalPersonalQuantity += Object.values(normalized.personHoldings).reduce(
        (sum, quantity) => sum + quantity,
        0
      );
    });

    report.status = report.errors.length > 0 ? "completed_with_errors" : "completed";
    const importRunId = createImportRunRecord(db, {
      sourceFile,
      sourceKind: "current_stock_rows",
      status: report.status,
      report
    });

    return {
      importRunId,
      ...report
    };
  });
}

function hasSuccessfulCurrentStockImport(db) {
  return listImportRuns(db).some(
    (run) =>
      run.sourceKind === "current_stock_rows" &&
      (run.status === "completed" || run.status === "completed_with_errors")
  );
}

function findDuplicateSuccessfulCurrentStockImport(db, { sourceFile, importFingerprint }) {
  return listImportRuns(db).find((run) => {
    if (
      run.sourceKind !== "current_stock_rows" ||
      (run.status !== "completed" && run.status !== "completed_with_errors")
    ) {
      return false;
    }
    if (run.report?.importFingerprint) {
      return run.report.importFingerprint === importFingerprint;
    }
    return run.sourceFile === sourceFile;
  });
}

function normalizeRows(rows, report) {
  const normalizedRows = [];
  rows.forEach((row, index) => {
    const rowNumber = row.rowNumber ?? index + 1;
    try {
      normalizedRows.push({
        rowNumber,
        normalized: normalizeCurrentStockRow(row, rowNumber)
      });
    } catch (error) {
      report.skippedRows += 1;
      report.errors.push({
        rowNumber,
        message: error.message
      });
    }
  });
  return normalizedRows;
}

function normalizeCurrentStockRow(row, rowNumber) {
  const itemName = requireText(row.itemName ?? row["품목"] ?? row["하드웨어명"], `row ${rowNumber} item`);
  const partRoomQuantity = readQuantity(row.partRoomQuantity ?? row["파트실"], "part room", rowNumber);
  const officeQuantity = readQuantity(row.officeQuantity ?? row["사무실"] ?? 0, "office", rowNumber);
  const personHoldings = {};

  const rawPersonHoldings = row.personHoldings ?? {};
  for (const [personName, value] of Object.entries(rawPersonHoldings)) {
    const cleanName = requireText(personName, `row ${rowNumber} person name`);
    const quantity = readQuantity(value, `person ${cleanName}`, rowNumber);
    if (quantity > 0) {
      personHoldings[cleanName] = quantity;
    }
  }

  return {
    rowNumber,
    itemName,
    partRoomQuantity,
    officeQuantity,
    personHoldings
  };
}

function addOpeningQuantity(db, { occurredOn, itemId, bucket, holderId = null, quantity, reason }) {
  if (quantity === 0) {
    return;
  }

  createStockAdjustment(db, {
    occurredOn,
    itemId,
    bucket,
    holderId,
    quantityDelta: quantity,
    reason
  });
}

function getOrCreateItem(db, itemByName, itemName) {
  const existing = itemByName.get(itemName);
  if (existing) {
    return { ...existing, wasCreated: false };
  }
  const created = createItem(db, { name: itemName });
  const wrapped = { ...created, wasCreated: true };
  itemByName.set(itemName, wrapped);
  return wrapped;
}

function getOrCreatePerson(db, personByName, personName) {
  const existing = personByName.get(personName);
  if (existing) {
    return { ...existing, wasCreated: false };
  }
  const created = createPerson(db, { name: personName });
  const wrapped = { ...created, wasCreated: true };
  personByName.set(personName, wrapped);
  return wrapped;
}

function createEmptyReport(sourceFile, totalRows) {
  return {
    sourceFile,
    status: "pending",
    totalRows,
    importedRows: 0,
    skippedRows: 0,
    createdItems: 0,
    createdPeople: 0,
    totalPartRoomQuantity: 0,
    totalPersonalQuantity: 0,
    totalOfficeQuantity: 0,
    errors: []
  };
}

function buildImportFingerprint(normalizedRows) {
  const normalizedPayload = normalizedRows
    .map(({ normalized }) => ({
      itemName: normalized.itemName,
      partRoomQuantity: normalized.partRoomQuantity,
      officeQuantity: normalized.officeQuantity,
      personHoldings: Object.fromEntries(
        Object.entries(normalized.personHoldings).sort(([left], [right]) =>
          left.localeCompare(right, "ko-KR")
        )
      )
    }))
    .sort((left, right) => left.itemName.localeCompare(right.itemName, "ko-KR"));

  return createHash("sha256").update(JSON.stringify(normalizedPayload)).digest("hex");
}

function readQuantity(value, label, rowNumber) {
  const quantity = Number(value ?? 0);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`row ${rowNumber} ${label} quantity must be a non-negative integer`);
  }
  return quantity;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
