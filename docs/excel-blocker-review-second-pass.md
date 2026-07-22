# Excel Import/Export Blocker Review - Second Pass

Date: 2026-07-13

Reviewer: Critic B - Excel Import/Export Blocker Review

Scope: workbook source of truth, import mapping, historical data handling, export target, `.xlsb` risk, legacy formatting, and whether parser/export work can begin.

Anti-scope: product UI except where labels affect imported/exported data semantics.

Verdict: BLOCKER for parser/export implementation; NONBLOCKING GAPS for broader app implementation.

## Summary

The main product decisions are now strong enough to begin app architecture, data model, transaction forms, SQLite setup, backup design, and workbook inspection tooling. However, reliable Excel parser/export implementation should not begin until the workbook mapping contract is made explicit.

Resolved decisions:

- `재고현황 260601.xlsx` is the initial/current stock source of truth.
- `사용내역 부품신청서 2602.xlsb` is imported as history/reference only, not reapplied to stock.
- Export target is one integrated `.xlsx` workbook.
- Target runtime is a portable local app folder with SQLite.
- Duplicate serial numbers are allowed.
- `합계 = 파트실 + 개인별 보유 합계 + 사무실 보유/사용분`.

## Ranked Findings

### 1. P0 - Workbook import mapping is still not concrete enough for parser implementation

The current analysis identifies workbook roles and approximate columns, but not the exact parse contract needed to implement safely.

Evidence:

- `README.md` says everything currently shown in Excel is assumed needed.
- `initial-analysis.md` says personal sheets use repeated blocks "similar to" `하드웨어명 / 차량 / 추가`.
- `spec-gap-review.md` still lists per-sheet mapping, exact header rows, repeated block ranges, ignored rows, formula rows, destination fields, and authoritative-vs-derived sheets as needed.

Decision needed before parser work:

Create a mapping table for each imported sheet:

- sheet name
- whether imported, ignored, or derived
- authoritative role
- header row
- data start/end rules
- repeated block ranges
- item-name column
- quantity column
- person/location source
- serial column, if any
- rows to ignore, including totals, formula rows, blank rows, decorative rows
- destination database table/fields
- validation totals to compare after import

Parser discovery scripts can begin now, but final parser rules should wait for this mapping table.

### 2. P0 - Legacy export format is still not testable

The export target is now one integrated `.xlsx`, which resolves the old "one or two workbooks" ambiguity. But "existing format" is still too vague to test.

Evidence:

- `README.md` requires preserving the existing workbook format as closely as possible.
- `mvp-spec.md` requires current stock, personal vehicle inventory, and transaction history reports matching the old workbook format.
- `spec-gap-review.md` still asks which sheets must be reproduced and which formulas/formatting are mandatory.

Decision needed before export implementation:

Define export acceptance criteria:

- sheet list for the unified workbook
- whether each sheet is copied from old layout, newly designed, or omitted
- which cells/sections must visually match
- whether formulas must be live formulas or static values are acceptable
- required formatting: merged cells, colors, gray total cells, column widths, print layout
- expected totals that exported workbook must match

Export scaffolding can begin with a placeholder workbook, but old-format export cannot be considered implementable until these criteria are captured.

### 3. P1 - Historical `.xlsb` import can proceed only as reference data, with conversion allowed

The `.xlsb` risk is no longer a stock-correctness blocker because the requester clarified that initial stock should come from `재고현황 260601.xlsx` only. The usage workbook is history/reference.

Evidence:

- `README.md` and `mvp-spec.md` say `사용내역 부품신청서 2602.xlsb` should be imported as historical/reference data only.
- `mvp-spec.md` says converting `.xlsb` to `.xlsx` may be acceptable for migration if needed.

Remaining decision:

Confirm an implementation policy:

- Preferred: accept a converted `.xlsx` copy for the historical workbook during first migration.
- Nice-to-have: direct `.xlsb` import if the chosen runtime/library supports it reliably.

This is nonblocking for inventory MVP if the app can import the stock workbook first and mark history import as a separate migration step.

### 4. P1 - Historical transaction type mapping is unresolved, but no longer blocks stock initialization

Because the usage workbook is historical/reference only, old transaction mapping no longer risks double-counting current stock. It still matters for search, reports, and faithful export.

Evidence:

- Old sheets: `입고`, `출고`, `반납`, `서울_파트실_택배`.
- New workflows: `개인 입고`, `개인 출고`, `서울로 반납`, `서울에서 파트실로 택배`.
- `서울 입고` is an alias for `서울에서 파트실로 택배`, and personal-side exchanges use `입고` / `출고`.
- `spec-gap-review.md` still calls for mapping each old sheet/type to new transaction type, source/destination bucket, person requirement, and whether it affects current stock after migration.

Decision needed before history import/export is complete:

For each old sheet, define:

- new transaction type or historical-only type
- whether it affects current stock after import: should be `no`
- how to map person/name/store/note
- how to preserve original sheet/type for export and audit

### 5. P2 - Serial import/export details remain loose but are not blocking

Duplicate serial numbers are allowed, and serials are optional for any item. That is enough to start database and UI work.

Remaining decision:

- For quantity greater than one, can one record contain multiple serial numbers?
- If multiple serials are entered, should their count be validated against quantity?
- Should imported duplicate serials be reported but accepted?

Recommended default: store serials as optional free-text on a transaction line for MVP, and support later normalization if needed.

## Final Decision

Parser/export implementation is blocked until sheet-level mapping and export acceptance criteria are written down. The rest of implementation can begin.

Recommended next step:

1. Build a workbook inspection script that extracts sheet names, dimensions, merged ranges, non-empty cells, formulas, and style hints.
2. Use that output to create `docs/workbook-mapping.md`.
3. Only then implement the import parser and legacy-format `.xlsx` export.

## Exact Questions To Ask

1. 통합 엑셀 내보내기에 포함해야 하는 시트 목록은 무엇인가요?
2. 각 시트는 기존 양식을 그대로 복사해야 하나요, 아니면 내용만 같으면 새 양식도 괜찮나요?
3. 내보낸 엑셀의 수식은 실제 수식으로 살아 있어야 하나요, 아니면 값만 맞으면 되나요?
4. 회색 합계 칸, 병합 셀, 색상, 열 너비, 인쇄 레이아웃 중 반드시 맞춰야 하는 것은 무엇인가요?
5. `재고현황 260601.xlsx`에서 어떤 시트가 실제 초기 재고 기준인가요? 예: `파트실 재고`, `사무실`, 개인별 시트, `개인차량재고 합계`.
6. `사용내역 2602.xlsb`는 변환된 `.xlsx` 파일을 받아서 가져와도 괜찮나요?
7. 과거 기록을 가져올 때 기존 시트명/원본 타입을 그대로 보존해야 하나요?
