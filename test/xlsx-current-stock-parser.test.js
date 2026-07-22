import test from "node:test";
import assert from "node:assert/strict";
import { createCurrentStockWorkbookFixture } from "./support/xlsx-fixture.js";
import { parseCurrentStockWorkbook } from "../src/services/xlsx-current-stock-parser.js";

test("parseCurrentStockWorkbook converts repeated workbook blocks into import rows", () => {
  const parsed = parseCurrentStockWorkbook(createCurrentStockWorkbookFixture());
  const rowsByName = new Map(parsed.rows.map((row) => [row.itemName, row]));

  assert.equal(parsed.summary.partRoomSheetName, "파트실 재고");
  assert.deepEqual(parsed.summary.personalSheetNames, ["정상호", "0"]);
  assert.equal(parsed.summary.rowCount, 2);

  assert.deepEqual(rowsByName.get("공유기"), {
    rowNumber: 1,
    itemName: "공유기",
    partRoomQuantity: 5,
    officeQuantity: 1,
    personHoldings: {
      정상호: 2
    }
  });
  assert.deepEqual(rowsByName.get("모뎀"), {
    rowNumber: 2,
    itemName: "모뎀",
    partRoomQuantity: 1,
    officeQuantity: 0,
    personHoldings: {
      최용빈: 3
    }
  });
});
