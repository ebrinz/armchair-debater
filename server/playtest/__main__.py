"""python -m playtest check <timeline-or-dir> | run <scenario-or-dir>"""

import sys
from pathlib import Path

from playtest import check


def _newest(path: Path) -> Path:
    if not path.exists():
        print(f"no sessions yet at {path}: play one with ./armchair first")
        sys.exit(1)
    if path.is_dir():
        files = sorted(path.glob("*.jsonl"))
        if not files:
            sys.exit(f"no sessions in {path}")
        return files[-1]
    return path


def cmd_check(target: str) -> int:
    path = _newest(Path(target).expanduser())
    violations = check.check(check.load(path))
    print(f"{path.name}:")
    if not violations:
        print("  no violations")
    for v in violations:
        print(f"  {v.t:8.1f}s  {v.severity:<5}  {v.rule:<20} {v.message}")
    return 1 if check.errors(violations) else 0


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "check":
        return cmd_check(argv[1])
    if argv and argv[0] == "run":
        from playtest import driver

        return driver.main(argv[1:])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
