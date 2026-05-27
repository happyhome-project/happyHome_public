import test from "node:test";
import assert from "node:assert/strict";
import { assertDateRange, compactDate } from "../src/date.mjs";

test("accepts a valid inclusive date range", () => {
  assert.deepEqual(assertDateRange("2026-05-25", "2026-05-25"), {
    begin_date: "2026-05-25",
    end_date: "2026-05-25"
  });
});

test("rejects invalid dates", () => {
  assert.throws(() => assertDateRange("2026-02-30", "2026-03-01"), /valid calendar date/);
  assert.throws(() => assertDateRange("20260525", "2026-05-25"), /YYYY-MM-DD/);
});

test("rejects reversed ranges", () => {
  assert.throws(() => assertDateRange("2026-05-26", "2026-05-25"), /earlier than or equal/);
});

test("compacts a date for file names", () => {
  assert.equal(compactDate("2026-05-25"), "20260525");
});
