import { readZipEntries } from "./xlsx-current-stock-parser.js";

const recordTypes = {
  bundleSheet: 0x9c,
  sstItem: 0x13,
  rowHeader: 0x00,
  cellBlank: 0x01,
  cellRk: 0x02,
  cellReal: 0x05,
  cellSharedString: 0x07,
  cellInlineString: 0x06
};

export function readXlsbWorkbook(buffer) {
  const entries = readZipEntries(buffer);
  const workbook = requireEntry(entries, "xl/workbook.bin");
  const rels = parseRelationships(requireEntry(entries, "xl/_rels/workbook.bin.rels").text);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.bin")?.data ?? Buffer.alloc(0));

  const sheets = [];
  for (const record of readBinaryRecords(workbook.data)) {
    if (record.type !== recordTypes.bundleSheet) {
      continue;
    }
    const bundleSheet = parseBundleSheet(record.data);
    const target = rels.get(bundleSheet.relationshipId);
    if (!target) {
      continue;
    }
    const sheetPath = normalizeWorkbookTarget(target);
    const sheetEntry = entries.get(sheetPath);
    if (!sheetEntry) {
      continue;
    }
    sheets.push({
      name: bundleSheet.name,
      rows: parseWorksheetRows(sheetEntry.data, sharedStrings)
    });
  }

  return { sheets };
}

function parseSharedStrings(buffer) {
  const strings = [];
  for (const record of readBinaryRecords(buffer)) {
    if (record.type === recordTypes.sstItem) {
      strings.push(readNullableWideString(record.data).value);
    }
  }
  return strings;
}

function parseWorksheetRows(buffer, sharedStrings) {
  const rows = [];
  let currentRowIndex = null;

  for (const record of readBinaryRecords(buffer)) {
    if (record.type === recordTypes.rowHeader) {
      currentRowIndex = record.data.readUInt32LE(0);
      rows[currentRowIndex] ??= [];
      continue;
    }

    if (currentRowIndex === null || !isCellRecord(record.type)) {
      continue;
    }

    const value = readCellValue(record, sharedStrings);
    if (value === undefined) {
      continue;
    }
    const columnIndex = record.data.readUInt32LE(0);
    rows[currentRowIndex] ??= [];
    rows[currentRowIndex][columnIndex] = value;
  }

  return rows;
}

function isCellRecord(type) {
  return [
    recordTypes.cellBlank,
    recordTypes.cellRk,
    recordTypes.cellReal,
    recordTypes.cellSharedString,
    recordTypes.cellInlineString
  ].includes(type);
}

function readCellValue(record, sharedStrings) {
  if (record.type === recordTypes.cellBlank) {
    return undefined;
  }
  if (record.type === recordTypes.cellSharedString) {
    const stringIndex = record.data.readUInt32LE(8);
    return sharedStrings[stringIndex] ?? "";
  }
  if (record.type === recordTypes.cellRk) {
    return decodeRkNumber(record.data.readUInt32LE(8));
  }
  if (record.type === recordTypes.cellReal) {
    return record.data.readDoubleLE(8);
  }
  if (record.type === recordTypes.cellInlineString) {
    return readWideString(record.data, 8).value;
  }
  return undefined;
}

function parseBundleSheet(data) {
  const rel = readWideString(data, 8);
  const name = readWideString(data, rel.nextOffset);
  return {
    relationshipId: rel.value,
    name: name.value
  };
}

function* readBinaryRecords(bufferLike) {
  const buffer = Buffer.from(bufferLike);
  let offset = 0;
  while (offset < buffer.length) {
    const recordOffset = offset;
    const typeResult = readRecordType(buffer, offset);
    const lengthResult = readRecordLength(buffer, typeResult.nextOffset);
    const dataStart = lengthResult.nextOffset;
    const dataEnd = dataStart + lengthResult.length;
    if (dataEnd > buffer.length) {
      throw new Error(`invalid xlsb record length at ${recordOffset}`);
    }
    yield {
      type: typeResult.type,
      data: buffer.subarray(dataStart, dataEnd),
      offset: recordOffset
    };
    offset = dataEnd;
  }
}

function readRecordType(buffer, offset) {
  const first = buffer[offset];
  let nextOffset = offset + 1;
  let type = first & 0x7f;
  if (first & 0x80) {
    type |= buffer[nextOffset] << 7;
    nextOffset += 1;
  }
  return { type, nextOffset };
}

function readRecordLength(buffer, offset) {
  let length = 0;
  let shift = 0;
  let nextOffset = offset;
  while (nextOffset < buffer.length) {
    const byte = buffer[nextOffset];
    nextOffset += 1;
    length |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) {
      return { length, nextOffset };
    }
    shift += 7;
  }
  throw new Error("unterminated xlsb record length");
}

function readNullableWideString(data) {
  if (data.length >= 5) {
    const directLength = data.readUInt32LE(0);
    const nullableLength = data.readUInt32LE(1);
    if (directLength * 2 + 4 <= data.length) {
      return readWideString(data, 0);
    }
    if (nullableLength * 2 + 5 <= data.length) {
      return readWideString(data, 1);
    }
  }
  return { value: "", nextOffset: data.length };
}

function readWideString(data, offset) {
  if (offset + 4 > data.length) {
    return { value: "", nextOffset: data.length };
  }
  const length = data.readUInt32LE(offset);
  const textStart = offset + 4;
  const textEnd = Math.min(textStart + length * 2, data.length);
  return {
    value: data.toString("utf16le", textStart, textEnd),
    nextOffset: textEnd
  };
}

function decodeRkNumber(rawRk) {
  const isScaled = Boolean(rawRk & 0x01);
  const isInteger = Boolean(rawRk & 0x02);
  let value;

  if (isInteger) {
    value = rawRk >> 2;
  } else {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32LE(rawRk & 0xfffffffc, 4);
    value = buffer.readDoubleLE(0);
  }

  return isScaled ? value / 100 : value;
}

function parseRelationships(xml) {
  const relationships = new Map();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const attributes = parseAttributes(match[0]);
    relationships.set(attributes.Id, attributes.Target);
  }
  return relationships;
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

function requireEntry(entries, name) {
  const entry = entries.get(name);
  if (!entry) {
    throw new Error(`xlsb entry not found: ${name}`);
  }
  return entry;
}

function decodeXml(value) {
  return String(value ?? "")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
