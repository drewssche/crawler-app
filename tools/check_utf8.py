#!/usr/bin/env python3
"""UTF-8 and mojibake guard checks."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

DEFAULT_EXTS = {
    ".py",
    ".md",
    ".txt",
    ".yml",
    ".yaml",
    ".json",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".css",
    ".html",
    ".ini",
}

SKIP_DIRS = {".git", "node_modules", "__pycache__", "dist", "build", ".venv", "venv"}
ALT_MOJIBAKE_RE = re.compile(r"(?:Р.|С.){4,}")


def iter_files(root: Path, exts: set[str]) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() in exts:
            files.append(path)
    return files


def has_control_chars(text: str) -> bool:
    for ch in text:
        o = ord(ch)
        if o < 32 and ch not in "\n\r\t":
            return True
    return False


def suspicious_mojibake_score(text: str) -> int:
    score = 0
    score += text.count("вЂ") * 6
    score += text.count("Ð") * 2
    score += text.count("Ñ") * 2

    alt_hits = ALT_MOJIBAKE_RE.findall(text)
    score += len(alt_hits) * 4

    letters = [ch for ch in text if ch.isalpha()]
    if letters:
        rs_ratio = sum(1 for ch in letters if ch in {"Р", "С"}) / len(letters)
        if rs_ratio > 0.22 and len(letters) > 120:
            score += int(rs_ratio * 100)

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        q_count = stripped.count("?")
        if q_count >= 8:
            score += q_count // 2
        if q_count >= max(8, len(stripped) // 2):
            score += 8

    return score


def main() -> int:
    parser = argparse.ArgumentParser(description="Check repository files for UTF-8 safety")
    parser.add_argument("paths", nargs="*", help="Optional explicit files/dirs to check")
    parser.add_argument("--check-mojibake", action="store_true", help="Enable heuristic mojibake checks")
    parser.add_argument(
        "--mojibake-threshold",
        type=int,
        default=10,
        help="Fail file if mojibake marker score is >= threshold (default: 10)",
    )
    args = parser.parse_args()

    candidates: list[Path] = []
    if args.paths:
        for raw in args.paths:
            p = Path(raw)
            if p.is_file():
                candidates.append(p)
            elif p.is_dir():
                candidates.extend(iter_files(p, DEFAULT_EXTS))
    else:
        candidates = iter_files(Path("."), DEFAULT_EXTS)

    candidates = sorted(set(candidates))
    failures: list[str] = []

    for path in candidates:
        try:
            text = path.read_text(encoding="utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            failures.append(f"[decode] {path}: {exc}")
            continue

        if "\ufffd" in text:
            failures.append(f"[replacement-char] {path}: contains U+FFFD")

        if args.check_mojibake:
            if has_control_chars(text):
                failures.append(f"[control-char] {path}: contains non-printable control chars")
            score = suspicious_mojibake_score(text)
            if score >= args.mojibake_threshold:
                failures.append(
                    f"[mojibake] {path}: suspicious marker score={score} (threshold={args.mojibake_threshold})"
                )

    if failures:
        print("UTF-8 guard failed:")
        for item in failures:
            print(item)
        return 1

    print(f"UTF-8 guard passed: {len(candidates)} files checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
