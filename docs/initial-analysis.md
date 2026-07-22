# Initial Workbook Analysis

## Inventory Status Workbook

File: `충북사무소 재고현황 260601.xlsx`

Observed workbook roles:

- Personal vehicle inventory sheets:
  - 정상호
  - 정진원
  - 김현수
  - 전성진
  - 정다훈
  - 최용빈, represented by sheet name `0`
- Summary and support sheets:
  - 개인차량재고 합계
  - 차량합계
  - 파트실 재고
  - 파트시리얼
  - 사무실
  - LTE
  - Sheet2
  - 파트실 재고 (2)

The personal sheets use repeated blocks with columns similar to:

```text
하드웨어명 / 차량 / 추가
```

Across the six personal sheets, the first inspection found:

- 882 listed item rows
- 146 unique hardware names
- Vehicle quantity examples with highest totals:
  - 동글이케이블
  - SMT-D456 동글이 (장애)
  - 전원케이블(3구)
  - 동글이아답타
  - HDMI 케이블

## Usage / Parts Request Workbook

File: `충북사무소 사용내역 부품신청서 2602.xlsb`

The binary workbook was converted to `.xlsx` for read-only inspection.

Observed sheets:

- 입고
- 입력
- 반납
- 출고
- 서울_파트실_택배
- 파트
- 시리얼

Transaction-like sheets use columns similar to:

```text
No / 날짜 / 이름 / 하드웨어명 / 시리얼 / 수량 / 비고 or 점포명
```

Observed transaction data:

- `반납`
  - 169 rows
  - quantity total 178
  - date range 2026-02-01 to 2026-03-02
- `출고`
  - 156 rows
  - quantity total 167
  - date range 2026-02-01 to 2026-03-02
- `입고`
  - header only or effectively empty
- `서울_파트실_택배`
  - header only or effectively empty

The `파트` sheet contains the main formula-driven stock calculation.

## Recommended Data Model

Initial tables/entities:

- `items`
  - item id
  - hardware name
  - category/status flags if needed
- `people`
  - person id
  - name
- `locations`
  - part room
  - office
  - personal vehicle
  - Seoul shipping
- `transactions`
  - transaction id
  - type: inbound, outbound, returned, seoul_shipping, adjustment
  - date
  - person
  - hardware
  - serial
  - quantity
  - store/name/note
  - created/updated/deleted metadata
- `opening_balances`
  - source workbook
  - date
  - location/person
  - hardware
  - quantity
- `serials`
  - serial
  - hardware
  - current status/location if needed
- `audit_log`
  - changed table
  - changed record
  - action
  - before/after snapshot
  - timestamp
- `backups`
  - created timestamp
  - file path
  - note

## Recommended First Implementation

1. Import both original Excel files.
2. Convert workbook-specific layouts into normalized tables.
3. Display current inventory views matching the Excel workbook contents.
4. Add forms for daily transaction entry.
5. Add search/filter by date, person, hardware, serial, and store.
6. Add edit/delete with audit log.
7. Add automatic local backup.
8. Add Excel export that recreates needed summaries.
