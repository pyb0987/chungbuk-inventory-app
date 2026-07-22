import test from "node:test";
import assert from "node:assert/strict";
import {
  createUsageHistoryWorkbookFixture,
  createUsageHistoryXlsbWorkbookFixture
} from "./support/xlsx-fixture.js";
import { parseUsageHistoryWorkbook } from "../src/services/xlsx-usage-history-parser.js";

test("parseUsageHistoryWorkbook converts legacy sheets into reference rows", () => {
  const parsed = parseUsageHistoryWorkbook(createUsageHistoryWorkbookFixture());

  assert.equal(parsed.summary.rowCount, 4);
  assert.deepEqual(
    parsed.summary.usageSheets.map((sheet) => [sheet.sheetName, sheet.rowCount]),
    [
      ["입고", 1],
      ["출고", 1],
      ["반납", 1],
      ["서울_파트실_택배", 1]
    ]
  );

  assert.deepEqual(parsed.rows.map((row) => [row.sourceSheet, row.appType, row.itemName, row.quantity]), [
    ["입고", "personal_in", "공유기", 1],
    ["출고", "personal_out", "모뎀", 2],
    ["반납", "return_to_seoul", "공유기", 3],
    ["서울_파트실_택배", "seoul_to_part_room", "모뎀", 4]
  ]);
  assert.equal(parsed.rows[1].occurredOn, "2026-02-01");
});

test("parseUsageHistoryWorkbook supports usage-history xlsb workbooks", () => {
  const parsed = parseUsageHistoryWorkbook(createUsageHistoryXlsbWorkbookFixture());

  assert.equal(parsed.summary.rowCount, 4);
  assert.deepEqual(parsed.rows.map((row) => [row.sourceSheet, row.appType, row.itemName, row.quantity]), [
    ["입고", "personal_in", "공유기", 1],
    ["출고", "personal_out", "모뎀", 2],
    ["반납", "return_to_seoul", "공유기", 3],
    ["서울_파트실_택배", "seoul_to_part_room", "모뎀", 4]
  ]);
  assert.equal(parsed.rows[1].occurredOn, "2026-02-01");
});
