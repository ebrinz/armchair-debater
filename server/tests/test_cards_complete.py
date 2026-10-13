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


LESSON_WORD_CAPS = {
    "in_plain_words": 90,
    "example": 130,
    "misreading": 90,
}


def test_lesson_text_is_speakable_and_short():
    for theory in knowledge.THEORIES.values():
        lesson = theory.lesson
        texts = {
            "in_plain_words": lesson.in_plain_words,
            "example": lesson.example,
            "misreading": lesson.misreading,
        }
        for field, text in texts.items():
            assert not any(ch in text for ch in "*#_`[];"), (theory.id, field)
            assert len(text.split()) <= LESSON_WORD_CAPS[field], (theory.id, field)
        for term in lesson.terms:
            assert not any(ch in term.means for ch in "*#_`[];"), (theory.id, term.term)
            assert len(term.means.split()) <= 45, (theory.id, term.term)
        for check in lesson.checks:
            assert check.question.rstrip().endswith("?"), (theory.id, check.question)
            assert len(check.question.split()) <= 45, (theory.id, check.question)
            assert len(check.looks_for.split()) <= 60, (theory.id, check.question)


def test_the_two_checks_on_a_card_are_different_questions():
    for theory in knowledge.THEORIES.values():
        first, second = theory.lesson.checks
        assert first.question != second.question, theory.id
