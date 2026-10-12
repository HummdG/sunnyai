"""Clean up the Markdown that scripts/pdf-to-markdown.py produces for the
support knowledge base (Knowledge Base.pdf): restore headings the PDF set in
plain weight, rejoin wrapped bullet lines, and repair the two tables that a
page break split.

    python -I scripts/pdf-to-markdown.py "Knowledge Base.pdf" fixtures/knowledge/support-knowledge-base.md
    python -I scripts/fix-support-kb.py fixtures/knowledge/support-knowledge-base.md

The fixture is generated data: it is excluded from Prettier, because the
retrieval tests depend on its exact tables.
"""

import re
import sys

p = sys.argv[1]
s = open(p, encoding="utf-8").read()
paras = s.split("\n\n")

SUBHEADS = {
    "Overview", "Bot guidance", "Bot rules", "Troubleshooting flow", "Purpose and background",
    "Safety rules", "Security rules", "Guidance", "General explanation", "Application process",
}
ROUTING = {"Safety concerns", "Manufacturer support", "Installer support", "Energy supplier support", "General information"}

out = []
for para in paras:
    t = para.strip()
    if not t:
        continue
    if t in SUBHEADS or t in ROUTING or (t.startswith("Customer question:") and len(t) < 160):
        out.append("### " + t)
        continue
    if re.match(r"^\d+\. [A-Z]", t) and len(t) < 60 and not t.startswith("#"):
        out.append("## " + t)
        continue
    if t == "# Standard information to collect":
        out.append("### Standard information to collect")
        continue
    if t == "# Routing priorities":
        out.append("### Routing priorities")
        continue
    if t.startswith("# 14. Knowledge base completion"):
        out.append("## 14. Knowledge base completion checklist")
        continue
    if t == "# Publishing and maintenance rules":
        out.append("### Publishing and maintenance rules")
        continue
    # A wrapped line of a bullet or step: join it to the previous paragraph.
    if out and t[0].islower() and not out[-1].startswith(("#", "|")):
        out[-1] = out[-1] + " " + t
        continue
    out.append(t)

s = "\n\n".join(out) + "\n"

# The generation table swallowed its footnote and the customer question.
bad = re.search(r"\| These figures are approximate.*?\| there's an issue with my panels\. \|  \|\n", s, re.S)
if bad:
    s = s.replace(
        bad.group(0),
        "\nThese figures are approximate reference points, not guaranteed thresholds. Actual results vary "
        "with location, orientation, roof pitch, shading, weather and system size.\n\n"
        "### Customer question: My generation in September is much lower than in August. "
        "I think there's an issue with my panels.\n",
    )

# The routing table was split across a page and picked up the section title.
start = s.index("|  | 13. Chatbot routing and escalation rules")
end = s.index("### Standard information to collect")
block = s[start:end]
rows = []
for line in block.splitlines():
    if not line.startswith("|") or "---" in line:
        continue
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    cells = [c for c in cells if c]
    if len(cells) == 3 and cells[0] not in ("Issue",):
        rows.append(cells)
table = ["| Issue | Initial bot action | Where to direct the customer |", "| --- | --- | --- |"]
table += ["| " + " | ".join(r) + " |" for r in rows]
s = (
    s[:start]
    + "## 13. Chatbot routing and escalation rules\n\n### Recommended routing\n\n"
    + "\n".join(table)
    + "\n\n"
    + s[end:]
)
open(p, "w", encoding="utf-8").write(s)
print("routing rows", len(rows))
