"""Read the full standup history and write it to docs/data.json."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import sheets  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(REPO_ROOT, "docs", "data.json")


def main() -> None:
    data = sheets.read_all()
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    n = len(data.get("interns", []))
    print(f"Wrote {OUT_PATH} ({n} interns).")


if __name__ == "__main__":
    main()
