# MVP Specification

## Product Shape

The app is a local Windows-friendly inventory tool for one user. It should replace the current two-workbook Excel process.

Preferred shape:

- Open locally from a portable app folder.
- Avoid requiring Python installation on the target PC.
- Store data locally in SQLite.
- Provide import from existing Excel files.
- Provide export to Excel for reporting/backups.

## Main Screens

### Dashboard

Show current totals at a glance:

- 합계 / total stock
- Part-room stock
- Office stock
- Personal vehicle stock total
- Seoul-related stock/shipping count
- Low stock or blocked-negative-stock warnings

### Inventory

Show current inventory by:

- Hardware/item
- Location or bucket
- Person, for personal vehicle stock
- Serial presence/status

Required filters:

- Hardware/item name
- Person
- Serial number
- Location/bucket

### Transactions

Show all inbound/outbound records.

Required filters:

- Date
- Person
- Hardware/item name
- Serial number
- Store/note
- Transaction type

Required actions:

- Add
- Edit
- Delete
- View audit/history

### Serial Numbers

Serial-managed items are not predefined. The app should allow a serial number to be entered for any item whenever needed.

Required actions:

- Register serial
- Search serial
- Link serial to hardware/item
- Show current location/status if available

### Item Master

Hardware/item names are mostly fixed, but editable.

Required actions:

- Add item
- Disable/remove item
- Rename item
- Manage aliases/naming if imported Excel files contain item-name variants

### Import/Export

Import:

- Existing inventory workbook
- Existing usage/history workbook

Export:

- Existing-format Excel workbook export
- Current stock report, matching the old workbook format
- Personal vehicle inventory report, matching the old workbook format
- Transaction history report, matching the old workbook format

Export implementation is deferred from the current build slice. It remains a
future requirement, but should not be implemented until the sheet-level workbook
mapping and export acceptance criteria are complete.

### Backup

The app should create local backups automatically.

Recommended MVP behavior:

- Backup before import.
- Backup once per day when data changes.
- Keep a visible backup list.
- Provide manual "create backup now" action.

## Transaction Types

Confirmed daily workflows:

- 개인 입고
- 개인 출고
- 서울로 반납
- 서울에서 파트실로 택배

Confirmed wording:

- Personal-side exchanges use `입고` and `출고`.
- `서울로 반납` means sending stock from 파트실 to Seoul.
- `서울에서 파트실로 택배` means receiving stock from Seoul into 파트실.
- `서울 입고` may be treated as an alias for `서울에서 파트실로 택배`.

Imported historical categories that may need preservation:

- 입고: personal inbound movement, from an individual back into 파트실
- 출고: personal outbound movement, from 파트실 to an individual
- 서울로 반납: part-room stock sent to Seoul
- 서울에서 파트실로 택배 / 서울 입고: stock received from Seoul into the part room

## Stock Rules

### Confirmed

- Negative stock is not allowed.
- Date is recorded for transactions.
- Date-based historical stock lookup is not required.
- Both part-room stock and personal vehicle stock are managed.
- Personal vehicle inventory is for seeing who is holding which items and each person's held-item totals.
- `합계` is the total stock value.
- Do not model `총재고` as a separate computed stock bucket in the new app.
- Canonical stock formula: `합계 = 파트실 + 개인별 보유 합계 + 사무실 보유/사용분`.
- 개인차량/개인 보유 is a convenience view for seeing per-person holdings.
- 서울 입반출 must show total part counts and update 파트실 according to movement direction.
- 개인 출고 subtracts from 파트실 and increases the selected person's vehicle-held stock.
- 개인 입고 means stock comes from an individual back into 파트실.
- 개인 출고 means stock goes from 파트실 to an individual.
- `서울로 반납` means sending part-room stock to Seoul and decreases 파트실.
- `서울에서 파트실로 택배` / `서울 입고` means stock received from Seoul into 파트실.
- 사무실 재고 is handled like items taken out of 파트실 for office use.
- Stock should normally change through entry forms, not through separate manual subtraction after entry.
- Duplicate serial numbers are allowed.

### MVP Rule Proposal

Each transaction should explicitly define:

- source bucket
- destination bucket
- hardware/item
- quantity
- optional person
- optional serial
- date
- note/store

Examples:

- 개인 출고: 파트실 decreases, selected person's vehicle-held stock increases.
- 개인 입고: 파트실 increases, selected person's vehicle-held stock decreases when applicable.
- 서울로 반납: 파트실 decreases.
- 서울에서 파트실로 택배 / 서울 입고: 파트실 increases.
- 사무실 사용/보유: 파트실 decreases, 사무실 bucket increases.

The app should display the affected buckets before saving each transaction.

Direct stock editing should remain available only for corrections, opening balances, and reconciliation. It should create an audit log entry.

## Validation Rules

- Required fields:
  - date
  - transaction type
  - hardware/item
  - quantity
- Quantity must be greater than zero.
- Serial number is always optional, but can be entered for any item.
- Duplicate serial numbers are allowed.
- Saving a transaction that would make any stock bucket negative must be blocked.
- Editing/deleting a transaction must recalculate current stock.
- Item names should be selected from the master list, with an option to add a new item.

## Audit Rules

For edit/delete:

- Keep original transaction data.
- Keep changed transaction data.
- Store timestamp.
- Store action type: create, update, delete.

## Open Implementation Decisions

1. Local storage format:
   - Use SQLite in a portable local app folder.
2. Excel `.xlsb` import:
   - Browser-only import may not handle `.xlsb` well.
   - For initial migration, use `재고현황 260601.xlsx` as the stock source of truth.
   - Import `사용내역 2602.xlsb` as historical/reference data only.
   - Converting `.xlsb` to `.xlsx` may be acceptable for migration if needed.
3. Export fidelity:
   - Exact legacy workbook reproduction is required.
   - Export target is one unified `.xlsx` workbook.
   - Need to inspect formulas, formatting, and sheet-level output expectations during implementation.
   - Do not implement export in the current build slice.
4. UI wording:
   - Prefer `서울로 반납` for stock sent from 파트실 to Seoul.
   - Prefer `서울에서 파트실로 택배` for stock received from Seoul into 파트실.
   - Treat `서울 입고` as an alias for `서울에서 파트실로 택배`.
   - Use `입고` and `출고` for personal-side exchanges.
   - Keep `서울로 반납` distinct from 개인 입고.

## Migration Decisions

- `충북사무소 재고현황 260601.xlsx` is the initial/current stock source of truth.
- `충북사무소 사용내역 부품신청서 2602.xlsb` is imported as history/reference only, not reapplied to stock during initial migration.
- Export should be one integrated `.xlsx` workbook.
- Target architecture is a portable local app folder with bundled runtime and SQLite.
