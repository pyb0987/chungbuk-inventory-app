import { buildTabularWorkbook } from "./inventory-xlsx-export.js";

export function buildTransactionWorkbook(transactions) {
  return buildTabularWorkbook({
    sheetName: "입출고 내역",
    rows: [
      ["날짜", "구분", "품목", "개인", "수량", "시리얼", "메모", "상태"],
      ...transactions.map((row) => [
        row.date,
        row.label,
        row.itemName,
        row.personName,
        row.quantity,
        row.serialText ?? "",
        row.note ?? "",
        row.isDeleted ? "삭제됨" : "정상"
      ])
    ]
  });
}
