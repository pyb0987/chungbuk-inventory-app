import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(projectRoot, "src/ui/index.html"), "utf8");
const appJs = readFileSync(resolve(projectRoot, "src/ui/app.js"), "utf8");

test("static UI navigation buttons have matching view sections", () => {
  const navViews = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
  const sectionViews = new Set(
    [...html.matchAll(/id="view-([^"]+)"/g)].map((match) => match[1])
  );

  assert.deepEqual(navViews, [
    "dashboard",
    "inventory",
    "transactions",
    "import",
    "backup",
    "audit"
  ]);

  for (const view of navViews) {
    assert.equal(sectionViews.has(view), true, `missing section for ${view}`);
  }
});

test("static UI keeps the confirmed Korean inventory workflow labels", () => {
  const requiredLabels = [
    "충북사무소 재고관리",
    "재고표",
    "엑셀로 내보내기",
    "입출고 입력",
    "필요한 경우 입력",
    "수정 취소",
    "현재 재고 가져오기",
    "사용내역 가져오기",
    "사용내역 참고 기록",
    "사용내역 .xlsb 또는 .xlsx 파일",
    "같은 사용내역 다시 가져오기 허용",
    "품목명 검색 후 아래 목록에서 선택",
    "개인 (위치가 개인일 때)",
    "같은 재고 다시 가져오기 허용",
    "오류 없는 행만 가져오기",
    "<th>사유</th>",
    "백업 복원",
    "변경 기록",
    "가져오기 기록",
    "가져온 행",
    "건너뜀",
    "최근 백업"
  ];

  for (const label of requiredLabels) {
    assert.match(html, new RegExp(escapeRegExp(label)), `missing UI label: ${label}`);
  }
});

test("client UI keeps confirmed movement previews and Korean-safe search", () => {
  const requiredClientSnippets = [
    'personal_out: "파트실 - / 개인 +"',
    'personal_in: "개인 - / 파트실 +"',
    'return_to_seoul: "파트실 - / 서울"',
    'seoul_to_part_room: "서울 / 파트실 +"',
    'office_out: "파트실 - / 사무실 +"',
    ".normalize(\"NFC\")",
    ".toLocaleLowerCase(\"ko-KR\")",
    "localIsoDate(new Date())",
    "date.getFullYear()",
    "date.getMonth() + 1",
    "date.getDate()",
    "resetTransactionFormForNewEntry()",
    "elements.transactionForm.itemId.value = \"\"",
    "elements.transactionForm.itemId.value = String(transaction.itemId)",
    "elements.transactionForm.personId.value = transaction.personId ? String(transaction.personId) : \"\"",
    "renderTransactionControls()",
    "async function runUiAction(action, errorTarget = null)",
    "setStatus(`오류: ${error.message}`)",
    "if (errorTarget)",
    "state.transactionSearch = searchKey(event.target.value)",
    "row.serialText, row.note",
    "data-restore-transaction",
    "이 입출고 기록을 복원할까요?",
    "method: \"PATCH\"",
    'serialText: form.get("serialText")',
    "elements.transactionForm.serialText.value = transaction.serialText ?? \"\"",
    "elements.transactionForm.serialText.value = \"\"",
    '<td>${escapeHtml(row.serialText ?? "")}</td>',
    "[\"삭제된 입출고\", dashboard.deletedTransactionCount]",
    "const recentBackup = state.data.dashboard.latestBackup",
    "elements.recentBackup.innerHTML = recentBackup",
    "renderImportRuns()",
    "renderLegacyUsageRecords()",
    "legacyUsageRecords",
    "formatImportCreatedCounts(report)",
    "가져오기 기록 없음"
  ];

  for (const snippet of requiredClientSnippets) {
    assert.equal(appJs.includes(snippet), true, `missing client contract: ${snippet}`);
  }
});

test("item selection uses a combined searchable picker in transaction and adjustment forms", () => {
  const pickerNames = [...html.matchAll(/data-item-picker="([^"]+)"/g)].map(
    (match) => match[1]
  );

  assert.deepEqual(pickerNames, ["adjustment", "transaction"]);
  assert.equal([...html.matchAll(/<input name="itemId" type="hidden"/g)].length, 2);
  assert.equal(html.includes('data-item-picker-list="adjustment"'), true);
  assert.equal(html.includes('data-item-picker-list="transaction"'), true);

  const requiredClientSnippets = [
    "renderItemPicker({",
    'data-select-item="${item.id}"',
    "selectItemFromPicker(itemButton.dataset.picker, itemButton.dataset.selectItem)",
    "fileNameFromPath(backup.filePath)",
    "setStatus(\"품목을 선택하세요\")",
    "이 입출고 기록을 삭제할까요?",
    "renderRestoreSuccess(payload.restore)",
    "fileNameFromPath(beforeRestoreBackup.filePath)"
  ];

  for (const snippet of requiredClientSnippets) {
    assert.equal(appJs.includes(snippet), true, `missing picker contract: ${snippet}`);
  }
});

test("standalone serial management is hidden while transaction serial entry remains", () => {
  assert.equal(html.includes('data-view="serials"'), false);
  assert.equal(html.includes('id="view-serials"'), false);
  assert.equal(html.includes('id="serial-form"'), false);
  assert.equal(html.includes('id="serial-table"'), false);
  assert.equal(
    /id="transaction-form"[\s\S]*?<input name="serialText"/.test(html),
    true
  );
  assert.equal(
    /id="transaction-table"/.test(html) && html.includes("<th>시리얼</th>"),
    true
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
