export function createCurrentStockWorkbookFixture() {
  return createZip([
    ["[Content_Types].xml", contentTypesXml()],
    ["xl/workbook.xml", workbookXml([
      ["파트실 재고", "rId1"],
      ["사무실", "rId2"],
      ["정상호", "rId3"],
      ["0", "rId4"]
    ])],
    ["xl/_rels/workbook.xml.rels", workbookRelsXml(4)],
    ["xl/worksheets/sheet1.xml", sheetXml([
      ["B2", "파 트 실"],
      ["B6", "하드웨어명"],
      ["C6", "파트실"],
      ["D6", "합계"],
      ["B8", "공유기"],
      ["C8", 5],
      ["D8", 8],
      ["B9", "모뎀"],
      ["C9", 1],
      ["D9", 4]
    ])],
    ["xl/worksheets/sheet2.xml", sheetXml([
      ["B2", "사무실"],
      ["B6", "하드웨어명"],
      ["C6", "차량"],
      ["B8", "공유기"],
      ["C8", 1],
      ["B9", "모뎀"],
      ["C9", 0]
    ])],
    ["xl/worksheets/sheet3.xml", sheetXml([
      ["B2", "정 상 호"],
      ["B6", "하드웨어명"],
      ["C6", "차량"],
      ["B8", "공유기"],
      ["C8", 2],
      ["B9", "모뎀"],
      ["C9", 0]
    ])],
    ["xl/worksheets/sheet4.xml", sheetXml([
      ["B2", "최 용 빈"],
      ["B6", "하드웨어명"],
      ["C6", "차량"],
      ["B8", "공유기"],
      ["C8", 0],
      ["B9", "모뎀"],
      ["C9", 3]
    ])]
  ]);
}

export function createUsageHistoryWorkbookFixture() {
  return createZip([
    ["[Content_Types].xml", contentTypesXml()],
    ["xl/workbook.xml", workbookXml([
      ["입고", "rId1"],
      ["출고", "rId2"],
      ["반납", "rId3"],
      ["서울_파트실_택배", "rId4"],
      ["파트", "rId5"]
    ])],
    ["xl/_rels/workbook.xml.rels", workbookRelsXml(5)],
    ["xl/worksheets/sheet1.xml", sheetXml([
      ["A1", "No"],
      ["B1", "날짜"],
      ["C1", "이름"],
      ["D1", "하드웨어명"],
      ["E1", "시리얼"],
      ["F1", "수량"],
      ["G1", "비고"],
      ["A2", 1],
      ["B2", "2026-02-01"],
      ["C2", "정상호"],
      ["D2", "공유기"],
      ["E2", "SN-IN"],
      ["F2", 1],
      ["G2", "개인 입고"]
    ])],
    ["xl/worksheets/sheet2.xml", sheetXml([
      ["A2", "No"],
      ["B2", "날짜"],
      ["C2", "이름"],
      ["D2", "하드웨어명"],
      ["E2", "시리얼"],
      ["F2", "수량"],
      ["G2", "점포명"],
      ["A3", 1],
      ["B3", 46054],
      ["C3", "정상호"],
      ["D3", "모뎀"],
      ["E3", "SN-OUT"],
      ["F3", 2],
      ["G3", "테스트점"]
    ])],
    ["xl/worksheets/sheet3.xml", sheetXml([
      ["A1", "No"],
      ["B1", "날짜"],
      ["C1", "이름"],
      ["D1", "하드웨어명"],
      ["E1", "시리얼"],
      ["F1", "수량"],
      ["G1", "비고"],
      ["A2", 1],
      ["B2", "2026.02.03"],
      ["C2", ""],
      ["D2", "공유기"],
      ["E2", ""],
      ["F2", 3],
      ["G2", "서울로"]
    ])],
    ["xl/worksheets/sheet4.xml", sheetXml([
      ["A1", "No"],
      ["B1", "날짜"],
      ["C1", "이름"],
      ["D1", "하드웨어명"],
      ["E1", "시리얼"],
      ["F1", "수량"],
      ["G1", "비고"],
      ["A2", 1],
      ["B2", "2026-02-04"],
      ["D2", "모뎀"],
      ["F2", 4],
      ["G2", "서울에서"]
    ])],
    ["xl/worksheets/sheet5.xml", sheetXml([
      ["A1", "하드웨어명"],
      ["B1", "충북 재고수량"],
      ["C1", "실 재고수량"]
    ])]
  ]);
}

