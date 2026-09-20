import json
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
        "moves": ["Move One", "Move Two", "Move Three"],
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


def test_rejects_missing_moves(tmp_path):
    bad = card()
    del bad["moves"]
    with pytest.raises(CardError, match="moves"):
        knowledge.load(write(tmp_path, [bad, beta()]))


def test_rejects_wrong_moves_count(tmp_path):
    with pytest.raises(CardError, match="moves"):
        knowledge.load(write(tmp_path, [card(moves=["Only One"]), beta()]))


def test_rejects_over_long_move_name(tmp_path):
    with pytest.raises(CardError, match="moves"):
        knowledge.load(
            write(
                tmp_path,
                [card(moves=["A" * 23, "Move Two", "Move Three"]), beta()],
            )
        )


def test_rejects_four_word_move_name(tmp_path):
    with pytest.raises(CardError, match="moves"):
        knowledge.load(
            write(
                tmp_path,
                [card(moves=["One Two Three Four", "Move Two", "Move Three"]), beta()],
            )
        )


def test_move_names_are_stripped_of_surrounding_whitespace(tmp_path):
    theories = knowledge.load(
        write(tmp_path, [card(moves=[" Move One ", "Move Two", "Move Three"]), beta()])
    )
    assert theories["alpha"].moves[0] == "Move One"


def test_move_length_cap_is_measured_after_stripping(tmp_path):
    just_fits = " " + "A" * 22 + " "
    knowledge.load(write(tmp_path, [card(moves=[just_fits, "Move Two", "Move Three"]), beta()]))

    too_long = " " + "A" * 23 + " "
    with pytest.raises(CardError, match="moves"):
        knowledge.load(write(tmp_path, [card(moves=[too_long, "Move Two", "Move Three"]), beta()]))


CARDS_FIXTURE = json.loads(
    (Path(__file__).parents[2] / "docs/design/theory-cards-fixture.json").read_text()
)


def test_client_cards_match_the_contract_fixture_shape():
    cards = knowledge.client_cards()
    assert [c["id"] for c in cards] == knowledge.ids()
    expected_keys = set(CARDS_FIXTURE["cards"][0])
    for card in cards:
        assert set(card) == expected_keys
        assert isinstance(card["arguments"], list) and len(card["arguments"]) == 3
        assert isinstance(card["moves"], list) and len(card["moves"]) == 3
        assert isinstance(card["rivals"], list) and card["rivals"]


def test_client_cards_never_leak_objections_or_citations():
    for card in knowledge.client_cards():
        assert "objections" not in card and "citations" not in card


def test_client_cards_are_json_serialisable_and_claims_are_single_line():
    cards = knowledge.client_cards()
    json.dumps(cards)
    assert all("\n" not in card["claim"] for card in cards)


EXPECTED_CLIENT_CARD_KEYS = {"id", "name", "kuhn_category", "claim", "moves", "arguments", "rivals"}


def test_client_cards_and_fixture_pin_the_seven_key_contract():
    for card in knowledge.client_cards():
        assert set(card) == EXPECTED_CLIENT_CARD_KEYS
    for card in CARDS_FIXTURE["cards"]:
        assert set(card) == EXPECTED_CLIENT_CARD_KEYS
