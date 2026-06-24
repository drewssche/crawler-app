import assert from "node:assert/strict";
import test from "node:test";

import { isMeaningfulProjectSearch, searchProjects } from "../src/utils/projectSearch.ts";

const projects = [
  { id: 1, name: "Books catalog", start_url: "https://www.books.toscrape.com/", allowed_domains_csv: "books.toscrape.com" },
  { id: 2, name: "Привет мир", start_url: "https://example.ru", allowed_domains_csv: "example.ru" },
  { id: 3, name: "Archive", start_url: "https://archive.test/docs", allowed_domains_csv: "archive.test,help.archive.test" },
];

test("normalizes case and URL decorations", () => {
  assert.equal(searchProjects(projects, "BOOKS.TOSCRAPE.COM/")[0]?.project.id, 1);
  const fullUrlResult = searchProjects(projects, "https://www.books.toscrape.com")[0];
  assert.equal(fullUrlResult?.project.id, 1);
  assert.equal(fullUrlResult?.highlightQuery, "books.toscrape.com");
  assert.equal(fullUrlResult?.matchedField, "allowed_domain");
});

test("recovers RU to EN keyboard layout and exposes the effective highlight", () => {
  const result = searchProjects(projects, "ищщл")[0];
  assert.equal(result?.project.id, 1);
  assert.equal(result?.highlightQuery, "book");
  assert.equal(result?.viaKeyboardLayout, true);
});

test("recovers EN to RU keyboard layout", () => {
  const result = searchProjects(projects, "ghbdtn")[0];
  assert.equal(result?.project.id, 2);
  assert.equal(result?.highlightQuery, "привет");
});

test("ranks direct exact and prefix matches ahead of substrings and layout matches", () => {
  const rows = [
    { name: "My book archive", start_url: "https://one.test", allowed_domains_csv: "one.test" },
    { name: "Book", start_url: "https://two.test", allowed_domains_csv: "two.test" },
    { name: "Book notes", start_url: "https://three.test", allowed_domains_csv: "three.test" },
  ];
  assert.deepEqual(searchProjects(rows, "book").map((item) => item.project.name), ["Book", "Book notes", "My book archive"]);
});

test("keeps source order for equal ranks and searches secondary domains", () => {
  const sameRank = [projects[2], projects[0]];
  assert.deepEqual(searchProjects(sameRank, "archive").map((item) => item.project.id), [3]);
  assert.equal(searchProjects(projects, "help.archive.test")[0]?.matchedValue, "help.archive.test");
});

test("treats empty and punctuation-only input as a no-op", () => {
  assert.equal(isMeaningfulProjectSearch("..."), false);
  assert.deepEqual(searchProjects(projects, "...").map((item) => item.project.id), [1, 2, 3]);
});
