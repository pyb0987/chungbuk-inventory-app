import test from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, createAppDatabase, withTransaction } from "../src/db/database.js";
import { createItem, listItems } from "../src/db/repositories.js";

test("nested transaction rollback does not commit caught inner writes", () => {
  const db = createAppDatabase();
  try {
    withTransaction(db, () => {
      try {
        withTransaction(db, () => {
          createItem(db, { name: "inner should roll back" });
          throw new Error("inner failure");
        });
      } catch {
        // Outer workflow may recover and continue.
      }

      createItem(db, { name: "outer should commit" });
    });

    assert.deepEqual(
      listItems(db).map((item) => item.name),
      ["outer should commit"]
    );
  } finally {
    closeDatabase(db);
  }
});
