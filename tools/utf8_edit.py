#!/usr/bin/env python3
"""Encoding-safe text edits for PowerShell workflows.

Use escaped unicode (\\uXXXX) in CLI args to avoid codepage corruption.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def decode_escaped(text: str) -> str:
    return text.encode("utf-8").decode("unicode_escape")


def write_utf8_no_bom(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def cmd_set_line(args: argparse.Namespace) -> int:
    path = Path(args.path)
    if not path.exists():
        raise SystemExit(f"File not found: {path}")
    lines = path.read_text(encoding="utf-8").splitlines()
    idx = args.line - 1
    if idx < 0 or idx >= len(lines):
        raise SystemExit(f"Line out of range: {args.line}; file has {len(lines)} lines")
    lines[idx] = decode_escaped(args.text_escaped)
    write_utf8_no_bom(path, "\n".join(lines) + "\n")
    print(f"updated {path}:{args.line}")
    return 0


def cmd_replace_first(args: argparse.Namespace) -> int:
    path = Path(args.path)
    if not path.exists():
        raise SystemExit(f"File not found: {path}")
    text = path.read_text(encoding="utf-8")
    repl = decode_escaped(args.replace_escaped)
    if args.find not in text:
        raise SystemExit("pattern not found")
    text = text.replace(args.find, repl, 1)
    write_utf8_no_bom(path, text)
    print(f"updated {path}: first occurrence")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="UTF-8 safe file edits using escaped text")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_set = sub.add_parser("set-line", help="replace exact line (1-based)")
    p_set.add_argument("--path", required=True)
    p_set.add_argument("--line", type=int, required=True)
    p_set.add_argument("--text-escaped", required=True)
    p_set.set_defaults(func=cmd_set_line)

    p_rep = sub.add_parser("replace-first", help="replace first occurrence in file")
    p_rep.add_argument("--path", required=True)
    p_rep.add_argument("--find", required=True)
    p_rep.add_argument("--replace-escaped", required=True)
    p_rep.set_defaults(func=cmd_replace_first)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
