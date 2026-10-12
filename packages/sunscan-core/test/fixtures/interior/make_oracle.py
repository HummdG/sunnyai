"""Generate Python-oracle fixtures for the TypeScript interior layout (parity test).

Runs the authoritative prototype `research/methods/roofit/layout.py` on seeded random
archetype houses (same distributions as its `batch_test`, inputs rounded to mm) and writes
the room rectangles + stair rectangles per storey as JSON.

Usage (from the repo root):
  research/methods/.venv/Scripts/python packages/core/test/fixtures/interior/make_oracle.py \
      packages/core/test/fixtures/interior/python-oracle.json 40
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "research", "methods"))
from roofit.layout import check, plan_house  # noqa: E402


def r3(v):
    return float(round(float(v), 3))


def main(out, n_per):
    rng = np.random.default_rng(20261008)
    cases = []
    for arch in ("terrace", "terrace+outrigger", "semi", "detached", "bungalow"):
        for _ in range(n_per):
            rear, rs = None, None
            if arch.startswith("terrace"):
                W, D = r3(rng.uniform(4.2, 6.5)), r3(rng.uniform(7.0, 10.5))
                party = {"L": True, "R": bool(rng.random() < 0.7)}
                ns = int(rng.choice([2, 3], p=[0.85, 0.15]))
                if arch.endswith("outrigger"):
                    ow = r3(rng.uniform(2.3, min(3.5, W - 1.2)))
                    rd = r3(rng.uniform(3.0, 7.0))
                    rear = (0.0, ow, rd) if rng.random() < 0.5 else (r3(W - ow), W, rd)
                    rs = int(rng.choice([1, 2]))
                a = "terrace"
            elif arch == "semi":
                W, D = r3(rng.uniform(6.0, 9.0)), r3(rng.uniform(7.0, 10.0))
                party = {"L": True, "R": False}
                ns, a = 2, "semi"
            elif arch == "detached":
                W, D = r3(rng.uniform(7.0, 13.0)), r3(rng.uniform(7.0, 11.0))
                party = {"L": False, "R": False}
                ns, a = 2, "detached"
            else:
                W, D = r3(rng.uniform(8.0, 14.0)), r3(rng.uniform(6.5, 10.0))
                party = {"L": False, "R": False}
                ns, a = 1, "bungalow"
            ff = r3(rng.uniform(2.5, 3.1))
            st = plan_house(W, D, ns, a, party, ff, "modern", rear, rs)
            assert not check(st, W, D, rear, rs)
            cases.append({
                "archetype": a, "W": W, "D": D, "storeys": ns, "party": party, "ff": ff,
                "rear": list(rear) if rear else None, "rearStoreys": rs,
                "plan": [{
                    "rooms": [[r.x0, r.x1, r.y0, r.y1, r.label] for r in s.rooms],
                    "stair": [s.stair.x0, s.stair.x1, s.stair.y0, s.stair.y1] if s.stair else None,
                } for s in st],
            })
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"generator": "research/methods/roofit/layout.py plan_house (era modern)", "cases": cases}, f,
                  separators=(",", ":"))
    print(f"wrote {len(cases)} cases to {out}")


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 40)
