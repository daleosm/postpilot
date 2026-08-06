"""Clear historic-review flags only where an agreed component snapshot exists.

Revision ID: 20260806_37
Revises: 20260805_36
Create Date: 2026-08-06

The previous review migration correctly protected bookings without commercial
facts.  Some bookings already have complete immutable room/person components,
including an explicit commercial treatment, but predate the parent booking's
``commercial_treatment_snapshot_at`` marker.  Those records can be reconciled
without consulting a current rate card or inventing a price.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260806_37"
down_revision: str | Sequence[str] | None = "20260805_36"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE bookings AS booking
        SET commercial_treatment = snapshot.treatment,
            commercial_treatment_snapshot_at = COALESCE(
                snapshot.snapshot_at,
                booking.created_at,
                now()
            ),
            commercial_review_required = FALSE,
            commercial_review_reason = NULL,
            commercial_review_marked_at = NULL
        FROM (
            SELECT
                component.organization_id,
                component.booking_id,
                min(component.commercial_treatment) AS treatment,
                min(component.created_at) AS snapshot_at
            FROM booking_charge_components AS component
            GROUP BY component.organization_id, component.booking_id
        ) AS snapshot
        WHERE snapshot.organization_id = booking.organization_id
          AND snapshot.booking_id = booking.id
          AND booking.commercial_review_required IS TRUE
          AND booking.commercial_treatment_snapshot_at IS NULL
          AND booking.status = 'confirmed'
          AND booking.is_option IS FALSE
          AND snapshot.treatment IN ('wet_hire', 'dry_hire', 'flat_project_fee')
          AND NOT EXISTS (
              SELECT 1
              FROM booking_charge_components AS component
              WHERE component.organization_id = booking.organization_id
                AND component.booking_id = booking.id
                AND component.commercial_treatment <> snapshot.treatment
          )
          AND (booking.room_id IS NULL OR EXISTS (
              SELECT 1
              FROM booking_charge_components AS component
              WHERE component.organization_id = booking.organization_id
                AND component.booking_id = booking.id
                AND component.component_type = 'room'
                AND component.room_id = booking.room_id
                AND component.client_rate >= 0
                AND btrim(component.resource_name) <> ''
                AND btrim(component.billing_unit) <> ''
                AND btrim(component.currency) <> ''
                AND btrim(component.rate_source) <> ''
          ))
          AND (booking.person_id IS NULL OR EXISTS (
              SELECT 1
              FROM booking_charge_components AS component
              WHERE component.organization_id = booking.organization_id
                AND component.booking_id = booking.id
                AND component.component_type = 'person'
                AND component.person_id = booking.person_id
                AND component.client_rate >= 0
                AND btrim(component.resource_name) <> ''
                AND btrim(component.billing_unit) <> ''
                AND btrim(component.currency) <> ''
                AND btrim(component.rate_source) <> ''
          ));
        """
    )


def downgrade() -> None:
    # A successful reconciliation records a valid historical fact. It must
    # remain valid if this migration is later rolled back.
    pass
