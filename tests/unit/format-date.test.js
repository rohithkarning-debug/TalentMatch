// Stage 10: one date format for the whole UI and the notification texts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDate, formatDateTime } from "../../src/lib/format-date.js";

describe("formatDate", () => {
  it("prints a DATE column as written, with no time-zone shift", () => {
    assert.equal(formatDate("2026-11-16"), "16 Nov 2026");
    assert.equal(formatDate("2026-09-05"), "5 Sep 2026"); // not "Sept"
  });

  it("prints a timestamp as its India calendar date", () => {
    // 20:00 UTC on 15 Oct is 01:30 IST on 16 Oct.
    assert.equal(formatDate("2026-10-15T20:00:00Z"), "16 Oct 2026");
    assert.equal(formatDate(new Date("2026-10-15T18:00:00Z")), "15 Oct 2026");
  });

  it("returns an empty string for missing or invalid input", () => {
    for (const v of [null, undefined, "", "not a date"]) assert.equal(formatDate(v), "");
  });
});

describe("formatDateTime", () => {
  it("prints India time with a 12-hour clock", () => {
    assert.equal(formatDateTime("2026-10-16T15:19:00Z"), "16 Oct 2026, 8:49 pm");
    assert.equal(formatDateTime("2026-10-15T18:30:00Z"), "16 Oct 2026, 12:00 am");
    assert.equal(formatDateTime(new Date("2026-10-16T06:30:00Z")), "16 Oct 2026, 12:00 pm");
  });

  it("matches the format the seed and the triggers write (to_char 'FMDD Mon YYYY, FMHH12:MI am')", () => {
    assert.match(formatDateTime("2026-01-02T03:04:00Z"), /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} (am|pm)$/);
  });
});
