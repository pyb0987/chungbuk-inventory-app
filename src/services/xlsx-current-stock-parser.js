import { inflateRawSync } from "node:zlib";

const partRoomSheetNames = ["파트실 재고", "파트실 재고 (2)"];
const excludedPersonalSheets = new Set([
  "개인차량재고 합계",
  "차량합계",
  "파트실 재고",
  "파트실 재고 (2)",
  "파트시리얼",
  "사무실",
  "LTE",
  "Sheet2"
]);

export function parseCurrentStockWorkbook(buffer) {
  const workbook = readXlsxWorkbook(buffer);
  const partRoomSheet = selectPartRoomSheet(workbook.sheets);
  if (!partRoomSheet) {
    throw new Error("파트실 재고 sheet was not found");
  }

  const partRoomQuantities = parseBlockQuantitySheet(partRoomSheet, "파트실");
  const officeSheet = workbook.sheets.find((sheet) => sheet.name === "사무실");
  const officeQuantities = officeSheet ? parseBlockQuantitySheet(officeSheet, "차량") : new Map();
  const personalSheets = workbook.sheets.filter(isPersonalSheet);
  const personalQuantitiesByItem = new Map();

  for (const sheet of personalSheets) {
    const personName = displayPersonName(sheet);
    const quantities = parseBlockQuantitySheet(sheet, "차량");
    for (const [itemName, quantity] of quantities.entries()) {
      if (quantity <= 0) {
        continue;
      }
      const holdings = personalQuantitiesByItem.get(itemName) ?? {};
      holdings[personName] = quantity;
      personalQuantitiesByItem.set(itemName, holdings);
    }
  }

  const itemNames = new Set([
    ...partRoomQuantities.keys(),
    ...officeQuantities.keys(),
    ...personalQuantitiesByItem.keys()
  ]);

  const rows = [...itemNames].sort(localeCompareKo).map((itemName, index) => ({
    rowNumber: index + 1,
    itemName,
    partRoomQuantity: partRoomQuantities.get(itemName) ?? 0,
    officeQuantity: officeQuantities.get(itemName) ?? 0,
    personHoldings: personalQuantitiesByItem.get(itemName) ?? {}
  }));

  return {
    rows,
    summary: {
      sheetNames: workbook.sheets.map((sheet) => sheet.name),
      partRoomSheetName: partRoomSheet.name,
      officeSheetName: officeSheet?.name ?? null,
      personalSheetNames: personalSheets.map((sheet) => sheet.name),
      rowCount: rows.length
    }
  };
}

export function readXlsxWorkbook(buffer) {
  const entries = readZipEntries(buffer);
  const workbookXml = requireEntryText(entries, "xl/workbook.xml");
  const workbookRelsXml = requireEntryText(entries, "xl/_rels/workbook.xml.rels");
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.text ?? "");
  const relationships = parseRelationships(workbookRelsXml);
  const sheets = parseWorkbookSheets(workbookXml)
    .map((sheet) => {
      const target = relationships.get(sheet.relationshipId);
      if (!target) {
        return null;
      }
      const path = normalizeWorkbookTarget(target);
      const xml = requireEntryText(entries, path);
      return {
        name: sheet.name,
        rows: parseWorksheetRows(xml, sharedStrings)
      };
    })
    .filter(Boolean);

  return { sheets };
}

function parseBlockQuantitySheet(sheet, quantityHeader) {
  const quantities = new Map();
  for (const header of findBlockHeaders(sheet.rows, quantityHeader)) {
    for (let rowIndex = header.rowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
      const row = sheet.rows[rowIndex] ?? [];
      const itemName = normalizeText(row[header.itemColumn]);
      if (!itemName || isHeaderText(itemName)) {
        continue;
      }
      const quantity = readIntegerQuantity(row[header.quantityColumn]);
      quantities.set(itemName, (quantities.get(itemName) ?? 0) + quantity);
    }
  }
  return quantities;
}

function findBlockHeaders(rows, quantityHeader) {
  const headers = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (normalizeText(value) !== "하드웨어명") {
        return;
      }
      if (normalizeText(row[columnIndex + 1]) !== quantityHeader) {
        return;
      }
      headers.push({
        rowIndex,
        itemColumn: columnIndex,
        quantityColumn: columnIndex + 1
      });
    });
  });
  return headers;
}

