from decimal import Decimal

from app.rate_card_logic import RateCandidate, choose_effective_rate


def _candidate(source: str, amount: str) -> RateCandidate:
    return RateCandidate(
        source=source,
        rate=Decimal(amount),
        currency="GBP",
        card_id=f"{source}-card",
        item_id=f"{source}-item",
    )


def test_rate_card_inheritance_is_deterministic_and_uses_the_narrowest_override() -> None:
    selected = choose_effective_rate(
        [
            _candidate("master_rate_card", "100"),
            _candidate("client_rate_card", "110"),
            _candidate("network_rate_card", "120"),
            _candidate("show_rate_card", "130"),
            _candidate("episode_rate_card", "140"),
        ]
    )

    assert selected == _candidate("episode_rate_card", "140")


def test_network_precedes_client_and_missing_overrides_fall_through() -> None:
    assert choose_effective_rate(
        [
            _candidate("master_rate_card", "100"),
            _candidate("client_rate_card", "110"),
            _candidate("network_rate_card", "120"),
        ]
    ) == _candidate("network_rate_card", "120")
    assert choose_effective_rate([_candidate("master_rate_card", "100")]) == _candidate("master_rate_card", "100")
    assert choose_effective_rate([]) is None
