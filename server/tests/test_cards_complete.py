import knowledge

EXPECTED_IDS = {
    "gwt",
    "iit",
    "hot",
    "rpt",
    "predictive_processing",
    "ast",
    "illusionism",
    "biological_naturalism",
    "orch_or",
    "panpsychism",
    "property_dualism",
    "analytic_idealism",
}


def test_all_twelve_cards_are_present():
    assert set(knowledge.ids()) == EXPECTED_IDS


def test_every_card_has_at_least_two_rivals():
    for theory in knowledge.THEORIES.values():
        assert len(theory.rivals) >= 2, theory.id


def test_rivalry_is_mutual_somewhere():
    """Every card is some other card's rival, so any theory can be opposed and oppose."""
    named = {rival for theory in knowledge.THEORIES.values() for rival in theory.rivals}
    assert named == EXPECTED_IDS


def test_text_is_speakable():
    for theory in knowledge.THEORIES.values():
        for text in (theory.claim, *theory.arguments, *theory.objections):
            assert not any(ch in text for ch in "*#_`[];"), (theory.id, text)
            assert len(text.split()) <= 45, (theory.id, text)


def test_all_thirty_six_move_names_are_distinct():
    moves = [move for theory in knowledge.THEORIES.values() for move in theory.moves]
    assert len(moves) == 36
    assert len(set(moves)) == 36
