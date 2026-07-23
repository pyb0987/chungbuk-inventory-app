export const REQUIRED_SCHEMA_COLUMNS = Object.freeze({
  items: ["id", "name", "is_active", "created_at", "updated_at"],
  people: ["id", "name", "is_active", "created_at", "updated_at"],
  transactions: [
    "id", "occurred_on", "type", "item_id", "person_id", "quantity",
    "serial_text", "note", "source_label", "is_deleted", "created_at", "updated_at"
  ],
  stock_adjustments: [
    "id", "occurred_on", "item_id", "bucket", "holder_id",
    "quantity_delta", "reason", "created_at"
  ],
  serial_numbers: [
    "id", "item_id", "serial_text", "holder_text", "note",
    "is_active", "created_at", "updated_at"
  ],
  audit_log: [
    "id", "action", "entity_type", "entity_id", "before_json",
    "after_json", "reason", "created_at"
  ],
  backups: ["id", "file_path", "reason", "status", "size_bytes", "created_at"],
  import_runs: ["id", "source_file", "source_kind", "status", "report_json", "created_at"],
  legacy_usage_records: [
    "id", "source_file", "source_sheet", "row_number", "occurred_on",
    "legacy_label", "app_type", "person_name", "item_name", "serial_text",
    "quantity", "note", "created_at"
  ]
});

export function assertDatabaseSchema(db) {
  for (const [table, requiredColumns] of Object.entries(REQUIRED_SCHEMA_COLUMNS)) {
    const actual = new Set(
      db.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name)
    );
    if (actual.size === 0) {
      throw new Error(`backup is missing app tables: ${table}`);
    }
    const missing = requiredColumns.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      throw new Error(`database table ${table} is missing columns: ${missing.join(", ")}`);
    }
  }
}
