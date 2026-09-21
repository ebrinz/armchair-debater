"""The client bundles copies of the two contract fixtures (the mock replays one,
THE DECK reads the other). A copy that drifts is a lie the UI tells."""

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
PAIRS = [
    ("docs/design/debate-state-fixtures.json", "client/src/arcade/fixtures/debate-state.json"),
    ("docs/design/theory-cards-fixture.json", "client/src/arcade/fixtures/theory-cards.json"),
]


@pytest.mark.parametrize(("contract", "bundled"), PAIRS)
def test_the_clients_copy_matches_the_contract(contract, bundled):
    if not (ROOT / bundled).exists():
        pytest.skip("no client checkout beside the server (e.g. inside the image)")
    assert json.loads((ROOT / bundled).read_text()) == json.loads((ROOT / contract).read_text())
