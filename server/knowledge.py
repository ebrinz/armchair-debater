"""Theory cards: load, validate, and look up.

The cards in cards/theories.yaml are the bot's only source for claims and
citations. Loading validates every card, and the module loads at import, so a
bad card stops the bot at boot rather than mid-debate.
"""

from dataclasses import dataclass
from pathlib import Path

import yaml

CARDS_PATH = Path(__file__).parent / "cards" / "theories.yaml"

_TEXT_FIELDS = ("id", "name", "kuhn_category", "claim")
_LIST_FIELDS = ("aliases", "moves", "arguments", "objections", "rivals", "citations")


class CardError(ValueError):
    """A theory card breaks the schema."""


@dataclass(frozen=True)
class Term:
    term: str
    means: str


@dataclass(frozen=True)
class Check:
    question: str
    looks_for: str


@dataclass(frozen=True)
class Lesson:
    in_plain_words: str
    terms: tuple[Term, ...]
    example: str
    misreading: str
    checks: tuple[Check, ...]


@dataclass(frozen=True)
class Theory:
    id: str
    name: str
    aliases: tuple[str, ...]
    kuhn_category: str
    claim: str
    moves: tuple[str, ...]
    arguments: tuple[str, ...]
    objections: tuple[str, ...]
    rivals: tuple[str, ...]
    citations: tuple[str, ...]
    lesson: Lesson


_LESSON_TEXT_FIELDS = ("in_plain_words", "example", "misreading")


def _pairs(label: str, items, kind: str, keys: tuple[str, str]) -> list[tuple[str, str]]:
    out = []
    for item in items:
        if not isinstance(item, dict) or not all(
            isinstance(item.get(k), str) and item[k].strip() for k in keys
        ):
            raise CardError(
                f"card {label}: each lesson {kind} needs a non-empty '{keys[0]}' and '{keys[1]}'"
            )
        out.append((item[keys[0]].strip(), item[keys[1]].strip()))
    return out


def _parse_lesson(label: str, raw) -> Lesson:
    if not isinstance(raw, dict):
        raise CardError(f"card {label}: 'lesson' must be a mapping")
    for field in _LESSON_TEXT_FIELDS:
        if not isinstance(raw.get(field), str) or not raw[field].strip():
            raise CardError(f"card {label}: lesson '{field}' must be a non-empty string")
    terms = raw.get("terms")
    if not isinstance(terms, list) or not 3 <= len(terms) <= 4:
        raise CardError(f"card {label}: lesson 'terms' must have three or four entries")
    checks = raw.get("checks")
    if not isinstance(checks, list) or len(checks) != 2:
        raise CardError(f"card {label}: lesson 'checks' must have exactly two entries")
    return Lesson(
        in_plain_words=raw["in_plain_words"].strip(),
        terms=tuple(Term(*t) for t in _pairs(label, terms, "term", ("term", "means"))),
        example=raw["example"].strip(),
        misreading=raw["misreading"].strip(),
        checks=tuple(
            Check(*c) for c in _pairs(label, checks, "check", ("question", "looks_for"))
        ),
    )


def _parse(raw: dict) -> Theory:
    label = raw.get("id", "<no id>") if isinstance(raw, dict) else "<not a mapping>"
    if not isinstance(raw, dict):
        raise CardError(f"card {label}: must be a mapping")
    for field in _TEXT_FIELDS:
        if not isinstance(raw.get(field), str) or not raw[field].strip():
            raise CardError(f"card {label}: '{field}' must be a non-empty string")
    for field in _LIST_FIELDS:
        value = raw.get(field)
        if not isinstance(value, list) or not value or not all(isinstance(v, str) for v in value):
            raise CardError(f"card {label}: '{field}' must be a non-empty list of strings")
    for field in ("arguments", "objections"):
        if len(raw[field]) != 3:
            raise CardError(f"card {label}: '{field}' must have exactly three entries")
    if not 2 <= len(raw["citations"]) <= 4:
        raise CardError(f"card {label}: 'citations' must have two to four entries")
    moves = [m.strip() for m in raw["moves"]]
    if len(moves) != 3 or not all(moves):
        raise CardError(f"card {label}: 'moves' must be exactly three non-empty strings")
    for move in moves:
        if len(move) > 22 or len(move.split()) > 3:
            raise CardError(
                f"card {label}: 'moves' entry {move!r} must be at most "
                "three words and 22 characters"
            )
    return Theory(
        **{f: raw[f].strip() for f in _TEXT_FIELDS},
        **{f: tuple(raw[f]) for f in _LIST_FIELDS if f != "moves"},
        moves=tuple(moves),
        lesson=_parse_lesson(label, raw.get("lesson")),
    )


