# Import Workflow

The completed program should not ship with real inventory data. Stock data gets
stale quickly, so the app must start empty and let the user import the current
Excel file when they first run it.

## Current Implementation

The import service accepts normalized current-stock rows:

```js
{
  itemName: "공유기",
  partRoomQuantity: 5,
  officeQuantity: 1,
  personHoldings: {
    "정상호": 2,
    "김현수": 1
  }
}
```

This mirrors the useful Excel views:

- `파트실 재고`: item + part-room quantity + total
- personal vehicle sheets: one quantity per person
- `사무실`: office-held/used quantity
- `차량합계`: derived from people + office

The app also has a direct `.xlsx` parser for the current-stock workbook shape
seen in `충북사무소 재고현황 260601.xlsx`. It reads:

- `파트실 재고` for part-room quantities,
- `사무실` for office-held/used quantities,
- personal vehicle sheets for each person's held quantities.

## Import Behavior

- The app starts empty.
- User selects/imports their own current workbook.
- Imported rows create items and people as needed.
- Imported quantities become audited opening stock adjustments.
- Import records an `import_runs` report.
- Invalid rows fail validation and do not mutate stock by default.
- Partial import is allowed only when explicitly requested.
- A second current-stock import is blocked by default so opening stock is not
  accidentally doubled.
- Re-importing as additive data must be an explicit user choice.
- Exact duplicate snapshots are blocked even in additive mode unless the user
  explicitly checks the duplicate-import override.
- No Excel export is implemented in this slice.

## UI Behavior

The import screen should show:

- selected file name,
- row count,
- imported rows,
- skipped rows,
- created item count,
- created person count,
- total imported quantities,
- validation errors with row numbers.
- whether the import is a first import, explicit partial import, or explicit
  additive import.

## Pending Adapter Work

The `.xlsx` parser is intentionally separate from the import business rules so
the app never needs bundled sample data. Remaining adapter work:

- broaden parser acceptance if the requester changes the workbook layout,
- add `.xlsb` historical/reference import later,
- keep Excel export deferred until sheet-level mapping is confirmed.
