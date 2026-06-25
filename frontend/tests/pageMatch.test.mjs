import assert from "node:assert/strict";
import test from "node:test";

import { normalizedRelativePath, suggestPageMatch } from "../src/utils/pageMatch.ts";

const page = (id, url) => ({ id, url, status_code: 200, html_hash: String(id) });

test("normalizes hosts, index files, duplicate slashes and trailing slash", () => {
  assert.equal(normalizedRelativePath("https://example.com/Docs//CRM/index.html?x=1"), "/docs/crm");
  assert.equal(normalizedRelativePath("https://other.test/docs/crm/"), "/docs/crm");
});

test("prefers exact normalized relative path across sites", () => {
  const suggestion = suggestPageMatch("https://ru.test/products/crm/", [
    page(1, "https://by.test/other"),
    page(2, "https://by.test/products/crm/index.html"),
  ]);

  assert.equal(suggestion?.page.id, 2);
  assert.equal(suggestion?.confidence, "high");
});

test("offers unique tail match but avoids ambiguous guesses", () => {
  const medium = suggestPageMatch("https://ru.test/catalog/products/crm", [
    page(1, "https://by.test/solutions/products/crm"),
  ]);
  assert.equal(medium?.confidence, "medium");

  const ambiguous = suggestPageMatch("https://ru.test/catalog/products/crm", [
    page(1, "https://by.test/solutions/products/crm"),
    page(2, "https://by.test/archive/products/crm"),
  ]);
  assert.equal(ambiguous, null);
});
