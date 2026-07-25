import pytest
from pydantic import ValidationError

from app.api.schemas import RateCardOverrideRequest


def test_rate_card_override_schema_requires_one_valid_scope_target() -> None:
    with pytest.raises(ValidationError, match="master rate card"):
        RateCardOverrideRequest(
            scope="master",
            network="Example Network",
            category="Colourist",
            unit="day",
            rate=900,
        )
    with pytest.raises(ValidationError, match="matching target"):
        RateCardOverrideRequest(scope="show", category="Colourist", unit="day", rate=900)
    with pytest.raises(ValidationError, match="only one scope target"):
        RateCardOverrideRequest(
            scope="show",
            show_id="show-1",
            network="Example Network",
            category="Colourist",
            unit="day",
            rate=900,
        )


def test_rate_card_override_requires_service_identity_when_no_catalogue_rate_is_linked() -> None:
    with pytest.raises(ValidationError, match="Choose a service rate"):
        RateCardOverrideRequest(scope="master", rate=900)
