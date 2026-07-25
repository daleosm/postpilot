from app.permissions import LEGACY_PERMISSION_MAP, PERMISSIONS, normalize_permission, policy_grants


def test_client_permission_is_fixed_to_sign_off_work() -> None:
    assert policy_grants("sign_off_work", "client", [])
    assert not policy_grants("manage_production", "client", ["manage_production"])


def test_configurable_roles_use_capabilities_not_role_names() -> None:
    assert policy_grants("manage_production", "custom_role", ["manage_production"])
    assert policy_grants("manage_shows", "custom_role", ["manage_production"])
    assert not policy_grants("manage_commercial", "custom_role", ["manage_production"])


def test_every_current_capability_is_accepted_without_remapping() -> None:
    assert all(normalize_permission(permission) == permission for permission in PERMISSIONS)


def test_each_capability_grants_only_itself() -> None:
    for granted in PERMISSIONS:
        for requested in PERMISSIONS:
            assert policy_grants(requested, "member", [granted]) is (requested == granted)


def test_legacy_permissions_normalise_to_grouped_capabilities() -> None:
    assert {
        key: normalize_permission(key)
        for key in (
            "manage_shows",
            "update_assigned_work",
            "sign_off_workflow_stages",
            "verify_qc",
            "manage_budget",
            "manage_catering",
        )
    } == {
        "manage_shows": "manage_production",
        "update_assigned_work": "do_assigned_work",
        "sign_off_workflow_stages": "sign_off_work",
        "verify_qc": "manage_qc_delivery",
        "manage_budget": "manage_commercial",
        "manage_catering": "manage_catering",
    }
    assert LEGACY_PERMISSION_MAP["manage_shows"] == "manage_production"


def test_unknown_and_duplicate_permissions_are_safe() -> None:
    values = [
        normalize_permission(item)
        for item in ["manage_shows", "manage_production", "unknown_permission", "manage_production"]
    ]
    assert list(dict.fromkeys(value for value in values if value)) == ["manage_production"]
    assert normalize_permission("unknown_permission") is None


def test_client_policy_is_fixed_and_internal_policy_remains_capability_based() -> None:
    assert policy_grants("sign_off_workflow_stages", "client", ["manage_production", "manage_commercial"])
    assert not policy_grants("manage_shows", "client", ["manage_production"])
    assert policy_grants("manage_shows", "member", ["manage_production"])
    assert not policy_grants("manage_budget", "member", ["manage_production"])
