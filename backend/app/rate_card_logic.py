"""Deterministic inheritance rules for tenant rate cards."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

RATE_CARD_PRECEDENCE = (
    "episode_rate_card",
    "show_rate_card",
    "network_rate_card",
    "client_rate_card",
    "master_rate_card",
)


@dataclass(frozen=True)
class RateCandidate:
    source: str
    rate: Decimal
    currency: str
    card_id: str | None
    item_id: str | None


def choose_effective_rate(candidates: Iterable[RateCandidate]) -> RateCandidate | None:
    """Pick the first defined rate by documented scope precedence.

    A rate at a narrower level is a manual override, not an amount added to
    its parent.  Unknown sources are ignored rather than accidentally taking
    precedence when schema data is extended later.
    """
    grouped: dict[str, list[RateCandidate]] = {source: [] for source in RATE_CARD_PRECEDENCE}
    for candidate in candidates:
        if candidate.source in grouped:
            grouped[candidate.source].append(candidate)
    for source in RATE_CARD_PRECEDENCE:
        if grouped[source]:
            return grouped[source][0]
    return None
