#!/usr/bin/env python3
"""Heuristic mojibake fixer for UTF-8 text files.

Repairs common corruption patterns:
- cp1251/latin1/cp866 -> utf8 mojibake (e.g. "РџСЂРёРІРµС‚")
- cp1252/utf8 punctuation artifacts (e.g. "вЂ—", "вЂ¦")
- long '?' loss-like lines by choosing best decoded candidate per line

Usage:
  python tools/fix_mojibake.py TODO.md PATTERNS.md
  python tools/fix_mojibake.py docs --recursive
"""

from __future__ import annotations

import argparse
from pathlib import Path

DEFAULT_EXTS = {".md", ".txt", ".py", ".json", ".yml", ".yaml", ".ts", ".tsx"}
SKIP_DIRS = {".git", "node_modules", "__pycache__", "dist", "build", ".venv", "venv"}

PUNCT_REPLACEMENTS = {
    "вЂ—": "—",
    "вЂ”": "—",
    "вЂ“": "–",
    "вЂ¦": "…",
    "вЂ™": "’",
    "вЂњ": "“",
    "вЂќ": "”",
    "вЂў": "•",
    "вЂ№": "‹",
    "вЂє": "›",
}


def iter_files(root: Path, recursive: bool, exts: set[str]) -> list[Path]:
    if root.is_file():
        return [root]
    if not root.is_dir():
        return []

    glob = root.rglob("*") if recursive else root.glob("*")
    out: list[Path] = []
    for path in glob:
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() in exts:
            out.append(path)
    return out


def ru_count(text: str) -> int:
    n = 0
    for ch in text:
        o = ord(ch)
        if 0x0410 <= o <= 0x044F or o in (0x0401, 0x0451):
            n += 1
    return n


def marker_score(text: str) -> int:
    score = text.count("вЂ") * 6 + text.count("Ð") * 2 + text.count("Ñ") * 2

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        q = stripped.count("?")
        if q >= 8:
            score += q
        if q >= max(8, len(stripped) // 2):
            score += 8
    return score


def quality(text: str) -> int:
    return ru_count(text) * 2 - marker_score(text) * 5


def suspicious(text: str) -> bool:
    if any(m in text for m in ("вЂ", "Ð", "Ñ")):
        return True
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and stripped.count("?") >= max(8, len(stripped) // 2):
            return True
    return False


def try_redecode(text: str, src_encoding: str) -> str | None:
    try:
        return text.encode(src_encoding).decode("utf-8")
    except Exception:
        return None


def apply_punct(text: str) -> str:
    out = text
    for old, new in PUNCT_REPLACEMENTS.items():
        out = out.replace(old, new)
    return out


def choose_best(base: str) -> str:
    base = apply_punct(base)
    if not suspicious(base):
        return base

    best = base
    seen = {base}
    queue = [base]

    for _ in range(2):
        new_queue: list[str] = []
        for item in queue:
            for enc in ("cp1251", "latin1", "cp866"):
                cand = try_redecode(item, enc)
                if not cand:
                    continue
                cand = apply_punct(cand)
                if cand in seen:
                    continue
                seen.add(cand)
                new_queue.append(cand)
                if quality(cand) > quality(best):
                    best = cand
        queue = new_queue
        if not queue:
            break

    return best


def fix_file(path: Path, dry_run: bool) -> tuple[int, int]:
    src = path.read_text(encoding="utf-8")
    lines = src.splitlines(keepends=True)
    out = []
    changed = 0
    for line in lines:
        nl = choose_best(line)
        if nl != line:
            changed += 1
        out.append(nl)
    dst = "".join(out)
    if dst != src and not dry_run:
        path.write_text(dst, encoding="utf-8", newline="\n")
    return changed, len(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fix mojibake heuristically in UTF-8 files")
    parser.add_argument("paths", nargs="+", help="Files or dirs to repair")
    parser.add_argument("--recursive", action="store_true", help="Recurse into directories")
    parser.add_argument("--dry-run", action="store_true", help="Show potential changes only")
    args = parser.parse_args()

    files: list[Path] = []
    for raw in args.paths:
        p = Path(raw)
        files.extend(iter_files(p, recursive=args.recursive, exts=DEFAULT_EXTS))
    files = sorted(set(files))

    total_changed = 0
    for p in files:
        changed, total = fix_file(p, args.dry_run)
        total_changed += changed
        print(f"{p}: changed {changed}/{total} lines")

    mode = "dry-run" if args.dry_run else "write"
    print(f"done ({mode}): files={len(files)}, total changed lines={total_changed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
