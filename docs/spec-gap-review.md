# Specification Gap Multi-Review

Date: 2026-07-13

Verdict after latest requester clarification: MVP is feasible. The canonical stock equation, migration source of truth, export target, serial duplication rule, and runtime direction are now mostly resolved. Remaining details are workbook mapping, exact export fidelity, and a few UI labels.

## Review Lenses

- Product workflow / domain fit
- Excel data migration and legacy export fidelity
- Local Windows / no-install architecture
- Validation, audit, backup, and edge cases

## Highest Priority Gaps

### 1. Canonical Stock Equation

Status: resolved by requester clarification.

Confirmed interpretation:

- `합계` is the total stock value.
- Do not model `총재고` as a separate computed stock bucket in the new app.
- `합계 = 파트실 + 개인별 보유 합계 + 사무실 보유/사용분`.
- 개인차량/개인 보유 is mainly a convenience view for seeing each person's held items.
- 사무실 stock is treated like stock taken out of 파트실 for office use.

Implementation note: if the legacy workbook has a visual `총재고` field, populate or display it from `합계` rather than treating it as an independent source of truth.

### 2. Bucket-Level Negative Stock Rules

The spec says negative stock is blocked, but each transaction type must say which bucket is checked before saving.

Latest transaction direction:

- `개인 출고`: `파트실 -`, selected person held stock `+`.
- `개인 입고`: `파트실 +`, selected person held stock `-` when applicable.
- `서울로 반납`: `파트실 -`.
- `서울에서 파트실로 택배`: `파트실 +`.
- `사무실 사용/보유`: `파트실 -`, 사무실 bucket `+`.
- Edit/delete: should the app block changes that would make current stock negative?

### 3. Initial Import Reconciliation

The two Excel files are different kinds of source data:

- `재고현황 260601.xlsx`: appears to be a current inventory snapshot.
- `사용내역 부품신청서 2602.xlsb`: appears to be transaction/history data.

If both are applied as stock-changing data, stock can be double-counted.

Status: resolved by requester clarification.

```text
At first migration, 재고현황 260601.xlsx is the stock source of truth.
사용내역 부품신청서 2602.xlsb is imported as history/reference only.
```

The import should produce a reconciliation report with:

- rows imported per sheet,
- skipped/error rows,
- item-name aliases,
- duplicate serials,
- unresolved rows,
- stock totals before/after import.

### 4. Legacy Excel Export Target

The requirement says old Excel format should be preserved, but "old format" is not yet testable.

Status: partially resolved by requester clarification.

- Export one unified `.xlsx` workbook.
- Reproduce the existing format as much as possible.
- Still need to define:
- Which sheets must be reproduced?
- Which sheets can be static values instead of formulas?
- Which formatting is mandatory: merged cells, colors, grey total cells, print layout, formulas?

### 5. Runtime / Storage / Backup Architecture

A pure static browser app conflicts with several requirements:

- direct `.xlsb` import,
- exact Excel export,
- automatic backups to a folder,
- durable visible local storage.

Status: resolved by requester clarification.

Use a portable local app folder with bundled runtime and SQLite. This still avoids requiring Python installation and can run locally on Windows, while supporting reliable backups/restores and safer Excel import/export.

### 6. Workbook Parsing Contract

The current workbook analysis is good enough for discovery, but not enough for a reliable parser.

Needed before implementation:

- per-sheet import mapping,
- exact header rows,
- repeated block ranges,
- ignored rows,
- total/formula rows,
- destination fields,
- authoritative sheets vs derived sheets.

### 7. Historical Transaction Mapping

Old sheets use:

- `입고`
- `출고`
- `반납` / `서울로 반납`: part-room stock sent to Seoul
- `서울_파트실_택배` / `서울에서 파트실로 택배` / `서울 입고`: stock received from Seoul into part room

New workflows use:

- `개인 입고`
- `개인 출고`
- `서울로 반납`
- `서울에서 파트실로 택배`

Confirmed label policy:

- Use `입고` and `출고` for personal-side exchanges.
- Use `서울로 반납` for stock sent from 파트실 to Seoul.
- Use `서울에서 파트실로 택배` for stock received from Seoul into 파트실.
- Treat `서울 입고` as an alias for `서울에서 파트실로 택배`.

Remaining implementation mapping:

Map each old sheet/type to:

- new transaction type,
- source bucket,
- destination bucket,
- person requirement,
- whether it affects current stock after migration.

### 8. Serial Rules

Serial numbers are optional and can be entered for any item, but edge cases remain.

Status: partially resolved by requester clarification.

- Duplicate serial numbers are allowed.
- Remaining decisions:
- Can one transaction with quantity greater than one contain multiple serials?
- If serials are entered, should serial count match quantity?
- Does a serial automatically move with the item's stock bucket/person?

### 9. Edit/Delete/Audit Rules

The spec should define safe behavior for historical changes.

Recommended decisions:

- Use soft delete.
- Keep immutable transaction IDs.
- Recalculate stock after every edit/delete.
- Block edits/deletes that would make current stock negative.
- Audit create, update, delete, import, direct stock adjustment, item rename/disable, serial edit, backup restore.

Audit fields should include:

