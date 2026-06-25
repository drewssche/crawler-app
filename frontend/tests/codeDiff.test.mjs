import assert from "node:assert/strict";
import test from "node:test";

import { buildLineDiff } from "../src/utils/codeDiff.ts";

test("line diff keeps matching lines and marks replacements", () => {
  const rows = buildLineDiff("<h1>A</h1>\n<p>old</p>", "<h1>A</h1>\n<p>new</p>");

  assert.equal(rows[0].kind, "same");
  assert.ok(rows.some((row) => row.kind === "removed" && row.left.includes("old")));
  assert.ok(rows.some((row) => row.kind === "added" && row.right.includes("new")));
});

test("line diff supports empty sides", () => {
  assert.deepEqual(buildLineDiff("", "new").map((row) => row.kind), ["added"]);
  assert.deepEqual(buildLineDiff("old", "").map((row) => row.kind), ["removed"]);
});
