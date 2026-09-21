"""The flow's shape, pinned: the round order, and that every node the scorer
knows about exists (and the other way round)."""

from pipecat.flows import Flow, FlowConfig

import handlers
import scorer
from debate_state import STAGES

CONFIG = FlowConfig.from_file("flow.yaml")


def targets(node) -> dict[str, str]:
    """Where a node can lead, as {label: node name}: a plain transition is
    labelled by its function, a branch table by each of its cases."""
    out = {}
    for function in node.functions or []:
        target = function.transition_to
        if isinstance(target, str):
            out[function.name] = target
        elif target is not None:
            out.update(target.cases)
    return out


def walk(start: str) -> list[str]:
    """Node names from `start`, always taking the first way forward not yet visited."""
    order, name = [], start
    while name and name not in order:
        order.append(name)
        # The way back to the front door is every mode's exit, not part of its path.
        forward = [
            t
            for t in targets(CONFIG.nodes[name]).values()
            if t not in order and t != CONFIG.initial_node
        ]
        name = forward[0] if forward else None
    return order


def test_the_flow_constructs_with_every_handler_and_variable_it_names():
    Flow(CONFIG, handlers=handlers)


def test_a_debate_runs_setup_three_rounds_a_two_part_cross_examination_and_a_verdict():
    assert CONFIG.initial_node == "mode_select"
    assert targets(CONFIG.nodes["mode_select"]) == {
        "debate": "setup",
        "sparring": "spar_setup",
        "explore": "explore",
    }
    assert walk("setup") == [
        "setup",
        "opening",
        "rebuttal",
        "crossexam_question",
        "crossexam_answer",
        "closing",
        "verdict",
    ]


def test_every_stage_a_node_emits_is_one_the_client_knows():
    for name, node in CONFIG.nodes.items():
        for action in node.model_dump().get("pre_actions") or []:
            if action.get("type") == "emit_stage":
                assert action["stage"] in STAGES, name


def test_both_cross_examination_nodes_show_the_client_one_stage():
    stages = {
        name: [
            a["stage"]
            for a in (node.model_dump().get("pre_actions") or [])
            if a.get("type") == "emit_stage"
        ]
        for name, node in CONFIG.nodes.items()
    }
    assert stages["crossexam_question"] == ["crossexam"]
    # Same stage, so nothing to announce twice.
    assert stages["crossexam_answer"] == []


def test_sparring_is_a_setup_one_node_of_questions_and_a_finding():
    assert walk("spar_setup") == ["spar_setup", "sparring", "spar_verdict"]
    # The questions node leads back to itself until the fifth answer.
    assert targets(CONFIG.nodes["sparring"]) == {"more": "sparring", "done": "spar_verdict"}


def test_the_explorer_is_one_node_with_a_tool_that_stays_in_it():
    show = next(f for f in CONFIG.nodes["explore"].functions if f.name == "show_theory")
    assert show.transition_to is None
    assert walk("explore") == ["explore"]


def test_every_mode_has_a_way_back_to_the_front_door():
    for last in ("verdict", "spar_verdict", "explore"):
        assert "mode_select" in targets(CONFIG.nodes[last]).values(), last


def test_the_scorer_hears_every_debate_node_and_only_those():
    debate_nodes = {"opening", "rebuttal", "crossexam_question", "crossexam_answer", "closing"}
    assert debate_nodes <= set(CONFIG.nodes)
    assert set(scorer.HEARD_NODES) == debate_nodes | {scorer.SPARRING_NODE}
    assert set(scorer.UNSCORED_NODES) == {"crossexam_question"}
    assert set(scorer.UNSCORED_NODES) <= set(scorer.HEARD_NODES)