def _build_lookup(theories: dict[str, Theory]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for theory in theories.values():
        for key in (theory.id, theory.name, *theory.aliases):
            key = key.lower()
            if lookup.get(key, theory.id) != theory.id:
                raise CardError(f"'{key}' is shared by cards {lookup[key]} and {theory.id}")
            lookup[key] = theory.id
    return lookup


def load(path: Path = CARDS_PATH) -> dict[str, Theory]:
    """Load and validate the cards at ``path``."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise CardError("theories.yaml must be a non-empty list of cards")
    theories: dict[str, Theory] = {}
    for entry in raw:
        theory = _parse(entry)
        if theory.id in theories:
            raise CardError(f"duplicate card id '{theory.id}'")
        theories[theory.id] = theory
    for theory in theories.values():
        for rival in theory.rivals:
            if rival == theory.id:
                raise CardError(f"card {theory.id}: lists itself as a rival")
            if rival not in theories:
                raise CardError(f"card {theory.id}: rival '{rival}' is not a card id")
    _build_lookup(theories)
    return theories


THEORIES = load()
_LOOKUP = _build_lookup(THEORIES)


def get(key: str) -> Theory | None:
    """Look a card up by id, name, or alias, ignoring case."""
    theory_id = _LOOKUP.get(key.strip().lower())
    return THEORIES[theory_id] if theory_id else None


def ids() -> list[str]:
    return list(THEORIES)


def index() -> str:
    """One line per card, for the setup prompt."""
    return "\n".join(f"{t.id}: {t.name} (rivals: {', '.join(t.rivals)})" for t in THEORIES.values())


def brief(theory: Theory) -> str:
    """A card as prompt text."""

    def bullets(items: tuple[str, ...]) -> str:
        return "\n".join(f"- {item}" for item in items)

    return (
        f"{theory.name} ({theory.kuhn_category})\n"
        f"Claim: {theory.claim}\n"
        f"Arguments for:\n{bullets(theory.arguments)}\n"
        f"Known objections:\n{bullets(theory.objections)}\n"
        f"Papers you may cite:\n{bullets(theory.citations)}"
    )


# The four steps of a lesson, in order. Steps one and two are the lesson's own
# material; three and four add the card's arguments and objections to it.
LESSON_STEPS = ("The idea", "The terms", "The case for it", "What it's up against")
# The check: "in your own words", then the card's two questions.
CHECKS = 3


def _bullets(items) -> str:
    return "\n".join(f"- {item}" for item in items)


def lesson_step(theory: Theory, step: int) -> str:
    """The material the tutor teaches in lesson step ``step`` (1 to 4), as prompt text."""
    lesson = theory.lesson
    if step == 1:
        return (
            f"The idea, in plain words: {lesson.in_plain_words}\n"
            f"The claim as the card states it: {theory.claim}"
        )
    if step == 2:
        return "The terms:\n" + "\n".join(f"- {t.term}: {t.means}" for t in lesson.terms)
    if step == 3:
        return (
            f"An example the theory handles well: {lesson.example}\n"
            f"The arguments for it:\n{_bullets(theory.arguments)}\n"
            f"Papers you may cite:\n{_bullets(theory.citations)}"
        )
    if step == 4:
        return (
            f"Known objections:\n{_bullets(theory.objections)}\n"
            f"A common misreading, and the correction: {lesson.misreading}"
        )
    raise ValueError(f"no lesson step {step}")


def check_questions(theory: Theory) -> list[tuple[str, str]]:
    """The exam: ``(question, rubric)`` for each of the three checks, in order."""
    lesson = theory.lesson
    own_words = (
        f"In your own words, how would you explain {theory.name} to a friend?",
        lesson.in_plain_words
        + " Key terms: "
        + "; ".join(f"{t.term} ({t.means})" for t in lesson.terms),
    )
    return [own_words, *((c.question, c.looks_for) for c in lesson.checks)]


def client_cards() -> list[dict]:
    """The cards as the client shows them on the select screen.

    Objections and citations stay on the server: the player should not see
    their opponent's weaknesses before the debate.
    """
    return [
        {
            "id": t.id,
            "name": t.name,
            "kuhn_category": t.kuhn_category,
            "claim": " ".join(t.claim.split()),
            "moves": list(t.moves),
            "arguments": list(t.arguments),
            "rivals": list(t.rivals),
        }
        for t in THEORIES.values()
    ]
