"""The flow's shape, pinned: the round order, and that every node the scorer
knows about exists (and the other way round)."""

from pipecat.flows import Flow, FlowConfig

import handlers
import scorer
from debate_state import STAGES

CONFIG = FlowConfig.from_file("flow.yaml")


def walk() -> list[str]:
    """Node names in the order a debate visits them, following the first plain transition."""
    order, name = [], CONFIG.initial_node
    while name and name not in order:
        order.append(name)
        node = CONFIG.nodes[name]
        targets = []
        for function in node.functions or []:
            target = function.transition_to
            if isinstance(target, str):
                targets.append(target)
            elif target is not None:  # a branch table: take its first case
                targets.append(next(iter(target.cases.values())))
        forward = [t for t in targets if t not in order]
        name = forward[0] if forward else None
    return order


def test_the_flow_constructs_with_every_handler_and_variable_it_names():
    Flow(CONFIG, handlers=handlers)


def test_a_debate_runs_setup_three_rounds_a_two_part_cross_examination_and_a_verdict():
    assert walk() == [
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


def test_the_scorer_hears_every_debate_node_and_only_those():
    debate_nodes = set(CONFIG.nodes) - {"setup", "verdict"}
    assert set(scorer.HEARD_NODES) == debate_nodes
    assert set(scorer.UNSCORED_NODES) == {"crossexam_question"}
    assert set(scorer.UNSCORED_NODES) <= set(scorer.HEARD_NODES)
