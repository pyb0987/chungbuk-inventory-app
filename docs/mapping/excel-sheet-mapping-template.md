# Excel Sheet Mapping Template

This table must be completed before claiming exact legacy-format Excel export.

| Source workbook | Source sheet | Import role | Export role | Header row | Data start | Data end rule | Source columns | App fields | Legacy label | App label | Formula policy | Format policy | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 재고현황 260601.xlsx | 파트실 재고 | authoritative current stock | export current stock | TBD | TBD | TBD | 하드웨어명, 파트실, 합계 | item, part_room_qty, total_qty | 파트실 재고 | 파트실 재고 | recompute | preserve template if possible | `합계 = 파트실 + 차량합계` |
| 재고현황 260601.xlsx | 차량합계 | derived | export derived view | TBD | TBD | TBD | TBD | item, holder_total_qty | 차량합계 | 개인/사무실 보유 합계 | recompute | preserve template if possible | Includes 사무실 in observed formulas |
| 재고현황 260601.xlsx | 사무실 | holder stock | export holder view | TBD | TBD | TBD | 하드웨어명, 차량, 추가 | item, office_qty, note | 사무실 | 사무실 | values | preserve template if possible | Treated like stock outside 파트실 |
| 재고현황 260601.xlsx | 개인별 sheets | holder stock | export holder view | TBD | TBD | TBD | 하드웨어명, 차량, 추가 | item, person_qty, note | person sheet name | person name | values | preserve template if possible | One sheet per person |
| 사용내역 2602.xlsb | 입고 | historical/reference | export history | TBD | TBD | TBD | TBD | transaction history | 입고 | 입고 | values | preserve template if possible | Personal-side inbound |
| 사용내역 2602.xlsb | 출고 | historical/reference | export history | TBD | TBD | TBD | TBD | transaction history | 출고 | 출고 | values | preserve template if possible | Personal-side outbound |
| 사용내역 2602.xlsb | 반납 | historical/reference | export history | TBD | TBD | TBD | TBD | transaction history | 반납 | 서울로 반납 | values | preserve template if possible | Sent from 파트실 to Seoul in new app semantics |
| 사용내역 2602.xlsb | 서울_파트실_택배 | historical/reference | export history | TBD | TBD | TBD | TBD | transaction history | 서울_파트실_택배 | 서울에서 파트실로 택배 / 서울 입고 | values | preserve template if possible | Received from Seoul into 파트실 |

## Why This Mapping Is Needed

The app stores normalized data: items, people, transactions, current stock, audit
records, and import/export history. The old Excel files store a mixture of
authoritative values, derived formula sheets, repeated person sheets, legacy
labels, and formatting conventions.

Exact export cannot be guaranteed until each old sheet has an explicit rule for:

- whether it is authoritative, derived, historical, or ignored,
- which database fields feed each output column,
- whether formulas are preserved, recomputed, replaced with values, or omitted,
- whether old labels or new UI labels are shown,
- how totals and repeated blocks are generated,
- which formatting must be preserved.
