import assert from "node:assert/strict";
import test from "node:test";

import { isMeaningfulProjectSearch, searchProjects } from "../src/utils/projectSearch.ts";

const projects = [
  {
    id: 1,
    name: "Books catalog",
    start_url: "https://www.books.toscrape.com/",
    allowed_domains_csv: "legacy-allowlist.test",
    sites: [{ id: 1, name: "Books", start_url: "https://www.books.toscrape.com/", scope_mode: "whole_site", path_prefix: "/", role: "primary", is_enabled: true }],
  },
  {
    id: 2,
    name: "Привет мир",
    start_url: "https://example.ru",
    allowed_domains_csv: "legacy-allowlist.test",
    sites: [{ id: 2, name: "Привет", start_url: "https://example.ru", scope_mode: "whole_site", path_prefix: "/", role: "primary", is_enabled: true }],
  },
  {
    id: 3,
    name: "Archive",
    start_url: "https://archive.test/docs",
    allowed_domains_csv: "legacy-allowlist.test",
    sites: [
      { id: 3, name: "Archive docs", start_url: "https://archive.test/docs", scope_mode: "path_prefix", path_prefix: "/docs/", role: "primary", is_enabled: true },
      { id: 4, name: "Help archive", start_url: "https://help.archive.test", scope_mode: "whole_site", path_prefix: "/", role: "peer", is_enabled: true },
    ],
  },
];

test("normalizes case and URL decorations", () => {
  assert.equal(searchProjects(projects, "BOOKS.TOSCRAPE.COM/")[0]?.project.id, 1);
  const fullUrlResult = searchProjects(projects, "https://www.books.toscrape.com")[0];
  assert.equal(fullUrlResult?.project.id, 1);
  assert.equal(fullUrlResult?.highlightQuery, "books.toscrape.com");
  assert.equal(fullUrlResult?.matchedField, "site");
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
    { name: "My book archive", start_url: "https://one.test", sites: [{ id: 1, name: "One", start_url: "https://one.test", scope_mode: "whole_site", path_prefix: "/", role: "primary", is_enabled: true }] },
    { name: "Book", start_url: "https://two.test", sites: [{ id: 2, name: "Two", start_url: "https://two.test", scope_mode: "whole_site", path_prefix: "/", role: "primary", is_enabled: true }] },
    { name: "Book notes", start_url: "https://three.test", sites: [{ id: 3, name: "Three", start_url: "https://three.test", scope_mode: "whole_site", path_prefix: "/", role: "primary", is_enabled: true }] },
  ];
  assert.deepEqual(searchProjects(rows, "book").map((item) => item.project.name), ["Book", "Book notes", "My book archive"]);
});

test("keeps source order for equal ranks and searches secondary project sites", () => {
  const sameRank = [projects[2], projects[0]];
  assert.deepEqual(searchProjects(sameRank, "archive").map((item) => item.project.id), [3]);
  assert.equal(searchProjects(projects, "help.archive.test")[0]?.matchedValue, "https://help.archive.test");
});

test("treats empty and punctuation-only input as a no-op", () => {
  assert.equal(isMeaningfulProjectSearch("..."), false);
  assert.deepEqual(searchProjects(projects, "...").map((item) => item.project.id), [1, 2, 3]);
});
