# Workbook Rule Reconciliation

Date: 2026-07-13

This note checks whether the clarified requester rules line up with the two original Excel files.

## Clarified Rules Being Checked

- `합계` is the total stock value.
- Do not model `총재고` as a separate computed bucket in the new app.
- `합계 = 파트실 + 개인별 보유 합계 + 사무실 보유/사용분`.
- `개인 출고`: `파트실 -`, selected person held stock `+`.
- `개인 입고`: `파트실 +`, selected person held stock `-` when applicable.
- `반납` / `서울로 반납`: part-room stock sent to Seoul, so `파트실 -`.
- `서울_파트실_택배` / `서울에서 파트실로 택배` / `서울 입고`: stock received from Seoul into part room, so `파트실 +`.
- Personal-side exchanges use the labels `입고` and `출고`.
- Initial/current stock source of truth: `충북사무소 재고현황 260601.xlsx`.
- `충북사무소 사용내역 부품신청서 2602.xlsb` is history/reference only.

## Inventory Workbook Fit

File: `충북사무소 재고현황 260601.xlsx`

The clarified total-stock model mostly fits this workbook.

Relevant sheets:

- personal sheets: `정상호`, `정진원`, `김현수`, `전성진`, `정다훈`, `0` / 최용빈
- `사무실`
- `차량합계`
- `개인차량재고 합계`
- `파트실 재고`

Observed formulas:

```text
'파트실 재고'!D8 = C8 + '차량합계'!C8
```

In row 8 this means:

```text
합계 = 파트실 + 차량합계
```

Observed formula from `차량합계`:

```text
'차량합계'!C8 =
SUM(정다훈!C8, 정상호!C8, '0'!C8, 정진원!C8, 전성진!C8, 김현수!C8, 사무실!C8)
```

This means `차량합계` already includes both personal holdings and office-held/used stock.

So the workbook effectively supports:

```text
합계 = 파트실 + 개인별 보유 합계 + 사무실 보유/사용분
```

This matches the latest clarified rule.

## Personal / Office View Fit

The workbook has person-specific sheets and a `사무실` sheet with the same repeated structure:

```text
하드웨어명 / 차량 / 추가
```

This matches the idea that personal vehicle inventory is mainly a holder view, and office stock is handled like another holder/bucket outside `파트실`.

One caution:

- `차량합계` formulas include `사무실`.
- Therefore the new app should not treat office stock as separate from total; it is part of total through the holder side of the equation.

## Part-Room Fit

`파트실 재고` has columns like:

```text
하드웨어명 / 파트실 / 합계
```

This maps cleanly to:

- `파트실`: items physically remaining in the part room.
- `합계`: total stock across part room + holders.

There is also a `파트실 재고 (2)` sheet, but its quantities differ substantially from `파트실 재고`. It should not be imported blindly as another current-stock source. It is probably an alternate, older, or working copy until proven otherwise.

## Usage Workbook Fit

File: `충북사무소 사용내역 부품신청서 2602.xlsb`

The converted workbook has:

- `입고`
- `출고`
- `반납`
- `서울_파트실_택배`
- `파트`

The `파트` sheet uses this formula:

```text
충북 재고수량 = 입고 - 출고 + 반납
실 재고수량 = 충북 재고수량 - 서울_파트실_택배
```

Observed formula:

```text
'파트'!C3 =
SUMIFS(입고 수량)
- SUMIFS(출고 수량)
+ SUMIFS(반납 수량)
```

Observed formula:

```text
'파트'!E3 = C3 - D3
```

This means the old usage workbook treats `반납` as stock-increasing inside its own `파트` formula.

After the latest terminology clarification, this appears to be a naming/context mismatch rather than a pure arithmetic conflict:

- `입고` and `출고` are personal movement records.
- `입고` means stock comes from an individual back into 파트실.
- `출고` means stock goes from 파트실 to an individual.
- `반납` / `서울로 반납` means sending part-room stock to Seoul in the requested app semantics, so it should be `파트실 -`.
- `서울_파트실_택배` / `서울에서 파트실로 택배` / `서울 입고` means stock coming from Seoul into the part room, so it should be `파트실 +`.

The old `파트` sheet formula should not be copied as the new stock engine without validating these labels.

## Interpretation

The two Excel files are not using one perfectly consistent normalized model, and the old usage workbook labels are overloaded.

Best interpretation:

- `재고현황 260601.xlsx` is the reliable source for current stock.
- `사용내역 2602.xlsb` is a historical/application ledger with its own older formula model and overloaded movement labels.
- The app should not apply the usage workbook formulas to current stock during migration.
- The app can import usage rows as reference/history, but current stock should be rebuilt from `재고현황`.

## Remaining Caution

The main caution is not whether `반납` is possible to interpret; it is now interpretable as stock sent from part room to Seoul. The caution is that the old usage workbook's `파트` formula uses `반납` differently from the new requested workflow.

Use this implementation rule unless the requester reverses it:

```text
반납 / 서울로 반납 = 파트실에서 서울로 보내는 것 = 파트실 -
서울_파트실_택배 / 서울에서 파트실로 택배 / 서울 입고 = 서울에서 파트실로 오는 것 = 파트실 +
```

## Implementation Guidance

Implementation can proceed if:

- current stock import uses `재고현황 260601.xlsx`,
- usage workbook import is history/reference only,
- final stock engine follows the clarified app movement rules, not the old `파트` formula,
- `파트실 재고 (2)` is ignored or treated as non-authoritative until mapped.

Before final Excel export/import:

- decide whether `파트실 재고` or `파트실 재고 (2)` is authoritative,
- map exact sheets/ranges,
- map old `반납` rows carefully because the old workbook formula and new app semantics do not align perfectly.
