export const Buckets = Object.freeze({
  PART_ROOM: "part_room",
  OFFICE: "office",
  PERSON: "person",
  SEOUL: "seoul_external"
});

export const TransactionTypes = Object.freeze({
  PERSONAL_IN: "personal_in",
  PERSONAL_OUT: "personal_out",
  RETURN_TO_SEOUL: "return_to_seoul",
  SEOUL_TO_PART_ROOM: "seoul_to_part_room",
  OFFICE_OUT: "office_out",
  ADJUSTMENT: "adjustment"
});

export const TransactionLabels = Object.freeze({
  [TransactionTypes.PERSONAL_IN]: "입고",
  [TransactionTypes.PERSONAL_OUT]: "출고",
  [TransactionTypes.RETURN_TO_SEOUL]: "서울로 반납",
  [TransactionTypes.SEOUL_TO_PART_ROOM]: "서울에서 파트실로 택배",
  [TransactionTypes.OFFICE_OUT]: "사무실 사용/보유",
  [TransactionTypes.ADJUSTMENT]: "재고 조정"
});

export const LegacyAliases = Object.freeze({
  "입고": TransactionTypes.PERSONAL_IN,
  "개인 입고": TransactionTypes.PERSONAL_IN,
  "출고": TransactionTypes.PERSONAL_OUT,
  "개인 출고": TransactionTypes.PERSONAL_OUT,
  "반납": TransactionTypes.RETURN_TO_SEOUL,
  "서울로 반납": TransactionTypes.RETURN_TO_SEOUL,
  "서울_파트실_택배": TransactionTypes.SEOUL_TO_PART_ROOM,
  "서울*파트실*택배": TransactionTypes.SEOUL_TO_PART_ROOM,
  "서울에서 파트실로 택배": TransactionTypes.SEOUL_TO_PART_ROOM,
  "서울 입고": TransactionTypes.SEOUL_TO_PART_ROOM,
  "사무실 사용/보유": TransactionTypes.OFFICE_OUT,
  "사무실": TransactionTypes.OFFICE_OUT
});

export function normalizeTransactionType(input) {
  if (!input || typeof input !== "string") {
    throw new Error("transaction type is required");
  }

  if (Object.values(TransactionTypes).includes(input)) {
    return input;
  }

  const normalized = LegacyAliases[input.trim()];
  if (!normalized) {
    throw new Error(`unknown transaction type: ${input}`);
  }
  return normalized;
}

export function buildDeltas(transaction) {
  const type = normalizeTransactionType(transaction.type);
  const quantity = Number(transaction.quantity);

  if (type === TransactionTypes.ADJUSTMENT) {
    return buildAdjustmentDeltas(transaction);
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive integer");
  }

  switch (type) {
    case TransactionTypes.PERSONAL_OUT:
      requirePerson(transaction);
      return [
        delta(Buckets.PART_ROOM, null, -quantity),
        delta(Buckets.PERSON, transaction.personId, quantity)
      ];

    case TransactionTypes.PERSONAL_IN:
      requirePerson(transaction);
      return [
        delta(Buckets.PERSON, transaction.personId, -quantity),
        delta(Buckets.PART_ROOM, null, quantity)
      ];

    case TransactionTypes.RETURN_TO_SEOUL:
      return [
        delta(Buckets.PART_ROOM, null, -quantity),
        delta(Buckets.SEOUL, null, quantity)
      ];

    case TransactionTypes.SEOUL_TO_PART_ROOM:
      return [
        delta(Buckets.SEOUL, null, -quantity, { allowExternalNegative: true }),
        delta(Buckets.PART_ROOM, null, quantity)
      ];

    case TransactionTypes.OFFICE_OUT:
      return [
        delta(Buckets.PART_ROOM, null, -quantity),
        delta(Buckets.OFFICE, null, quantity)
      ];

    default:
      throw new Error(`unsupported transaction type: ${type}`);
  }
}

export function applyTransaction(currentStock, transaction) {
  const nextStock = cloneStock(currentStock);
  const deltas = buildDeltas(transaction);

  for (const entry of deltas) {
    const key = stockKey(transaction.itemId, entry.bucket, entry.holderId);
    nextStock.set(key, (nextStock.get(key) ?? 0) + entry.quantity);
  }

  assertNoNegativeInternalStock(nextStock);
  return nextStock;
}

export function assertValidStock(stock) {
  assertNoNegativeInternalStock(stock);
}

export function totalForItem(stock, itemId) {
  let total = 0;
  for (const [key, quantity] of stock.entries()) {
    const parsed = parseStockKey(key);
    if (parsed.itemId === String(itemId) && parsed.bucket !== Buckets.SEOUL) {
      total += quantity;
    }
  }
  return total;
}

export function stockKey(itemId, bucket, holderId = null) {
  if (!itemId) {
    throw new Error("itemId is required");
  }
  if (!bucket) {
    throw new Error("bucket is required");
  }
  return `${itemId}::${bucket}::${holderId ?? ""}`;
}

function parseStockKey(key) {
  const [itemId, bucket, holderId] = key.split("::");
  return { itemId, bucket, holderId: holderId || null };
}

function delta(bucket, holderId, quantity, options = {}) {
  return { bucket, holderId: holderId ?? null, quantity, ...options };
}

function requirePerson(transaction) {
  if (!transaction.personId) {
    throw new Error("personId is required for personal transactions");
  }
}

function cloneStock(stock) {
  if (stock instanceof Map) {
    return new Map(stock);
  }
  return new Map(Object.entries(stock ?? {}));
}

function assertNoNegativeInternalStock(stock) {
  for (const [key, quantity] of stock.entries()) {
    const parsed = parseStockKey(key);
    if (parsed.bucket !== Buckets.SEOUL && quantity < 0) {
      throw new Error(`negative stock is not allowed: ${key} = ${quantity}`);
    }
  }
}

function buildAdjustmentDeltas(transaction) {
  const quantity = Number(transaction.quantity);
  if (!Number.isInteger(quantity) || quantity === 0) {
    throw new Error("adjustment quantity must be a non-zero integer");
  }
  if (!transaction.bucket) {
    throw new Error("bucket is required for adjustment");
  }
  return [delta(transaction.bucket, transaction.holderId ?? null, quantity)];
}
