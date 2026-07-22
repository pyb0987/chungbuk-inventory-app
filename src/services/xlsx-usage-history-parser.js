import { TransactionTypes } from "../domain/stock-engine.js";
import { readXlsxWorkbook, readZipEntries } from "./xlsx-current-stock-parser.js";
import { readXlsbWorkbook } from "./xlsb-workbook-reader.js";

const usageSheetMappings = new Map([
  ["입고", TransactionTypes.PERSONAL_IN],
  ["출고", TransactionTypes.PERSONAL_OUT],
  ["반납", TransactionTypes.RETURN_TO_SEOUL],
  ["서울_파트실_택배", TransactionTypes.SEOUL_TO_PART_ROOM]
]);

export function parseUsageHistoryWorkbook(buffer) {
  const workbook = readUsageHistoryWorkbook(buffer);
  const rows = [];
  const sheetSummaries = [];

  for (const [sheetName, appType] of usageSheetMappings.entries()) {
    const sheet = workbook.sheets.find((candidate) => candidate.name === sheetName);
    if (!sheet) {
      sheetSummaries.push({ sheetName, status: "missing", rowCount: 0 });
      continue;
    }

    const parsed = parseUsageSheet(sheet, appType);
    rows.push(...parsed.rows);
    sheetSummaries.push({
      sheetName,
      status: parsed.header ? "parsed" : "header_not_found",
      rowCount: parsed.rows.length
    });
  }

  return {
    rows: rows.map((row, index) => ({
      ...row,
      importRowNumber: index + 1
    })),
    summary: {
      sheetNames: workbook.sheets.map((sheet) => sheet.name),
      usageSheets: sheetSummaries,
      rowCount: rows.length
    }
  };
}

function readUsageHistoryWorkbook(buffer) {
  const entries = readZipEntries(buffer);
  if (entries.has("xl/workbook.bin")) {
    return readXlsbWorkbook(buffer);
  }
  return readXlsxWorkbook(buffer);
}

function parseUsageSheet(sheet, appType) {
  const header = findUsageHeader(sheet.rows);
  if (!header) {
    return { header: null, rows: [] };
  }

  const rows = [];
  for (let rowIndex = header.rowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    const itemName = cleanText(row[header.columns.itemName]);
    const quantity = readQuantity(row[header.columns.quantity]);
    const hasAnyValue = row.some((value) => cleanText(value) !== "" || Number.isFinite(Number(value)));
    if (!itemName && !hasAnyValue) {
      continue;
    }
    if (!itemName || quantity <= 0) {
      continue;
    }

    rows.push({
      sourceSheet: sheet.name,
      rowNumber: rowIndex + 1,
      occurredOn: parseDateValue(row[header.columns.occurredOn]),
      legacyLabel: sheet.name,
      appType,
      personName: cleanText(row[header.columns.personName]) || null,
      itemName,
      serialText: cleanText(row[header.columns.serialText]) || null,
      quantity,
      note: cleanText(row[header.columns.note]) || null
    });
  }

  return { header, rows };
}

function findUsageHeader(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const normalized = row.map(normalizeHeader);
    const itemColumn = normalized.findIndex((value) => value === "하드웨어명");
    const quantityColumn = normalized.findIndex((value) => value === "수량");
    const dateColumn = normalized.findIndex((value) => value === "날짜");
    if (itemColumn === -1 || quantityColumn === -1) {
      continue;
    }

    return {
      rowIndex,
      columns: {
        occurredOn: dateColumn,
        personName: firstHeaderIndex(normalized, ["이름", "성명", "담당자"]),
        itemName: itemColumn,
        serialText: firstHeaderIndex(normalized, ["시리얼", "시리얼번호", "S/N"]),
        quantity: quantityColumn,
        note: firstHeaderIndex(normalized, ["비고", "점포명", "메모", "내용"])
      }
    };
  }
  return null;
}

function firstHeaderIndex(headers, names) {
  return headers.findIndex((value) => names.includes(value));
}

function parseDateValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialDateToIso(value);
  }
  const text = cleanText(value);
  const match = /^(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})/.exec(text);
  if (!match) {
    return text || null;
  }
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  return `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function excelSerialDateToIso(serial) {
  const millis = Math.round((serial - 25569) * 86_400_000);
  return new Date(millis).toISOString().slice(0, 10);
}

function readQuantity(value) {
  const number = Number(value ?? 0);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function normalizeHeader(value) {
  return cleanText(value).replace(/\s+/g, "");
}

function cleanText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}