- action,
- timestamp,
- source/actor,
- reason/note,
- before value,
- after value,
- affected item/person/bucket/serial,
- transaction/import ID.

### 10. Backup Restore

Backup is required, but restore is not specified.

Decision needed:

- backup folder,
- retention count/days,
- backup before import,
- backup before restore,
- restore confirmation,
- whether restore previews differences before replacing current data.

## Best Next Questions For Requester

1. 엑셀 내보내기에서 꼭 재현해야 하는 시트는 무엇인가요?
2. 내보낸 엑셀은 수식까지 재현해야 하나요, 아니면 값/서식이 맞으면 충분한가요?
3. 수량이 2개 이상이고 시리얼을 입력하는 경우, 시리얼을 여러 개 입력할 수 있어야 하나요?

## Implementation Readiness

Ready to begin:

- UI skeleton
- item/person/location master data model draft
- transaction entry forms
- audit/backups design
- workbook inspection and mapping script
- portable SQLite runtime design

Should wait for clarification:

- exact export sheet mapping and fidelity level,
- old transaction sheet to new transaction type mapping,
- exact legacy Excel export wording for Seoul-related columns.

## Second-Pass Blocker Review

Date: 2026-07-13

Verdict: NONBLOCKING GAPS.

The updated spec is ready to start implementation, especially database schema,
stock-engine tests, transaction forms, audit/backups design, and workbook
inspection. No remaining issue prevents coding from beginning, but several
rules should be turned into explicit acceptance criteria before the stock engine
and Excel export are treated as complete.

### Ranked Findings

1. Negative-stock checks are specified at a high level, but not yet as a test
   matrix.
   - Evidence: `mvp-spec.md` says any transaction making a bucket negative must
     be blocked, and `spec-gap-review.md` lists transaction directions.
   - Decision: implement a transaction matrix where each stock-decreasing
     bucket is checked before save:
     - 개인 출고: check 파트실.
     - 개인 입고: check selected person's held stock when that person is
       decreased.
     - 서울로 반납: check 파트실 because this means stock sent to Seoul.
     - 서울에서 파트실로 택배 / 서울 입고: no source bucket check, but
       quantity must be positive because this means stock received from Seoul.
     - 사무실 사용/보유: check 파트실.
     - edit/delete/direct adjustment: recalculate all current buckets and block
       if any bucket becomes negative.

2. `서울로 반납` should be implemented as a Seoul-bound movement, not a personal return.
   - Evidence: latest requester clarification says `반납` is sending stock from
     파트실 to Seoul, while `서울_파트실_택배` / `서울에서 파트실로 택배` / `서울 입고` is
     stock coming from Seoul into 파트실.
   - Decision: use clear UI copy `서울로 반납`, so the
     user does not confuse it with personal return into part-room stock. If the
     business meaning changes later, this should be a configuration/rule change
     rather than scattered code edits.

3. Edit/delete behavior needs concrete persistence rules.
   - Decision: use soft delete, immutable transaction IDs, stock recomputation
     after every edit/delete, and block any edit/delete that would create
     negative stock. Keep the original record and the replacement/deleted state
     in audit history.

4. Audit coverage should include more than edit/delete.
   - Decision: audit create, update, delete, import, direct stock adjustment,
     item rename/disable, serial edit, backup restore, and blocked negative-stock
     attempts if practical.
   - Minimum audit fields: action, timestamp, source/actor, reason/note, before
     value, after value, item, person/location bucket, serial text, transaction
     ID, and import/backup ID when relevant.

5. Serial numbers are duplicate-allowed, so they should not be treated as unique
   asset identities.
   - Decision: treat serials as optional searchable labels attached to
     transaction/item records.
   - Recommended MVP rule: a quantity greater than one may have zero or more
     serial strings; do not require serial count to equal quantity unless the
     requester later asks for strict device-level tracking.

6. Import must be atomic and produce a validation report.
   - Decision: importing either workbook should happen in a staging step first.
     Failed imports must not partially mutate live data.
   - Acceptance report should include sheet row counts, imported rows, skipped
     rows, errors, unresolved item names, aliases, duplicate serial values,
     initial stock totals, and final stock totals.

7. Backup restore needs acceptance criteria.
   - Decision: define a local backup folder, retention policy, backup before
     import, backup before restore, restore confirmation, and a pre-restore
     backup of the current database.
   - A restore preview is useful but not required for MVP if backup filenames
     and timestamps are clear.

8. Excel export fidelity is the largest remaining workstream-specific gap.
   - Decision/question: before implementing final export, create a sheet mapping
     table naming which unified `.xlsx` sheets must be present, which values must
     match the old files, and whether formulas/formatting are mandatory or
     best-effort.

### Acceptance Criteria To Add Before Completion

- Stock invariant: for every item, `합계 = 파트실 + 개인별 보유 합계 + 사무실 보유/사용분`.
- Every stock-changing transaction has a source bucket, destination bucket,
  quantity, item, date, optional serial text, and optional person/location.
- No create/edit/delete/direct adjustment can leave any bucket below zero.
- Initial stock is created from `재고현황 260601.xlsx`; the `.xlsb` workbook is
  imported as history/reference only and does not change opening stock.
- Export produces one unified `.xlsx`.
- Backup exists before import and before restore.