function selectPartRoomSheet(sheets) {
  for (const name of partRoomSheetNames) {
    const sheet = sheets.find((candidate) => candidate.name === name);
    if (sheet) {
      return sheet;
    }
  }
  return sheets.find((sheet) => sheet.name.includes("파트실"));
}

function isPersonalSheet(sheet) {
  if (excludedPersonalSheets.has(sheet.name)) {
    return false;
  }
  return findBlockHeaders(sheet.rows, "차량").length > 0;
}

function displayPersonName(sheet) {
  if (sheet.name !== "0" && !excludedPersonalSheets.has(sheet.name)) {
    return sheet.name;
  }
  const title = normalizeText(sheet.rows[1]?.[1]);
  return title ? title.replaceAll(" ", "") : sheet.name;
}

export function readZipEntries(bufferLike) {
  const buffer = Buffer.from(bufferLike);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("invalid xlsx central directory");
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    const data = readLocalFileData(buffer, {
      localHeaderOffset,
      compressedSize,
      compressionMethod
    });
    entries.set(fileName, {
      data,
      text: data.toString("utf8")
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("file is not a valid .xlsx zip archive");
}

function readLocalFileData(buffer, { localHeaderOffset, compressedSize, compressionMethod }) {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("invalid xlsx local file header");
  }
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);

  if (compressionMethod === 0) {
    return compressed;
  }
  if (compressionMethod === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error(`unsupported xlsx compression method: ${compressionMethod}`);
}

function parseWorkbookSheets(xml) {
  return [...xml.matchAll(/<sheet\b[^>]*\/?>/g)].map((match) => {
    const attributes = parseAttributes(match[0]);
    return {
      name: decodeXml(attributes.name),
      relationshipId: attributes["r:id"]
    };
  });
}

function parseRelationships(xml) {
  const relationships = new Map();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const attributes = parseAttributes(match[0]);
    relationships.set(attributes.Id, attributes.Target);
  }
  return relationships;
}

function parseSharedStrings(xml) {
  if (!xml) {
    return [];
  }
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    extractTextFromRichText(match[1])
  );
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowXml = rowMatch[1];
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = parseAttributes(cellMatch[1]);
      const ref = attributes.r;
      if (!ref) {
        continue;
      }
      const { rowIndex, columnIndex } = parseCellReference(ref);
      const value = parseCellValue(cellMatch[2] ?? "", attributes.t, sharedStrings);
      rows[rowIndex] ??= [];
      rows[rowIndex][columnIndex] = value;
    }
  }
  return rows;
}

function parseCellValue(xml, type, sharedStrings) {
  if (type === "inlineStr") {
    return extractTextFromRichText(xml);
  }

  const valueMatch = xml.match(/<v[^>]*>([\s\S]*?)<\/v>/);
  if (!valueMatch) {
    return null;
  }
  const rawValue = decodeXml(valueMatch[1]);
  if (type === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }
  if (type === "str") {
    return rawValue;
  }

  const number = Number(rawValue);
  return Number.isFinite(number) ? number : rawValue;
}

function extractTextFromRichText(xml) {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function parseCellReference(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) {
    throw new Error(`invalid cell reference: ${ref}`);
  }
  let columnIndex = 0;
  for (const character of match[1]) {
    columnIndex = columnIndex * 26 + character.charCodeAt(0) - 64;
  }
  return {
    rowIndex: Number(match[2]) - 1,
    columnIndex: columnIndex - 1
  };
}

function parseAttributes(text) {
  const attributes = {};
  for (const match of text.matchAll(/([\w:]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

function normalizeWorkbookTarget(target) {
  const cleanTarget = target.replace(/^\/+/, "");
  return cleanTarget.startsWith("xl/") ? cleanTarget : `xl/${cleanTarget}`;
}

function requireEntryText(entries, name) {
  const entry = entries.get(name);
  if (!entry) {
    throw new Error(`xlsx entry not found: ${name}`);
  }
  return entry.text;
}

function readIntegerQuantity(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return 0;
  }
  return number;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function isHeaderText(value) {
  return value === "하드웨어명" || value === "파트실" || value === "차량" || value === "합계";
}

function localeCompareKo(left, right) {
  return left.localeCompare(right, "ko-KR");
}

function decodeXml(value) {
  return String(value ?? "")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
