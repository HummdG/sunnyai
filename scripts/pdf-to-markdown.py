"""Convert a knowledge-base PDF into structure-preserving Markdown.

    python -I scripts/pdf-to-markdown.py "Knowledge Base.pdf" out.md

Headings are recovered from font size and weight, bullet glyphs become list
items, and tables are detected and written as Markdown tables so the chunker
can keep each one intact (Blueprint §3.2). Used to prepare an installer's PDF
for ingestion until the API extracts PDFs itself.
"""

from __future__ import annotations

import re
import sys

import fitz  # PyMuPDF


def heading_level(size: float, bold: bool) -> int:
    if size >= 22:
        return 1
    if size >= 16:
        return 1
    if size >= 14 and bold:
        return 2
    if size >= 12.5 and bold:
        return 3
    return 0


def clean(text: str) -> str:
    text = text.replace("​", "").replace(" ", " ")
    return re.sub(r"\s+", " ", text).strip()


def table_markdown(table) -> str:
    rows = [[clean(c or "") for c in row] for row in table.extract()]
    rows = [r for r in rows if any(r)]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    esc = lambda c: c.replace("|", "\\|")
    out = ["| " + " | ".join(esc(c) for c in rows[0]) + " |", "|" + " --- |" * width]
    out += ["| " + " | ".join(esc(c) for c in r) + " |" for r in rows[1:]]
    return "\n".join(out)


def convert(path: str) -> str:
    doc = fitz.open(path)
    out: list[str] = []
    para: list[str] = []

    def flush() -> None:
        if para:
            out.append(clean(" ".join(para)))
            para.clear()

    for page in doc:
        tables = page.find_tables().tables
        boxes = [fitz.Rect(t.bbox) for t in tables]
        emitted: set[int] = set()
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            rect = fitz.Rect(block["bbox"])
            inside = next((i for i, b in enumerate(boxes) if b.intersects(rect)), None)
            if inside is not None:
                if inside not in emitted:
                    flush()
                    out.append(table_markdown(tables[inside]))
                    emitted.add(inside)
                continue
            for line in block["lines"]:
                spans = [s for s in line["spans"] if clean(s["text"])]
                if not spans:
                    continue
                text = clean("".join(s["text"] for s in line["spans"]))
                size = max(s["size"] for s in spans)
                bold = all("Bold" in s["font"] or s["flags"] & 16 for s in spans)
                level = heading_level(size, bold)
                if level:
                    flush()
                    if out and out[-1].startswith("#" * level + " ") and level == 1:
                        out[-1] += " " + text  # a title wrapped over two lines
                    else:
                        out.append("#" * level + " " + text)
                elif text in ("●", "•"):
                    flush()
                    para.append("-")
                elif text.startswith(("● ", "• ")):
                    flush()
                    para.append("- " + text[2:])
                else:
                    para.append(text)
            # A block boundary ends a paragraph unless it is a dangling bullet.
            if para and para != ["-"]:
                flush()
        flush()
    md = "\n\n".join(x for x in out if x)
    return re.sub(r"\n\n- \n\n", "\n\n- ", md) + "\n"


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    with open(dst, "w", encoding="utf-8") as f:
        f.write(convert(src))
    print(f"wrote {dst}")
