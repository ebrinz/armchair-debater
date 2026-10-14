import json
import subprocess
import sys
from pathlib import Path

SERVER = Path(__file__).parents[1]


def run(*args):
    return subprocess.run([sys.executable, "-m", "playtest", *args], cwd=SERVER, capture_output=True, text=True)


def write(path, events):
    path.write_text("".join(json.dumps(e) + "\n" for e in events))


def test_check_passes_a_clean_timeline_and_fails_a_broken_one(tmp_path):
    write(tmp_path / "20260101-000000-a.jsonl", [
        {"t": 0, "kind": "header"},
        {"t": 1, "kind": "node", "name": "mode_select"},
        {"t": 1.1, "kind": "snapshot", "state": {"stage": "mode"}},
    ])
    clean = run("check", str(tmp_path / "20260101-000000-a.jsonl"))
    assert clean.returncode == 0 and "no violations" in clean.stdout

    write(tmp_path / "20260102-000000-b.jsonl", [{"t": 0, "kind": "header"}, {"t": 1, "kind": "node", "name": "closing"}])
    broken = run("check", str(tmp_path))  # a directory: its newest session
    assert broken.returncode == 1 and "legal-path" in broken.stdout and "20260102" in broken.stdout


def test_check_with_no_sessions_yet_says_so_plainly(tmp_path):
    result = run("check", str(tmp_path / "never-played"))
    assert result.returncode == 1
    assert "no sessions yet" in (result.stdout + result.stderr) and "Traceback" not in result.stderr
