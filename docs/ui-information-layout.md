# UI Information Layout

The UI should show the information the requester previously checked in Excel,
but from normalized app data.

## Dashboard

Show summary numbers:

- `합계`: all internal stock, excluding Seoul external movement balance
- `파트실`: stock physically remaining in the part room
- `개인차량`: total stock currently held by people
- `사무실`: stock held/used by office
- `서울로 반납`: quantity sent from 파트실 to Seoul
- `서울에서 파트실로 택배` / `서울 입고`: quantity received from Seoul
- active transaction count
- deleted transaction count
- latest backup

## Inventory View

Mirror the useful shape of `파트실 재고`, `차량합계`, personal sheets, and
`사무실`:

| Column | Meaning |
| --- | --- |
| 품목 | hardware/item name |
| 파트실 | part-room quantity |
| one column per person | personal vehicle-held quantity |
| 사무실 | office-held/used quantity |
| 개인/사무실 합계 | sum of people + office |
| 합계 | 파트실 + 개인/사무실 합계 |

This preserves the workbook rule:

```text
합계 = 파트실 + 개인별 보유 합계 + 사무실 보유/사용분
```

## Transaction History

Show:

- date
- user-facing transaction label
- original imported/source label when applicable
- item
- person, when applicable
- quantity
- serial text
- note
- deleted status

Use these labels:

- `입고`: personal-side inbound, individual to 파트실
- `출고`: personal-side outbound, 파트실 to individual
- `서울로 반납`: 파트실 to Seoul
- `서울에서 파트실로 택배`: Seoul to 파트실
- `서울 입고`: alias for `서울에서 파트실로 택배`

## Backup View

Show:

- backup file path
- reason
- status
- size
- created time

The UI should expose manual backup creation and later restore. Restore must
close the active database connection before replacing the database file.
