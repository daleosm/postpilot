from app.delivery_register_state import delivery_register_state, next_delivery_action


def manifest(**readiness):
    return {
        "items": [{"label": "ProRes master", "required": True, "status": "preparing"}],
        "readiness": {
            "client_network_accepted": False,
            "facility_dispatched": False,
            "deadline_risk": "on_track",
            "has_delivery_contact_gaps": False,
            **readiness,
        },
    }


def test_delivery_register_unconfigured_state() -> None:
    assert delivery_register_state(None) == "not_configured"
    assert next_delivery_action(None) == "Apply a delivery profile"


def test_delivery_register_prioritises_attention() -> None:
    assert delivery_register_state(manifest(has_delivery_contact_gaps=True)) == "needs_attention"
    assert next_delivery_action(manifest(has_delivery_contact_gaps=True)) == "Choose a delivery recipient"
    rejected = manifest()
    rejected["items"][0]["status"] = "rejected"
    assert delivery_register_state(rejected) == "needs_attention"
    assert next_delivery_action(rejected) == "Resolve ProRes master"
    assert delivery_register_state(manifest(deadline_risk="overdue")) == "needs_attention"


def test_delivery_register_distinguishes_dispatch_from_acceptance() -> None:
    dispatched = manifest(facility_dispatched=True)
    dispatched["items"][0] = {"label": "5.1 mix", "required": True, "status": "dispatched"}
    assert delivery_register_state(dispatched) == "dispatched"
    assert next_delivery_action(dispatched) == "Confirm receipt for 5.1 mix"
    accepted = manifest(facility_dispatched=True, client_network_accepted=True)
    accepted["items"][0] = {"label": "5.1 mix", "required": True, "status": "receipt_confirmed"}
    assert delivery_register_state(accepted) == "accepted"
    assert next_delivery_action(accepted) == "Delivery complete"
