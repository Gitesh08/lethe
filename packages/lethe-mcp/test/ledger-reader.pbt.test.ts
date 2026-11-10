// Ledger reader properties: cursor split reads exactly the suffix. Refs: Req 10.9, Req 12.6, Req 23.7
import { type LedgerEvent } from "@lethe/core";
import fc from "fast-check";
import { describe, it } from "vitest";
import { parseLedger } from "../src/load/ledger-file.js";
import { ZERO_CURSOR } from "../src/persist/ledger-cursor.js";
import { KEY_ORDERS, stableLine } from "../src/persist/stable-json.js";
import { runProperty } from "./support/pbt-runner.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const text = fc.oneof(fc.string({ maxLength: 8 }), fc.constantFrom("é", "日本", "🙂", "a b", "\\", '"'));
const eventArb: fc.Arbitrary<LedgerEvent> = fc.record(
  {
    type: fc.constantFrom("task_passed", "spec_cited", "manual_pin"),
    at: fc.date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true }).map((d) => d.toISOString()),
    commit: fc.nat({ max: 100000 }),
    filesTouched: fc.array(text, { maxLength: 3 }),
    cited: fc.array(text, { maxLength: 3 }),
  },
  { requiredKeys: ["type", "at", "commit"] },
) as fc.Arbitrary<LedgerEvent>;

/** A serialized line: valid event (LF or CRLF) or a skippable junk line (blank, garbage, invalid event). */
type Item = { readonly ev: LedgerEvent | null; readonly text: string };
const itemArb: fc.Arbitrary<Item> = fc.oneof(
  { weight: 4, arbitrary: fc.tuple(eventArb, fc.boolean()).map(([e, c]): Item => {
    const l = stableLine(e, KEY_ORDERS.ledgerLine);
    return { ev: e, text: c ? l.replace(/\n$/, "\r\n") : l };
  }) },
  { weight: 1, arbitrary: fc.constantFrom<Item>(
    { ev: null, text: "\n" },
    { ev: null, text: "\r\n" },
    { ev: null, text: "garbage é\n" },
    { ev: null, text: '{"type":"nope","at":"x","commit":1}\n' },
    { ev: null, text: "[1,2]\r\n" },
  ) },
);

const eventsOf = (items: ReadonlyArray<Item>): LedgerEvent[] => items.flatMap((i) => (i.ev === null ? [] : [i.ev]));
const bytesOf = (items: ReadonlyArray<Item>): Uint8Array => enc(items.map((i) => i.text).join(""));

describe("ledger reader properties", () => {
  it("cursor after a prefix reads exactly the suffix events; the zero cursor reads all", () => {
    runProperty(
      "ledger-reader-split",
      fc.property(fc.array(itemArb, { maxLength: 12 }), fc.array(itemArb, { maxLength: 12 }), (prefix, suffix) => {
        const c = parseLedger(bytesOf(prefix)).endCursor;
        const full = bytesOf([...prefix, ...suffix]);
        const next = parseLedger(full, c);
        const all = parseLedger(full, ZERO_CURSOR);
        const ok =
          !next.rewritten &&
          JSON.stringify(next.events) === JSON.stringify(eventsOf(suffix)) &&
          next.tail.length === suffix.length &&
          !all.rewritten &&
          JSON.stringify(all.events) === JSON.stringify(eventsOf([...prefix, ...suffix])) &&
          JSON.stringify(next.endCursor) === JSON.stringify(all.endCursor) &&
          all.endCursor.bytes === full.length;
        if (!ok) throw new Error("split read mismatch");
      }),
    );
  });
});