export function createUsageHistoryXlsbWorkbookFixture() {
  const strings = [
    "No",
    "날짜",
    "이름",
    "하드웨어명",
    "시리얼",
    "수량",
    "비고",
    "정상호",
    "공유기",
    "SN-IN",
    "개인 입고",
    "모뎀",
    "SN-OUT",
    "테스트점",
    "서울로",
    "서울에서"
  ];
  const stringIndex = new Map(strings.map((value, index) => [value, index]));
  const sheets = [
    ["입고", "rId1"],
    ["출고", "rId2"],
    ["반납", "rId3"],
    ["서울_파트실_택배", "rId4"],
    ["파트", "rId5"]
  ];

  return createZip([
    ["[Content_Types].xml", contentTypesXml()],
    ["xl/workbook.bin", workbookBin(sheets)],
    ["xl/_rels/workbook.bin.rels", workbookRelsXml(5, ".bin")],
    ["xl/sharedStrings.bin", sharedStringsBin(strings)],
    ["xl/worksheets/sheet1.bin", usageSheetBin(stringIndex, [
      ["s", 0, 1],
      ["s", 1, 2],
      ["s", 2, 7],
      ["s", 3, 8],
      ["s", 4, 9],
      ["n", 5, 1],
      ["s", 6, 10]
    ])],
    ["xl/worksheets/sheet2.bin", usageSheetBin(stringIndex, [
      ["s", 0, 1],
      ["n", 1, 46054],
      ["s", 2, 7],
      ["s", 3, 11],
      ["s", 4, 12],
      ["n", 5, 2],
      ["s", 6, 13]
    ])],
    ["xl/worksheets/sheet3.bin", usageSheetBin(stringIndex, [
      ["s", 0, 1],
      ["s", 1, 2],
      ["s", 3, 8],
      ["n", 5, 3],
      ["s", 6, 14]
    ])],
    ["xl/worksheets/sheet4.bin", usageSheetBin(stringIndex, [
      ["s", 0, 1],
      ["s", 1, 2],
      ["s", 3, 11],
      ["n", 5, 4],
      ["s", 6, 15]
    ])],
    ["xl/worksheets/sheet5.bin", Buffer.alloc(0)]
  ]);
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localFiles = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localFiles.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localFiles, centralDirectory, end]);
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`;
}

function workbookXml(sheets) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets
      .map(([name, relationshipId], index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="${relationshipId}"/>`)
      .join("\n")}
  </sheets>
</workbook>`;
}

function workbookRelsXml(count, extension = ".xml") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 1}" Type="worksheet" Target="worksheets/sheet${index + 1}${extension}"/>`).join("\n")}
</Relationships>`;
}

function sheetXml(cells) {
  const rows = new Map();
  for (const [ref, value] of cells) {
    const rowNumber = Number(ref.match(/\d+$/)[0]);
    const row = rows.get(rowNumber) ?? [];
    row.push([ref, value]);
    rows.set(rowNumber, row);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${[...rows.entries()]
      .sort(([left], [right]) => left - right)
      .map(([rowNumber, rowCells]) => `<row r="${rowNumber}">${rowCells.map(([ref, value]) => cellXml(ref, value)).join("")}</row>`)
      .join("\n")}
  </sheetData>
</worksheet>`;
}

function cellXml(ref, value) {
  if (typeof value === "number") {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function workbookBin(sheets) {
  return Buffer.concat([
    binaryRecord(0x83, Buffer.alloc(0)),
    ...sheets.map(([name, relationshipId], index) =>
      binaryRecord(0x9c, Buffer.concat([
        uint32(0),
        uint32(index + 1),
        wideString(relationshipId),
        wideString(name)
      ]))
    ),
    binaryRecord(0x84, Buffer.alloc(0))
  ]);
}

function sharedStringsBin(strings) {
  return Buffer.concat(strings.map((value) => binaryRecord(0x13, Buffer.concat([
    Buffer.from([0]),
    wideString(value)
  ]))));
}

function usageSheetBin(stringIndex, dataCells) {
  const header = ["No", "날짜", "이름", "하드웨어명", "시리얼", "수량", "비고"].map(
    (value, columnIndex) => ["s", columnIndex, stringIndex.get(value)]
  );
  return Buffer.concat([
    rowRecord(0),
    ...header.map(cellRecord),
    rowRecord(1),
    ...dataCells.map(cellRecord)
  ]);
}

function rowRecord(rowIndex) {
  const data = Buffer.alloc(25);
  data.writeUInt32LE(rowIndex, 0);
  return binaryRecord(0, data);
}

function cellRecord([kind, columnIndex, value]) {
  const data = Buffer.alloc(12);
  data.writeUInt32LE(columnIndex, 0);
  data.writeUInt32LE(0, 4);
  data.writeUInt32LE(kind === "n" ? encodeRkInteger(value) : value, 8);
  return binaryRecord(kind === "n" ? 0x02 : 0x07, data);
}

function binaryRecord(type, data) {
  return Buffer.concat([encodeRecordType(type), encodeRecordLength(data.length), data]);
}

function encodeRecordType(type) {
  if (type < 0x80) {
    return Buffer.from([type]);
  }
  return Buffer.from([(type & 0x7f) | 0x80, type >> 7]);
}

function encodeRecordLength(length) {
  const bytes = [];
  let remaining = length;
  do {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining > 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function wideString(value) {
  const text = Buffer.from(value, "utf16le");
  return Buffer.concat([uint32(value.length), text]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function encodeRkInteger(value) {
  return (value << 2) | 0x02;
}
