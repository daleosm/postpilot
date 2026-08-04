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


def test_named_artist_rate_requires_one_person_and_its_own_service_identity() -> None:
    artist = RateCardOverrideRequest(
        scope="master",
        target_type="person",
        person_id="person-1",
        category="Colourist",
        unit="hour",
        rate=175,
        internal_cost_rate=90,
    )
    assert artist.target_type == "person"
    assert artist.person_id == "person-1"

    with pytest.raises(ValidationError, match="named artist rate"):
        RateCardOverrideRequest(
            scope="master",
            target_type="person",
            category="Colourist",
            unit="hour",
            rate=175,
        )
    with pytest.raises(ValidationError, match="named artist rate"):
        RateCardOverrideRequest(
            scope="master",
            target_type="person",
            person_id="person-1",
            service_rate_id="service-1",
            category="Colourist",
            unit="hour",
            rate=175,
        )
