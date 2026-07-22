# Implementation Readiness Review

Date: 2026-07-13

## Verdict

Implementation can start.

There is no blocker for:

- data model design,
- SQLite schema,
- stock calculation engine,
- transaction forms,
- negative-stock validation tests,
- audit log design,
- backup/restore design,
- workbook inspection and mapping tooling,
- portable local app architecture.

There is one scoped blocker:

- final Excel parser/export implementation should wait until a sheet-level workbook mapping is completed.
- per the latest implementation decision, Excel export is deferred and should
  not be built in the current implementation slice.

## Completed Review Lenses

- Excel import/export review: blocker only for parser/export fidelity, not for app implementation.
- Architecture review: nonblocking gaps only.
- Validation/audit review: nonblocking gaps only.
- Local consistency pass: no additional general blocker found.

One product/domain critic timed out and was closed. Its absence does not change the synthesis because the earlier review and the remaining critics converged on the same high-risk areas.

## Implementation Can Start With These Assumptions

- Target shape: portable Windows app folder with bundled runtime and SQLite.
- Initial/current stock source of truth: `충북사무소 재고현황 260601.xlsx`.
- `충북사무소 사용내역 부품신청서 2602.xlsb` is imported as history/reference only.
- Export target: one unified `.xlsx` workbook.
- Stock total: `합계`.
- Do not model `총재고` as a separate computed bucket.
- Stock equation: `합계 = 파트실 + 개인별 보유 합계 + 사무실 보유/사용분`.
- Serial numbers are optional labels and duplicates are allowed.

## Stock Rules To Implement As Tests First

- `개인 출고`: `파트실 -`, selected person held stock `+`.
- `개인 입고`: `파트실 +`, selected person held stock `-` when applicable.
- `반납 / 서울로 반납`: `파트실 -`.
- `서울_파트실_택배 / 서울에서 파트실로 택배 / 서울 입고`: `파트실 +`.
- `사무실 사용/보유`: `파트실 -`, 사무실 bucket `+`.

UI label policy:

- Use `입고` and `출고` for personal-side exchanges.
- Use `서울로 반납` for stock sent from 파트실 to Seoul.
- Use `서울에서 파트실로 택배` for stock received from Seoul into 파트실.
- Treat `서울 입고` as an alias for `서울에서 파트실로 택배`.

Before saving any transaction, the app should show the affected buckets and block the save if the source bucket would become negative.

## Nonblocking Follow-Up Questions

These should be answered before final export/import completion, but they do not block the core app:

1. Which sheets must appear in the unified `.xlsx` export?
2. Does the exported workbook need live formulas, or are correct values plus matching visual format enough?
3. Is a converted `.xlsx` copy of `사용내역 2602.xlsb` acceptable for historical import?

## Required Implementation Guardrails

- Use soft delete for transactions.
- Keep immutable transaction IDs.
- Recalculate stock after every create/update/delete.
- Audit create, update, delete, import, direct adjustment, item changes, serial edits, backup restore.
- Make import atomic: failed import must not partially mutate production data.
- Produce an import validation report with per-sheet row counts, skipped rows, errors, aliases, duplicates, unresolved rows, and total checks.
- Keep backups in an app-controlled backup folder.
- Create a backup before import and before restore.
- Keep a retention policy, recommended default: last 30 backups.

## Scoped Blocker For Excel Work

Before implementing the final workbook parser/exporter, create a sheet mapping table:

- sheet name,
- import/export role,
- authoritative or derived,
- header rows,
- repeated block ranges,
- ignored rows,
- total/formula rows,
- source columns,
- destination database fields,
- required output formulas/formatting.

Until that table exists, Excel import/export should be treated as inspection/prototype work only.

Current implementation decision:

- Do not implement Excel export yet.
- It is acceptable to keep mapping templates and workbook-inspection notes.
- Core app work should focus on stock rules, persistence, transaction UI,
  audit/backup, and import/migration preparation.
