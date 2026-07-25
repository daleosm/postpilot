from app.workflow_state import resolve_current_episode_workflow_state

STAGES = [
    {"id": "assembly", "name": "Assembly", "position": 1},
    {"id": "editorial", "name": "Editor's cut", "position": 2},
    {"id": "review", "name": "Client review", "position": 3},
]


def test_current_stage_and_lifecycle_are_the_only_live_state() -> None:
    state = resolve_current_episode_workflow_state(
        workflow_stage_id="editorial", workflow_status="in_progress", stages=STAGES
    )
    assert state == {
        "display_status": "in_progress",
        "label": "Editor's cut",
        "primary_stage_id": "editorial",
        "primary_stage_name": "Editor's cut",
    }


def test_awaiting_and_blocked_keep_the_same_current_stage() -> None:
    awaiting = resolve_current_episode_workflow_state(
        workflow_stage_id="review", workflow_status="awaiting_sign_off", stages=STAGES
    )
    blocked = resolve_current_episode_workflow_state(
        workflow_stage_id="review", workflow_status="blocked", stages=STAGES
    )
    assert awaiting["primary_stage_id"] == "review" and "Awaiting sign-off" in str(awaiting["label"])
    assert blocked["primary_stage_id"] == "review" and "Blocked" in str(blocked["label"])


def test_complete_is_explicit() -> None:
    state = resolve_current_episode_workflow_state(
        workflow_stage_id="review", workflow_status="complete", stages=STAGES
    )
    assert state["display_status"] == "complete" and state["primary_stage_name"] == "Client review"


def test_state_contract_has_no_graph_or_track_fields() -> None:
    state = resolve_current_episode_workflow_state(
        workflow_stage_id="assembly", workflow_status="not_started", stages=STAGES
    )
    assert sorted(state) == ["display_status", "label", "primary_stage_id", "primary_stage_name"]


def test_invalid_stage_pointer_cannot_invent_a_stage() -> None:
    state = resolve_current_episode_workflow_state(
        workflow_stage_id="foreign", workflow_status="in_progress", stages=STAGES
    )
    assert state["primary_stage_id"] is None and state["primary_stage_name"] is None and state["label"] == "Not started"
