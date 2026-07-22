import { createHash } from "node:crypto";
import {
  createImportRunRecord,
  createLegacyUsageRecord,
  listImportRuns
} from "../db/repositories.js";
import { withTransaction } from "../db/database.js";

const sourceKind = "legacy_usage_history";

export function importUsageHistoryRows(db, input) {
  const sourceFile = requireText(input.sourceFile, "source file");
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const allowPartial = input.allowPartial === true;
  const allowDuplicate = input.allowDuplicate === true;
  const report = createEmptyReport(sourceFile, rows.length);

  const normalizedRows = normalizeRows(rows, report);
  const importFingerprint = buildImportFingerprint(normalizedRows);
  report.importFingerprint = importFingerprint;
  report.allowDuplicate = allowDuplicate;

  if (report.errors.length > 0 && !allowPartial) {
    report.status = "failed_validation";
    const importRunId = createImportRunRecord(db, {
      sourceFile,
      sourceKind,
      status: report.status,
      report
    });
    return { importRunId, ...report };
  }

  const duplicateImport = findDuplicateSuccessfulUsageImport(db, { importFingerprint });
  if (duplicateImport && !allowDuplicate) {
    throw new Error(
      `duplicate usage history import is blocked; previous import #${duplicateImport.id} used the same rows`
    );
  }

  return withTransaction(db, () => {
    for (const { normalized } of normalizedRows) {
      createLegacyUsageRecord(db, {
        sourceFile,
        ...normalized
      });
      report.importedRows += 1;
      report.totalQuantity += normalized.quantity;
      report.sheetCounts[normalized.sourceSheet] = (report.sheetCounts[normalized.sourceSheet] ?? 0) + 1;
    }

    report.status = report.errors.length > 0 ? "completed_with_errors" : "completed";
    const importRunId = createImportRunRecord(db, {
      sourceFile,
      sourceKind,
      status: report.status,
      report
    });
    return { importRunId, ...report };
  });
}

function normalizeRows(rows, report) {
  const normalizedRows = [];
  rows.forEach((row, index) => {
    const rowNumber = row.importRowNumber ?? row.rowNumber ?? index + 1;
    try {
      normalizedRows.push({
        rowNumber,
        normalized: normalizeUsageHistoryRow(row, rowNumber)
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

function normalizeUsageHistoryRow(row, rowNumber) {
  const quantity = Number(row.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`row ${rowNumber} quantity must be a positive integer`);
  }

  return {
    sourceSheet: requireText(row.sourceSheet, `row ${rowNumber} source sheet`),
    rowNumber: Number(row.rowNumber ?? rowNumber),
    occurredOn: emptyToNull(row.occurredOn),
    legacyLabel: requireText(row.legacyLabel, `row ${rowNumber} legacy label`),
    appType: requireText(row.appType, `row ${rowNumber} app type`),
    personName: emptyToNull(row.personName),
    itemName: requireText(row.itemName, `row ${rowNumber} item`),
    serialText: emptyToNull(row.serialText),
    quantity,
    note: emptyToNull(row.note)
  };
}

function findDuplicateSuccessfulUsageImport(db, { importFingerprint }) {
  return listImportRuns(db).find(
    (run) =>
      run.sourceKind === sourceKind &&
      (run.status === "completed" || run.status === "completed_with_errors") &&
      run.report?.importFingerprint === importFingerprint
  );
}

function buildImportFingerprint(normalizedRows) {
  const normalizedPayload = normalizedRows
    .map(({ normalized }) => normalized)
    .sort((left, right) =>
      [
        left.sourceSheet.localeCompare(right.sourceSheet, "ko-KR"),
        left.rowNumber - right.rowNumber,
        left.itemName.localeCompare(right.itemName, "ko-KR")
      ].find((value) => value !== 0) ?? 0
    );

  return createHash("sha256").update(JSON.stringify(normalizedPayload)).digest("hex");
}

function createEmptyReport(sourceFile, totalRows) {
  return {
    sourceFile,
    status: "pending",
    totalRows,
    importedRows: 0,
    skippedRows: 0,
    totalQuantity: 0,
    sheetCounts: {},
    errors: []
  };
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
