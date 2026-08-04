"""Flag historical confirmed bookings without trustworthy commercial snapshots.

Revision ID: 20260804_22
Revises: 20260804_21
Create Date: 2026-08-04

The migration intentionally does not look up a current rate card, room rate,
or person profile. Those values are mutable and would be a guess about a past
client agreement. Existing booking actual timestamps and invoice rows are left
untouched.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260804_22"
down_revision: str | Sequence[str] | None = "20260804_21"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("commercial_review_required", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("bookings", sa.Column("commercial_review_reason", sa.Text()))
    op.add_column("bookings", sa.Column("commercial_review_marked_at", sa.DateTime(timezone=True)))
    op.create_index(
        "bookings_organization_commercial_review_idx",
        "bookings",
        ["organization_id", "commercial_review_required"],
        postgresql_where=sa.text("commercial_review_required IS TRUE"),
    )

    # A fact is backfillable only if it is already explicit in the booking
    # component: matching resource, a saved non-negative rate, unit, currency,
    # resource label, and rate source.  Zero is allowed because an agreed
    # included/no-charge rate is a valid commercial fact.
    op.execute(
        """
        UPDATE bookings AS booking
        SET commercial_review_required = TRUE,
            commercial_review_reason = CASE
              WHEN booking.room_id IS NOT NULL
                   AND booking.person_id IS NOT NULL
                   AND (
                     NOT EXISTS (
                       SELECT 1 FROM booking_charge_components AS component
                       WHERE component.organization_id = booking.organization_id
                         AND component.booking_id = booking.id
                         AND component.component_type = 'room'
                         AND component.room_id = booking.room_id
                         AND component.client_rate >= 0
                         AND btrim(component.resource_name) <> ''
                         AND btrim(component.billing_unit) <> ''
                         AND btrim(component.currency) <> ''
                         AND btrim(component.rate_source) <> ''
                     )
                     OR NOT EXISTS (
                       SELECT 1 FROM booking_charge_components AS component
                       WHERE component.organization_id = booking.organization_id
                         AND component.booking_id = booking.id
                         AND component.component_type = 'person'
                         AND component.person_id = booking.person_id
                         AND component.client_rate >= 0
                         AND btrim(component.resource_name) <> ''
                         AND btrim(component.billing_unit) <> ''
                         AND btrim(component.currency) <> ''
                         AND btrim(component.rate_source) <> ''
                     )
                   ) THEN 'Historic booking is missing a valid room or artist rate snapshot.'
              WHEN booking.room_id IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM booking_charge_components AS component
                     WHERE component.organization_id = booking.organization_id
                       AND component.booking_id = booking.id
                       AND component.component_type = 'room'
                       AND component.room_id = booking.room_id
                       AND component.client_rate >= 0
                       AND btrim(component.resource_name) <> ''
                       AND btrim(component.billing_unit) <> ''
                       AND btrim(component.currency) <> ''
                       AND btrim(component.rate_source) <> ''
                   ) THEN 'Historic booking is missing a valid room rate snapshot.'
              ELSE 'Historic booking is missing a valid artist rate snapshot.'
            END,
            commercial_review_marked_at = now()
        WHERE booking.status = 'confirmed'
          AND booking.is_option IS FALSE
          AND (booking.room_id IS NOT NULL OR booking.person_id IS NOT NULL)
          AND (
            (booking.room_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM booking_charge_components AS component
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
            OR (booking.person_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM booking_charge_components AS component
              WHERE component.organization_id = booking.organization_id
                AND component.booking_id = booking.id
                AND component.component_type = 'person'
                AND component.person_id = booking.person_id
                AND component.client_rate >= 0
                AND btrim(component.resource_name) <> ''
                AND btrim(component.billing_unit) <> ''
                AND btrim(component.currency) <> ''
                AND btrim(component.rate_source) <> ''
            ))
          )
        """
    )


def downgrade() -> None:
    op.drop_index("bookings_organization_commercial_review_idx", table_name="bookings")
    op.drop_column("bookings", "commercial_review_marked_at")
    op.drop_column("bookings", "commercial_review_reason")
    op.drop_column("bookings", "commercial_review_required")
