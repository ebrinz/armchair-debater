from pathlib import Path

import pytest
import yaml

import knowledge
from knowledge import CardError


def card(**overrides):
    base = {
        "id": "alpha",
        "name": "Alpha Theory",
        "aliases": ["alpha"],
        "kuhn_category": "Materialism > Test",
        "claim": "Consciousness is alpha.",
        "arguments": ["a1", "a2", "a3"],
        "objections": ["o1", "o2", "o3"],
        "rivals": ["beta"],
        "citations": ["Author 2000, Journal, Title", "Author 2001, Journal, Title"],
    }
    base.update(overrides)
    return base


def beta(**overrides):
    defaults = {"id": "beta", "name": "Beta Theory", "aliases": ["beta"], "rivals": ["alpha"]}
    defaults.update(overrides)
    return card(**defaults)


def write(tmp_path: Path, cards) -> Path:
    path = tmp_path / "theories.yaml"
    path.write_text(yaml.safe_dump(cards), encoding="utf-8")
    return path


def test_loads_valid_cards(tmp_path):
    theories = knowledge.load(write(tmp_path, [card(), beta()]))
    assert set(theories) == {"alpha", "beta"}
    assert theories["alpha"].rivals == ("beta",)


def test_rejects_missing_field(tmp_path):
    bad = card()
    del bad["claim"]
    with pytest.raises(CardError, match="alpha.*claim"):
        knowledge.load(write(tmp_path, [bad, beta()]))


@pytest.mark.parametrize("field", ["arguments", "objections"])
def test_rejects_wrong_argument_count(tmp_path, field):
    with pytest.raises(CardError, match=field):
        knowledge.load(write(tmp_path, [card(**{field: ["only one"]}), beta()]))


@pytest.mark.parametrize("citations", [["one"], ["1", "2", "3", "4", "5"]])
def test_rejects_citation_count_outside_two_to_four(tmp_path, citations):
    with pytest.raises(CardError, match="citations"):
        knowledge.load(write(tmp_path, [card(citations=citations), beta()]))


def test_rejects_unresolved_rival(tmp_path):
    with pytest.raises(CardError, match="gamma"):
        knowledge.load(write(tmp_path, [card(rivals=["gamma"]), beta()]))


def test_rejects_self_rival(tmp_path):
    with pytest.raises(CardError, match="itself"):
        knowledge.load(write(tmp_path, [card(rivals=["alpha"]), beta()]))


def test_rejects_duplicate_id(tmp_path):
    with pytest.raises(CardError, match="duplicate"):
        knowledge.load(write(tmp_path, [card(), card(), beta()]))


def test_rejects_alias_shared_by_two_cards(tmp_path):
    with pytest.raises(CardError, match="shared"):
        knowledge.load(write(tmp_path, [card(aliases=["same"]), beta(aliases=["same"])]))


def test_real_cards_load_and_lookup_is_case_insensitive():
    assert knowledge.get("GWT").id == "gwt"
    assert knowledge.get("global workspace theory").id == "gwt"
    assert knowledge.get("phi").id == "iit"
    assert knowledge.get("no such theory") is None


def test_index_lists_every_card_with_rivals():
    lines = knowledge.index().splitlines()
    assert len(lines) == len(knowledge.ids())
    assert any(line.startswith("gwt: Global Workspace Theory (rivals: ") for line in lines)


def test_brief_contains_claim_arguments_objections_citations():
    theory = knowledge.get("iit")
    text = knowledge.brief(theory)
    assert theory.claim in text
    for item in (*theory.arguments, *theory.objections, *theory.citations):
        assert item in text
