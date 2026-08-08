"""Idempotent, Python-owned demo fixtures for a local PostPilot workspace.

The fixtures deliberately rebuild only the five documented demo organisations.
They are useful for local development, CI browser journeys, and the optional
Kubernetes demo job; real tenant records are never touched.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, insert, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import tables as t
from app.db.session import get_engine
from app.security import hash_node_scrypt_password

TENANT_IDS = tuple(f"10000000-0000-4000-8000-{index:012d}" for index in range(1, 6))
DEMO_BOOKINGS_PER_TENANT = 12
DEMO_WORK_ORDERS_PER_TENANT = 8
DEMO_MANIFESTS_PER_TENANT = 6

STAGES = (
    ("Post setup and delivery specifications", "post_setup_delivery_specifications", "#71869a", "post_supervisor"),
    (
        "Ingest, verification and editorial preparation",
        "ingest_verification_editorial_preparation",
        "#5f7ee6",
        "assistant_editor",
    ),
    ("Assembly cut", "assembly_cut", "#7b8eb3", "editor"),
    ("Editor’s cut", "editor_cut", "#5f7ee6", "editor"),
    ("Director’s cut / review", "director_review", "#9b70e5", "client"),
    ("Producer review", "producer_review", "#a7785d", "producer"),
    ("Studio, network or client review", "studio_network_client_review", "#9c6fb9", "client"),
    ("Legal, compliance and clearances", "legal_compliance_clearances", "#977a67", "producer"),
    ("Fine cut and final creative approval", "fine_cut_final_creative_approval", "#c58a52", "producer"),
    ("Picture lock", "picture_lock", "#d99a45", "producer"),
    ("Department turnovers", "department_turnovers", "#8a8173", "post_supervisor"),
    ("VFX, graphics and titles", "vfx_graphics_titles", "#af7195", "vfx_supervisor"),
    ("Online conform", "online_conform", "#658da4", "online_editor"),
    ("Colour grade", "colour_grade", "#4d9687", "colorist"),
    ("Sound editorial, ADR, Foley and music", "sound_editorial_adr_foley_music", "#56889a", "supervising_sound_editor"),
    ("Final mix", "final_mix", "#4d7b8d", "rerecording_mixer"),
    ("Captions, localisation and accessibility", "captions_localisation_accessibility", "#7c8c78", "post_supervisor"),
    ("Mastering and versioning", "mastering_versioning", "#647c70", "post_supervisor"),
    ("Quality control", "quality_control", "#b56d54", "qc"),
    ("Delivery", "delivery", "#607b70", "post_supervisor"),
    ("Client or network acceptance", "client_network_acceptance", "#8c719d", "client"),
    ("Archive and closeout", "archive_closeout", "#6d7671", "post_supervisor"),
)

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "post_supervisor": [
        "manage_production",
        "manage_settings",
        "manage_qc_delivery",
        "manage_commercial",
        "manage_catering",
        "do_assigned_work",
        "sign_off_work",
    ],
    "producer": ["manage_production", "manage_qc_delivery", "manage_commercial", "do_assigned_work", "sign_off_work"],
    "finance": ["manage_commercial", "do_assigned_work"],
    "runner": ["manage_catering", "do_assigned_work"],
    "qc": ["manage_qc_delivery", "do_assigned_work", "sign_off_work"],
    "editor": ["do_assigned_work", "sign_off_work"],
    "assistant_editor": ["do_assigned_work", "sign_off_work"],
    "online_editor": ["do_assigned_work", "sign_off_work"],
    "colorist": ["do_assigned_work", "sign_off_work"],
    "sound_mixer": ["do_assigned_work", "sign_off_work"],
    "supervising_sound_editor": ["do_assigned_work", "sign_off_work"],
    "rerecording_mixer": ["do_assigned_work", "sign_off_work"],
    "vfx_coordinator": ["do_assigned_work", "sign_off_work"],
    "vfx_supervisor": ["do_assigned_work", "sign_off_work"],
}

# Catering requests are normally available to the internal post team, but are
# deliberately a separate tenant capability so a facility can remove it from
# any role without also removing that role's production work access.
for _permissions in ROLE_PERMISSIONS.values():
    _permissions.append("request_catering")

# Demo master rates deliberately attach to configurable operational role keys,
# rather than every individual person.  Named artist rows remain a commercial
# exception added through the UI.  Values are USD reference hourly charges;
# each demo post house applies its existing currency multiplier below.
DEMO_ARTIST_HOURLY_RATES = {
    "assistant_editor": Decimal("95"),
    "editor": Decimal("150"),
    "colorist": Decimal("175"),
    "online_editor": Decimal("160"),
    "post_supervisor": Decimal("145"),
    "producer": Decimal("135"),
    "sound_mixer": Decimal("145"),
    "supervising_sound_editor": Decimal("165"),
    "rerecording_mixer": Decimal("185"),
    "vfx_supervisor": Decimal("175"),
    "vfx_coordinator": Decimal("110"),
    "qc": Decimal("90"),
}

# Room rows target the actual Settings → Rooms record, never a free-text room
# type. They therefore resolve directly for scheduling and invoice snapshots.
DEMO_ROOM_HOURLY_RATES = {
    "edit_bay": ("Edit suite", Decimal("110")),
    "color_suite": ("Colour suite", Decimal("190")),
    "mix_room": ("Mix stage", Decimal("200")),
    "qc_room": ("QC suite", Decimal("100")),
}

# These people fill the specialist sign-off roles that each tenant's core
# roster does not explicitly list.  Keep their display names human and short:
# the debug switcher is a useful test tool, not a place to repeat a post-house
# name in every user label.
SUPPLEMENTAL_PEOPLE = (
    {
        "online_editor": "Robin Hale",
        "vfx_supervisor": "Cameron Yu",
        "supervising_sound_editor": "Drew Ellis",
        "rerecording_mixer": "Toby King",
    },
    {
        "online_editor": "Parker Shaw",
        "vfx_supervisor": "Jordan Wells",
        "supervising_sound_editor": "Sasha Reid",
        "rerecording_mixer": "Morgan Price",
    },
    {
        "online_editor": "Emery Nash",
        "vfx_supervisor": "Rowan Blake",
        "supervising_sound_editor": "Quinn Frost",
        "rerecording_mixer": "Riley Moss",
    },
    {
        "online_editor": "Hayden Brooks",
        "vfx_supervisor": "Ari Sutton",
        "supervising_sound_editor": "Taylor Finch",
        "rerecording_mixer": "Jamie Cole",
    },
    {
        "online_editor": "Skyler Dean",
        "vfx_supervisor": "Frankie Lowe",
        "supervising_sound_editor": "Alexis Hart",
        "rerecording_mixer": "Casey North",
    },
)


def nullable_rows(rows: list[dict]) -> list[dict]:
    """Give each bulk-insert row the same optional columns.

    SQLAlchemy compiles a list passed to ``Insert.values`` as one multi-row
    statement. Optional fixture fields must therefore be present on every row,
    even when their intended value is NULL.
    """

    columns = {column for row in rows for column in row}
    return [{column: row.get(column) for column in columns} for row in rows]


TENANTS = (
    {
        "name": "Northstar Post",
        "slug": "northstar-post",
        "currency": "USD",
        "multiplier": Decimal("1.00"),
        "network": "Northstar Network",
        "shows": (
            (
                "Signal North",
                "SN",
                "Vantage Television",
                ("The Quiet Hour", "Second Skin", "Tin Roof", "Borrowed Light"),
            ),
            ("Blackwater", "BW", "Hollow Tree", ("Wake", "The Rook", "The Still", "Good Soil")),
            ("The Long View", "LV", "Beacon Drama", ("North Window", "Dead Signal", "Low Cloud", "Last Light")),
        ),
        "rooms": ("Avid Bay 01", "Avid Bay 02", "Luma Grade", "Stage North", "Technical QC 1"),
        "people": (
            ("Maya Ortiz", "maya@postpilot.debug", "post_supervisor", "user_maya", "admin"),
            ("Nadia Kane", "nadia@northstar-post.test", "producer", "user_nadia", "member"),
            ("James Liu", "james@northstar-post.test", "editor", "user_james", "member"),
            ("Leah Morgan", "leah@northstar-post.test", "assistant_editor", "user_leah", "member"),
            ("Avery Stone", "avery@northstar-post.test", "colorist", None, "member"),
            ("Noah Chen", "noah@northstar-post.test", "sound_mixer", "user_noah", "member"),
            ("Ruth Okafor", "ruth@northstar-post.test", "qc", "user_ruth", "member"),
            ("Vik Grant", "vik@northstar-post.test", "vfx_coordinator", None, "member"),
            ("Mara Voss", "mara@northstar-post.test", "client", "user_mara", "client"),
            ("Iman Patel", "iman@northstar-post.test", "finance", "user_iman", "member"),
            ("Jules Reed", "jules@northstar-post.test", "runner", None, "member"),
        ),
    },
    {
        "name": "Riverside Post",
        "slug": "riverside-post",
        "currency": "GBP",
        "multiplier": Decimal("0.78"),
        "network": "StreamWave",
        "shows": (
            ("Harbour Line", "HL", "Tideway Studios", ("Low Water", "Pilot Light", "Channel Mark", "Winter Mooring")),
            ("The Reed House", "RH", "Saltbox Pictures", ("The Lease", "Paper Walls", "After Dinner", "The Key Safe")),
            ("North Quay", "NQ", "Ferryhouse Films", ("Tide Table", "Red Flag", "Crossing", "Breakwater")),
            ("Common Ground", "CG", "Eider Pictures", ("The Orchard", "Half Acre", "Boundary Line", "The Gate")),
            ("Hinterland Unit", "HU", "Skyline Workshop", ("Wayfinder", "Dry Dock", "The Beacon", "After Rain")),
        ),
        "rooms": ("Cutting Room Alder", "Cutting Room Birch", "Northlight Colour", "Dockside Mix", "Harbour QC"),
        "people": (
            ("Maya Ortiz", "maya@postpilot.debug", "post_supervisor", "user_maya", "admin"),
            ("Briony Vale", "briony@riverside-post.test", "producer", None, "member"),
            ("Tessa Ward", "tessa@riverside-post.test", "editor", None, "member"),
            ("Cal Porter", "cal@riverside-post.test", "assistant_editor", None, "member"),
            ("Oona Bell", "oona@riverside-post.test", "colorist", None, "member"),
            ("Eli Bennett", "eli@riverside-post.test", "sound_mixer", "user_eli", "member"),
            ("Harriet Cole", "harriet@riverside-post.test", "qc", None, "member"),
            ("Mina Saleh", "mina@riverside-post.test", "vfx_coordinator", None, "member"),
            ("Lloyd Finch", "lloyd@riverside-post.test", "client", None, "client"),
            ("Amal Webb", "amal@riverside-post.test", "finance", None, "member"),
            ("Sam Walker", "sam@riverside-post.test", "runner", "user_sam", "member"),
            ("Casey Reed", "casey@client.test", "client", "user_casey", "client"),
        ),
    },
    {
        "name": "Horizon Finish",
        "slug": "horizon-finish",
        "currency": "EUR",
        "multiplier": Decimal("0.92"),
        "network": "ArcTV",
        "shows": (
            ("Glass District", "GD", "Kestrel Drama", ("Refraction", "Blind Corner", "Clear View", "The Atrium")),
            ("Salt & Static", "SS", "Wavelength Films", ("Dead Air", "Crossfade", "Signal Loss", "Night Shift")),
        ),
        "rooms": ("Atlas Edit One", "Atlas Edit Two", "Prism Colour", "Atmos Theatre", "Horizon QC Lab"),
        "people": (
            ("Maya Ortiz", "maya@postpilot.debug", "post_supervisor", "user_maya", "admin"),
            ("Delia Grant", "delia@horizon-finish.test", "producer", None, "member"),
            ("Alex Grant", "alex@horizon-finish.test", "editor", "user_alex", "member"),
            ("Mori Vale", "mori@horizon-finish.test", "assistant_editor", None, "member"),
            ("Priya Shah", "priya@horizon-finish.test", "colorist", "user_priya", "member"),
            ("Soren Pike", "soren@horizon-finish.test", "sound_mixer", None, "member"),
            ("Yasmin Rowe", "yasmin@horizon-finish.test", "qc", None, "member"),
            ("Ivo March", "ivo@horizon-finish.test", "vfx_coordinator", None, "member"),
            ("Anika Ford", "anika@horizon-finish.test", "client", None, "client"),
            ("Rey Nash", "rey@horizon-finish.test", "finance", None, "member"),
            ("Kit Lo", "kit@horizon-finish.test", "runner", None, "member"),
        ),
    },
    {
        "name": "Lantern Post House",
        "slug": "lantern-post-house",
        "currency": "GBP",
        "multiplier": Decimal("0.88"),
        "network": "Meridian",
        "shows": (
            ("City of Ash", "CA", "Lantern Originals", ("Smoke Test", "First Siren", "Open Window", "Black Rain")),
            ("Parallel Lines", "PL", "Kite String", ("Platform 4", "Signal Box", "Last Train", "The Junction")),
            ("Wild Harbour", "WH", "West Coast Films", ("Grey Seal", "Low Bell", "Riptide", "Safe Water")),
            ("Old School", "OS", "Pencil Case", ("Roll Call", "The Assembly", "Lost Property", "After Hours")),
            ("The Empty Room", "ER", "Candlelight", ("Keyholder", "South Wall", "The Mirror", "No Exit")),
            ("Summer Street", "SU", "Rook & Rose", ("Heatwave", "Open Door", "The Shortcut", "Street Party")),
            ("Paper Trail", "PT", "Red Folder", ("Archive", "The Witness", "Carbon Copy", "Final Draft")),
        ),
        "rooms": ("Lantern Edit A", "Lantern Edit B", "Firelight Grade", "Candle Mix", "Lantern QC"),
        "people": (
            ("Maya Ortiz", "maya@postpilot.debug", "post_supervisor", "user_maya", "admin"),
            ("Omar Dale", "omar@lantern-post.test", "producer", "user_lantern_producer", "member"),
            ("Freya Moss", "freya@lantern-post.test", "editor", "user_lantern_editor", "member"),
            ("Theo Grant", "theo@lantern-post.test", "assistant_editor", None, "member"),
            ("Mina Cross", "mina@lantern-post.test", "colorist", None, "member"),
            ("Kieran Holt", "kieran@lantern-post.test", "sound_mixer", None, "member"),
            ("Suki Wells", "suki@lantern-post.test", "qc", None, "member"),
            ("Rae Nolan", "rae@lantern-post.test", "vfx_coordinator", None, "member"),
            ("Jo Bell", "jo@lantern-post.test", "client", None, "client"),
            ("Priya Dean", "priya.dean@lantern-post.test", "finance", "user_lantern_finance", "member"),
            ("Finn Cole", "finn@lantern-post.test", "runner", "user_lantern_runner", "member"),
            ("Meridian Review", "review@meridian.test", "client", "user_lantern_client", "client"),
        ),
    },
    {
        "name": "Copperline Editorial",
        "slug": "copperline-editorial",
        "currency": "USD",
        "multiplier": Decimal("1.18"),
        "network": "Slate+",
        "shows": (
            ("Crossing Point", "CP", "Copperline Pictures", ("Westbound", "The Toll", "Night Ferry", "Home Shore")),
            ("Northern Static", "NS", "Cold Frame", ("Relay", "The Mast", "White Noise", "Dead Air")),
            ("The Seawall", "SW", "Breakline Media", ("Foundation", "High Tide", "The Breach", "Rebuild")),
            ("Small Hours", "SH", "Hourglass", ("01:13", "03:40", "04:55", "Dawn")),
        ),
        "rooms": ("Copper Cut 1", "Copper Cut 2", "Verdigris Grade", "Foundry Mix", "Copper QC"),
        "people": (
            ("Maya Ortiz", "maya@postpilot.debug", "post_supervisor", "user_maya", "admin"),
            ("Lena Hart", "lena@copperline.test", "producer", "user_copper_producer", "member"),
            ("Mark Dyer", "mark@copperline.test", "editor", "user_copper_editor", "member"),
            ("Elle Fraser", "elle@copperline.test", "assistant_editor", None, "member"),
            ("Tariq Moon", "tariq@copperline.test", "colorist", None, "member"),
            ("Nell Sharp", "nell@copperline.test", "sound_mixer", None, "member"),
            ("Amir Gold", "amir@copperline.test", "qc", None, "member"),
            ("Veda Cole", "veda@copperline.test", "vfx_coordinator", None, "member"),
            ("Isa Rowe", "isa@copperline.test", "client", None, "client"),
            ("Peter Vale", "peter@copperline.test", "finance", "user_copper_finance", "member"),
            ("Nia Park", "nia@copperline.test", "runner", "user_copper_runner", "member"),
            ("Slate+ Review", "review@slateplus.test", "client", "user_copper_client", "client"),
        ),
    },
)


def uid(tenant: int, kind: str, value: int) -> str:
    return f"{f'{kind}{tenant}'.ljust(8, '0')}-0000-4000-8000-{value:012d}"


def now_at(days: int, hour: int = 12) -> datetime:
    moment = datetime.now(UTC).replace(hour=hour, minute=0, second=0, microsecond=0)
    return moment + timedelta(days=days)


def role_label(role: str) -> str:
    return role.replace("_", " ").title()


async def seed() -> None:
    password_hash = hash_node_scrypt_password("password")
    engine = get_engine()
    async with engine.begin() as connection:
        await connection.execute(delete(t.organizations).where(t.organizations.c.id.in_(TENANT_IDS)))
        # These accounts belong only to specialist local fixtures.  Remove
        # them alongside the demo tenants so ordinary demo seeds never leave
        # an authenticated account without a tenant membership behind.
        await connection.execute(delete(t.users).where(t.users.c.id.in_(("user_iris", "user_dast_active_scan"))))

        for number, tenant in enumerate(TENANTS, start=1):
            await _seed_tenant(connection, number, TENANT_IDS[number - 1], tenant, password_hash)

        await connection.execute(
            update(t.users).where(t.users.c.password_hash.is_(None)).values(password_hash=password_hash)
        )

    show_count = sum(len(tenant["shows"]) for tenant in TENANTS)
    episode_count = sum(len(show[3]) for tenant in TENANTS for show in tenant["shows"])
    print(
        f"Seeded {len(TENANTS)} isolated PostPilot post houses with {show_count} shows, {episode_count} episodes, "
        f"{len(TENANTS) * DEMO_BOOKINGS_PER_TENANT} bookings, "
        f"{len(TENANTS) * DEMO_WORK_ORDERS_PER_TENANT} work orders, and "
        f"{len(TENANTS) * DEMO_MANIFESTS_PER_TENANT} delivery manifests."
    )


async def _seed_tenant(connection, number: int, organization_id: str, tenant: dict, password_hash: str) -> None:  # noqa: C901, PLR0915
    currency = tenant["currency"]
    multiplier: Decimal = tenant["multiplier"]
    network = tenant["network"]
    slug = tenant["slug"]
    workflow_id = uid(number, "21", 1)

    def stage_id(position: int) -> str:
        return uid(number, "22", position)

    def rule_id(position: int) -> str:
        return uid(number, "23", position)

    def person_id(position: int) -> str:
        return uid(number, "24", position)

    def show_id(position: int) -> str:
        return uid(number, "25", position)

    def season_id(position: int) -> str:
        return uid(number, "26", position)

    def episode_id(position: int) -> str:
        return uid(number, "27", position)

    def room_id(position: int) -> str:
        return uid(number, "28", position)

    def booking_id(position: int) -> str:
        return uid(number, "29", position)

    def company_id(position: int) -> str:
        return uid(number, "42", position)

    def contact_id(position: int) -> str:
        return uid(number, "43", position)

    profile_id = uid(number, "4b", 1)

    people = list(tenant["people"])
    existing_roles = {person[2] for person in people}
    for role in ("online_editor", "vfx_supervisor", "supervising_sound_editor", "rerecording_mixer"):
        if role not in existing_roles:
            name = SUPPLEMENTAL_PEOPLE[number - 1][role]
            stable_user_id = f"user_{slug.replace('-', '_')}_{len(people) + 1}"
            people.append((name, f"{role}@{slug}.test", role, stable_user_id, "member"))
    users = []
    for index, (name, email, _role, user_id, _member_role) in enumerate(people, start=1):
        resolved_user_id = user_id or f"user_{slug.replace('-', '_')}_{index}"
        users.append({"id": resolved_user_id, "name": name, "email": email, "password_hash": password_hash})
    await connection.execute(
        pg_insert(t.users)
        .values(users)
        .on_conflict_do_update(
            index_elements=[t.users.c.id],
            set_={
                "name": pg_insert(t.users).excluded.name,
                "email": pg_insert(t.users).excluded.email,
                "password_hash": pg_insert(t.users).excluded.password_hash,
            },
        )
    )

    await connection.execute(
        insert(t.organizations).values(id=organization_id, name=tenant["name"], slug=slug, currency=currency)
    )
    await connection.execute(
        insert(t.invoice_settings).values(
            id=uid(number, "48", 99),
            organization_id=organization_id,
            legal_name=f"{tenant['name']} Limited",
            legal_address="18 Post House Lane, London, E1 6AB",
            billing_email=f"accounts@{slug}.test",
            tax_enabled=False,
            tax_name="VAT",
            tax_registration_number=f"GB {100000000 + number * 1010101}",
            tax_rate_percent=Decimal("20"),
            payment_terms_days=30,
            payment_instructions="Please pay by bank transfer, quoting the invoice number.",
        )
    )
    await connection.execute(
        insert(t.organization_members).values(
            [
                {"organization_id": organization_id, "user_id": user["id"], "role": people[index][4]}
                for index, user in enumerate(users)
            ]
        )
    )
    await connection.execute(
        insert(t.people).values(
            [
                {
                    "id": person_id(index + 1),
                    "organization_id": organization_id,
                    "user_id": user["id"],
                    "name": user["name"],
                    "email": user["email"],
                    "role": people[index][2],
                    "availability": "limited" if index % 5 == 0 else "available",
                    "is_freelancer": index >= len(tenant["people"]),
                    "hourly_rate": Decimal(65 + index * 8),
                    "day_rate": Decimal(520 + index * 55),
                }
                for index, user in enumerate(users)
            ]
        )
    )
    role_indices = {role: index + 1 for index, person in enumerate(people) for role in [person[2]]}
    await connection.execute(
        insert(t.organization_role_policies).values(
            [
                {
                    "id": uid(number, "20", index + 1),
                    "organization_id": organization_id,
                    "role": role,
                    "label": role_label(role),
                    "permissions": ROLE_PERMISSIONS.get(role, ["do_assigned_work"]),
                }
                for index, role in enumerate(sorted(set(role_indices) - {"client"}))
            ]
        )
    )

    await connection.execute(
        insert(t.post_workflows).values(
            id=workflow_id,
            organization_id=organization_id,
            name=f"{tenant['name']} delivery workflow",
            description="Editable TV post-production stage sequence.",
            is_default=True,
        )
    )
    await connection.execute(
        insert(t.workflow_stages).values(
            [
                {
                    "id": stage_id(index),
                    "organization_id": organization_id,
                    "workflow_id": workflow_id,
                    "name": name,
                    "key": key,
                    "position": index,
                    "color": color,
                    "is_terminal": key == "archive_closeout",
                    "can_start_early": False,
                    "requires_qc_pass": key == "quality_control",
                    "delivery_gate": "facility_dispatch"
                    if key == "delivery"
                    else "client_acceptance"
                    if key == "client_network_acceptance"
                    else "none",
                }
                for index, (name, key, color, _) in enumerate(STAGES, start=1)
            ]
        )
    )
    await connection.execute(
        insert(t.workflow_stage_approval_rules).values(
            [
                {
                    "id": rule_id(index),
                    "organization_id": organization_id,
                    "workflow_stage_id": stage_id(index),
                    "approver_role": role,
                    "label": f"{role_label(role)} sign-off",
                    "approval_order": 1,
                    "is_required": True,
                }
                for index, (_, _, _, role) in enumerate(STAGES, start=1)
            ]
        )
    )
    await connection.execute(
        insert(t.workflow_stage_work_order_templates).values(
            [
                {
                    "id": uid(number, "37", 1),
                    "organization_id": organization_id,
                    "workflow_stage_id": stage_id(12),
                    "title": "Confirm VFX, graphics and titles turnover",
                    "is_blocking": False,
                    "position": 1,
                },
                {
                    "id": uid(number, "37", 2),
                    "organization_id": organization_id,
                    "workflow_stage_id": stage_id(19),
                    "title": "Run technical QC and log exceptions",
                    "is_blocking": True,
                    "position": 1,
                },
            ]
        )
    )

    await connection.execute(
        insert(t.crm_companies).values(
            [
                {
                    "id": company_id(1),
                    "organization_id": organization_id,
                    "name": network,
                    "type": "network",
                    "address": "1 Broadcast Square, London",
                    "service_category": None,
                    "payment_terms_days": 30,
                    "currency": currency,
                    "finance_email": f"finance@{slug}.client.test",
                    "billing_email": f"accounts@{slug}.client.test",
                    "account_status": "active",
                    "booking_clearance": "clear",
                    "is_preferred_supplier": False,
                },
                {
                    "id": company_id(2),
                    "organization_id": organization_id,
                    "name": tenant["shows"][0][2],
                    "type": "production_company",
                    "address": "42 Production Way, London",
                    "service_category": None,
                    "payment_terms_days": 30,
                    "currency": currency,
                    "finance_email": None,
                    "billing_email": None,
                    "account_status": "active",
                    "booking_clearance": "clear",
                    "is_preferred_supplier": False,
                },
                {
                    "id": company_id(3),
                    "organization_id": organization_id,
                    "name": f"{tenant['name']} Facilities Vendor",
                    "type": "vendor",
                    "address": "18 Vendor Park, London",
                    "service_category": "Finishing, QC & localisation",
                    "is_preferred_supplier": True,
                    "payment_terms_days": 14,
                    "currency": currency,
                    "finance_email": f"accounts@{slug}.vendor.test",
                    "billing_email": None,
                    "account_status": "active",
                    "booking_clearance": "clear",
                },
            ]
        )
    )
    contacts = [
        ("Post Executive", "creative_approval"),
        ("Delivery Desk", "technical_delivery"),
        ("Finance", "finance"),
        ("Legal", "legal"),
        ("Review Office", "client_review"),
    ]
    await connection.execute(
        insert(t.crm_contacts).values(
            [
                {
                    "id": contact_id(index),
                    "organization_id": organization_id,
                    "company_id": company_id(1),
                    "name": f"{network} {label}",
                    "title": label,
                    "email": f"{kind}@{slug}.client.test",
                    "phone": f"+44 20 7000 100{index}",
                    "contact_type": kind,
                    "is_primary": index == 1,
                }
                for index, (label, kind) in enumerate(contacts, start=1)
            ]
        )
    )
    await connection.execute(
        insert(t.delivery_profiles).values(
            id=profile_id,
            organization_id=organization_id,
            client_company_id=company_id(1),
            network=network,
            name=f"{network} delivery profile",
            specification_url=f"https://example.com/{slug}/delivery-specification",
            is_active=True,
        )
    )
    profile_items = (
        ("picture_master", "Network / streamer picture master", True, True),
        ("textless_master", "Textless master and clean elements", True, True),
        ("me_mix", "M&E mix", True, True),
        ("audio_mix_5_1", "5.1 final mix", True, True),
        ("captions", "Timed captions", True, True),
        ("metadata", "Editorial metadata sheet", True, False),
    )
    await connection.execute(
        insert(t.delivery_profile_items).values(
            [
                {
                    "id": uid(number, "4c", position),
                    "organization_id": organization_id,
                    "delivery_profile_id": profile_id,
                    "component_type": component,
                    "label": label,
                    "required": required,
                    "format_specification": "External network specification reference",
                    "version": "TX",
                    "territory": "UK",
                    "language": "English",
                    "recipient_contact_id": contact_id(2),
                    "requires_external_recipient": True,
                    "qc_required": qc_required,
                    "default_deadline_offset_days": -5 + position,
                    "position": position,
                }
                for position, (component, label, required, qc_required) in enumerate(profile_items, start=1)
            ]
        )
    )

    show_rows, season_rows, episode_rows = [], [], []
    lifecycle = (
        (4, "in_progress", "editor_cut"),
        (6, "not_started", "review"),
        (10, "in_progress", "locked"),
        (13, "blocked", "online"),
        (3, "not_started", "assembly"),
        (22, "complete", "delivered"),
        (7, "awaiting_sign_off", "review"),
        (10, "in_progress", "locked"),
    )
    for show_position, (title, code, company, episode_titles) in enumerate(tenant["shows"], start=1):
        show_rows.append(
            {
                "id": show_id(show_position),
                "organization_id": organization_id,
                "title": title,
                "code": code,
                "network": network,
                "production_company": company,
                "client_company_id": company_id(1),
                "production_company_id": company_id(2),
                "delivery_profile_id": profile_id if show_position == 1 else None,
                "time_zone": "Europe/London",
            }
        )
        season_rows.append(
            {
                "id": season_id(show_position),
                "organization_id": organization_id,
                "show_id": show_id(show_position),
                "number": 1,
                "title": f"{title} · Season 1",
                "start_date": now_at(-100 + show_position * 18).date(),
            }
        )
        for episode_number, episode_title in enumerate(episode_titles, start=1):
            position = (show_position - 1) * 4 + episode_number
            stage_position, workflow_status, legacy_status = lifecycle[(position - 1) % len(lifecycle)]
            episode_rows.append(
                {
                    "id": episode_id(position),
                    "organization_id": organization_id,
                    "season_id": season_id(show_position),
                    "workflow_stage_id": stage_id(stage_position),
                    "workflow_status": workflow_status,
                    "number": episode_number,
                    "production_code": f"{code}10{episode_number}",
                    "title": episode_title,
                    "synopsis": f"{episode_title} enters the {tenant['name']} post pipeline.",
                    "status": legacy_status,
                    "qc_status": "needs_attention"
                    if position == 4
                    else "passed"
                    if workflow_status == "complete"
                    else "in_progress",
                    "assigned_producer_id": person_id(role_indices["producer"]),
                    "editor_id": person_id(role_indices["editor"]),
                    "colorist_id": person_id(role_indices["colorist"]),
                    "sound_mixer_id": person_id(role_indices["sound_mixer"]),
                    "air_date": now_at(25 + position * 7).date(),
                    "locked_cut_date": now_at(-4 + position * 2).date(),
                    "delivery_deadline": now_at(3 + position * 2, 17),
                }
            )
    await connection.execute(insert(t.shows).values(show_rows))
    await connection.execute(insert(t.seasons).values(season_rows))
    await connection.execute(insert(t.episodes).values(episode_rows))
    await connection.execute(
        insert(t.show_contacts).values(
            [
                {
                    "id": uid(number, "44", show_pos * 10 + contact_pos),
                    "organization_id": organization_id,
                    "show_id": show_id(show_pos),
                    "contact_id": contact_id(contact_pos),
                    "responsibility": responsibility,
                    "relationship": label,
                    "is_approval_contact": contact_pos == 1,
                }
                for show_pos in range(1, len(tenant["shows"]) + 1)
                for contact_pos, responsibility, label in (
                    (1, "creative_approvals", "creative approval"),
                    (2, "delivery_qc", "delivery and QC"),
                    (3, "finance_billing", "finance and billing"),
                    (4, "legal_compliance", "legal and compliance"),
                )
            ]
        )
    )

    assignments = []
    signer_rows = []
    # `episode_team_assignments.is_lead` is the persisted workflow-signer
    # choice.  Every demo episode has one person for each seeded sign-off
    # role, so make that person the selected signer as the fixtures are built.
    # This keeps the demo's actionable approvals aligned with the named people
    # shown in Edit episode → Episode team.
    workflow_signer_roles = {stage[3] for stage in STAGES}
    for episode in episode_rows:
        roles = {
            "producer",
            "editor",
            "assistant_editor",
            "colorist",
            "sound_mixer",
            "qc",
            "client",
            "online_editor",
            "vfx_supervisor",
            "supervising_sound_editor",
            "rerecording_mixer",
            "vfx_coordinator",
            "post_supervisor",
        }
        for role in roles:
            person_position = role_indices.get(role)
            if person_position:
                assignments.append(
                    {
                        "id": uid(number, "2f", len(assignments) + 1),
                        "organization_id": organization_id,
                        "episode_id": episode["id"],
                        "person_id": person_id(person_position),
                        "is_lead": role in workflow_signer_roles,
                    }
                )
        for stage_position, (_, _, _, role) in enumerate(STAGES, start=1):
            person_position = role_indices.get(role)
            if person_position:
                signer_rows.append(
                    {
                        "id": uid(number, "2e", len(signer_rows) + 1),
                        "organization_id": organization_id,
                        "episode_id": episode["id"],
                        "workflow_stage_approval_rule_id": rule_id(stage_position),
                        "person_id": person_id(person_position),
                    }
                )
    assignment_insert = pg_insert(t.episode_team_assignments).values(assignments)
    await connection.execute(
        assignment_insert.on_conflict_do_update(
            index_elements=["episode_id", "person_id"],
            set_={"is_lead": assignment_insert.excluded.is_lead},
        )
    )
    await connection.execute(insert(t.episode_workflow_signers).values(signer_rows))
    approval_rows = []
    stage_positions = {stage_id(position): position for position in range(1, len(STAGES) + 1)}
    for episode in episode_rows:
        if episode["workflow_status"] != "awaiting_sign_off":
            continue
        position = stage_positions[episode["workflow_stage_id"]]
        approver_role = STAGES[position - 1][3]
        person_position = role_indices.get(approver_role)
        if not person_position:
            continue
        approval_rows.append(
            {
                "id": uid(number, "2d", len(approval_rows) + 1),
                "organization_id": organization_id,
                "episode_id": episode["id"],
                "workflow_stage_id": episode["workflow_stage_id"],
                "approval_rule_id": rule_id(position),
                "approver_role": approver_role,
                "required_person_id": person_id(person_position),
                "status": "pending",
                "submitted_at": now_at(-1, 15),
            }
        )
    if approval_rows:
        await connection.execute(insert(t.episode_workflow_approvals).values(approval_rows))

    await connection.execute(
        insert(t.rooms).values(
            [
                {
                    "id": room_id(index),
                    "organization_id": organization_id,
                    "name": name,
                    "type": room_type,
                    "location": location,
                    "capacity": capacity,
                }
                for index, (name, room_type, location, capacity) in enumerate(
                    zip(
                        tenant["rooms"],
                        ("edit_bay", "edit_bay", "color_suite", "mix_room", "qc_room"),
                        ("Editorial floor", "Editorial floor", "Finishing floor", "Sound floor", "Delivery floor"),
                        (3, 3, 5, 8, 4),
                        strict=True,
                    ),
                    start=1,
                )
            ]
        )
    )
    # Keep a dense but realistic live calendar: confirmed rooms, concurrent
    # pencil holds, a linked work-order reservation, and actuals/overtime.
    # This makes the Gantt states useful immediately after a reset.
    booking_specs = (
        # A live, standard facility day for the first editor in every demo
        # post house. It keeps catering and runner-desk flows usable today
        # without implying the room is booked into tomorrow.
        (1, 1, "editor", 0, 9, 0, 18, "edit", "confirmed", False, None, "Today’s editorial session", None, None),
        (3, 4, "colorist", 0, 10, 0, 16, "color", "confirmed", False, None, None, None, None),
        (4, 7, "sound_mixer", 1, 9, 1, 18, "mix", "confirmed", False, None, None, None, None),
        (5, 4, "qc", 2, 9, 2, 17, "qc", "confirmed", False, None, None, None, None),
        (2, 8, "editor", 3, 10, 3, 16, "edit", "tentative", True, 1, "Client pencil hold", None, None),
        (2, 8, "editor", 3, 10, 3, 16, "edit", "tentative", True, 2, "Second pencil hold", None, None),
        (
            1,
            3,
            "assistant_editor",
            1,
            13,
            1,
            16,
            "edit",
            "confirmed",
            False,
            None,
            "Work order · editorial turnover prep",
            None,
            None,
        ),
        (3, 5, "colorist", -1, 9, -1, 18, "color", "confirmed", False, None, "Grade notes pass", -1, 19),
        # A completed client review for the invoice-ready episode. Actual time
        # is confirmed, so this is a realistic clean billing example.
        (1, 6, "editor", -2, 9, -2, 15, "client_review", "confirmed", False, None, "Client review session", -2, 15),
        (4, 7, "sound_mixer", 4, 9, 4, 18, "mix", "confirmed", False, None, "Dialogue and stem review", None, None),
        (5, 8, "qc", 5, 9, 5, 14, "qc", "confirmed", False, None, "Delivery preflight", None, None),
        (
            1,
            1,
            "assistant_editor",
            6,
            9,
            6,
            18,
            "ingest",
            "confirmed",
            False,
            None,
            "Editorial turnover ingest",
            None,
            None,
        ),
    )
    episode_codes = {episode["id"]: episode["production_code"] for episode in episode_rows}
    await connection.execute(
        insert(t.bookings).values(
            [
                {
                    "id": booking_id(index),
                    "organization_id": organization_id,
                    "room_id": room_id(room_position),
                    "episode_id": episode_id(episode_position),
                    "person_id": person_id(role_indices[role]),
                    "title": title or f"{episode_codes[episode_id(episode_position)]} {booking_type} booking",
                    "starts_at": now_at(start_day, start_hour),
                    "ends_at": now_at(end_day, end_hour),
                    "setup_minutes": 15,
                    "handover_minutes": 15,
                    "actual_starts_at": now_at(actual_day, 9) if actual_day is not None else None,
                    "actual_ends_at": now_at(actual_day, actual_end_hour) if actual_day is not None else None,
                    "approved_overtime_minutes": 60 if actual_day is not None else 0,
                    # A confirmed seed booking has an explicit wet-hire
                    # agreement and its room/person components below snapshot
                    # the matching rates. Holds remain deliberately
                    # unconfirmed and are never eligible for actual time.
                    "commercial_treatment": "wet_hire",
                    "commercial_treatment_snapshot_at": now_at(0) if status == "confirmed" and not is_option else None,
                    "commercial_review_required": False,
                    "commercial_review_reason": None,
                    "commercial_review_marked_at": None,
                    "is_option": is_option,
                    "option_rank": option_rank,
                    "status": status,
                    "booking_type": booking_type,
                    "notes": "Live facility booking; external review links remain in notes.",
                }
                for index, (
                    room_position,
                    episode_position,
                    role,
                    start_day,
                    start_hour,
                    end_day,
                    end_hour,
                    booking_type,
                    status,
                    is_option,
                    option_rank,
                    title,
                    actual_day,
                    actual_end_hour,
                ) in enumerate(booking_specs, start=1)
            ]
        )
    )
    await connection.execute(
        insert(t.catering_settings).values(
            id=uid(number, "2b", 1), organization_id=organization_id, markup_percent=Decimal("12.5")
        )
    )
    await connection.execute(
        insert(t.catering_requests).values(
            {
                "id": uid(number, "2a", 1),
                "organization_id": organization_id,
                "booking_id": booking_id(1),
                "room_id": room_id(1),
                "requested_by_person_id": person_id(role_indices["editor"]),
                "fulfilled_by_person_id": person_id(role_indices["runner"]),
                "request_type": "lunch",
                "item": "Post-production lunch",
                "quantity": 1,
                "requested_for": now_at(0, 13),
                "status": "preparing",
                "currency": currency,
            }
        )
    )

    # A spread of manifest states makes the delivery register useful for
    # demos: preparing, in QC, failed QC, dispatched, receipt-confirmed, and
    # rejected work all appear without relying on fictional media uploads.
    manifest_episodes = [episode_rows[index] for index in (0, 1, 3, 5, 6, 7)]
    await connection.execute(
        insert(t.episode_delivery_manifests).values(
            [
                {
                    "id": uid(number, "4d", index),
                    "organization_id": organization_id,
                    "episode_id": episode["id"],
                    "delivery_profile_id": profile_id,
                    "profile_name": f"{network} delivery profile",
                    "specification_url": f"https://example.com/{slug}/delivery-specification",
                    "applied_by_user_id": users[0]["id"],
                    "applied_at": now_at(-4),
                }
                for index, episode in enumerate(manifest_episodes, start=1)
            ]
        )
    )
    delivery_rows = []
    manifest_states = ("preparing", "ready_for_qc", "qc_failed", "dispatched", "receipt_confirmed", "rejected")
    for manifest_position, episode in enumerate(manifest_episodes, start=1):
        manifest_status = manifest_states[manifest_position - 1]
        externally_referenced = manifest_status in {"dispatched", "receipt_confirmed", "rejected"}
        qc_result = (
            "passed"
            if manifest_status in {"dispatched", "receipt_confirmed"}
            else "failed"
            if manifest_status == "qc_failed"
            else "not_started"
        )
        for item_position, (component, label, required, qc_required) in enumerate(profile_items, start=1):
            delivery_rows.append(
                {
                    "id": uid(number, "4e", manifest_position * 20 + item_position),
                    "organization_id": organization_id,
                    "episode_delivery_manifest_id": uid(number, "4d", manifest_position),
                    "episode_id": episode["id"],
                    "delivery_profile_item_id": uid(number, "4c", item_position),
                    "component_type": component,
                    "label": label,
                    "required": required,
                    "format_specification": "External network specification reference",
                    "version": "TX",
                    "territory": "UK",
                    "language": "English",
                    "recipient_contact_id": contact_id(2),
                    "recipient_name": f"{network} Delivery Desk",
                    "recipient_email": f"delivery@{slug}.client.test",
                    "requires_external_recipient": True,
                    "qc_required": qc_required,
                    "status": manifest_status,
                    "due_date": (episode["delivery_deadline"] + timedelta(days=-5 + item_position)).date(),
                    "external_url": f"https://example.com/{slug}/delivery/{episode['production_code']}/{component}"
                    if externally_referenced
                    else None,
                    "external_reference": f"{episode['production_code']}-{component.upper()}"
                    if externally_referenced
                    else None,
                    "is_externally_shared": externally_referenced,
                    "submission_method": "Client delivery portal" if externally_referenced else None,
                    "qc_result": qc_result if qc_required else "not_required",
                    "receipt_confirmed_at": now_at(-1, 16) if manifest_status == "receipt_confirmed" else None,
                    "receipt_confirmed_by": f"{network} Delivery Desk"
                    if manifest_status == "receipt_confirmed"
                    else None,
                    "rejection_reason": "Recipient requested a corrected captions package."
                    if manifest_status == "rejected"
                    else None,
                    "position": item_position,
                }
            )
    await connection.execute(insert(t.episode_delivery_items).values(delivery_rows))

    qc_report_id = uid(number, "33", 1)
    await connection.execute(
        insert(t.qc_reports).values(
            id=qc_report_id,
            organization_id=organization_id,
            episode_id=episode_id(4),
            status="failed",
            summary="Flash-frame and caption timing failures require a corrected package.",
            completed_at=now_at(-1, 16),
        )
    )
    await connection.execute(
        insert(t.qc_issues).values(
            id=uid(number, "34", 1),
            organization_id=organization_id,
            qc_report_id=qc_report_id,
            code="PHOTOSENS-01",
            severity="high",
            description="Photosensitivity warning at transition; regrade and rerun QC.",
            timecode_seconds=Decimal("1817.700"),
            status="open",
        )
    )
    work_order_id = uid(number, "38", 1)
    await connection.execute(
        insert(t.post_work_orders).values(
            nullable_rows(
                [
                    {
                        "id": work_order_id,
                        "organization_id": organization_id,
                        "episode_id": episode_id(1),
                        "workflow_stage_id": stage_id(4),
                        "work_type": "external_vendor",
                        "vendor_company_id": company_id(3),
                        "qc_issue_id": None,
                        "kind": "work_order",
                        "title": "External caption and QC package",
                        "description": "Vendor brief for caption correction and technical QC support.",
                        "assignee_person_id": person_id(role_indices["assistant_editor"]),
                        "is_blocking": False,
                        "status": "in_progress",
                        "billing_scope": "internal",
                        "billing_status": "not_billable",
                        "estimated_amount": Decimal("3500") * multiplier,
                        "currency": currency,
                        "external_url": "https://example.com/vendor-brief",
                    },
                    {
                        "id": uid(number, "38", 2),
                        "organization_id": organization_id,
                        "episode_id": episode_id(4),
                        "workflow_stage_id": stage_id(13),
                        "vendor_company_id": None,
                        "qc_issue_id": uid(number, "34", 1),
                        "work_type": "internal",
                        "kind": "qc_exception",
                        "title": "QC exception — correct photosensitivity transition",
                        "assignee_person_id": person_id(role_indices["online_editor"]),
                        "is_blocking": True,
                        "status": "open",
                        "billing_scope": "internal",
                        "billing_status": "not_billable",
                        "estimated_amount": None,
                        "currency": currency,
                        "external_url": None,
                        "due_at": now_at(-1, 15),
                    },
                    {
                        "id": uid(number, "38", 3),
                        "organization_id": organization_id,
                        "episode_id": episode_id(3),
                        "workflow_stage_id": stage_id(4),
                        "work_type": "internal",
                        "kind": "work_order",
                        "title": "Prepare editorial turnover notes",
                        "description": (
                            "Consolidate bins, cue sheets, and editorial handover notes before the next review."
                        ),
                        "assignee_person_id": person_id(role_indices["assistant_editor"]),
                        "is_blocking": False,
                        "status": "in_progress",
                        "billing_scope": "included",
                        "billing_status": "not_billable",
                        "currency": currency,
                        "due_at": now_at(1, 16),
                    },
                    {
                        "id": uid(number, "38", 4),
                        "organization_id": organization_id,
                        "episode_id": episode_id(5),
                        "workflow_stage_id": stage_id(13),
                        "booking_id": booking_id(8),
                        "work_type": "internal",
                        "kind": "work_order",
                        "title": "Apply colour pass notes",
                        "description": "Apply approved grade notes and confirm the updated pass with editorial.",
                        "assignee_person_id": person_id(role_indices["colorist"]),
                        "is_blocking": False,
                        "status": "in_progress",
                        "billing_scope": "included",
                        "billing_status": "not_billable",
                        "actual_amount": Decimal("246") * multiplier,
                        "currency": currency,
                        "due_at": now_at(0, 17),
                    },
                    {
                        "id": uid(number, "38", 5),
                        "organization_id": organization_id,
                        "episode_id": episode_id(7),
                        "workflow_stage_id": stage_id(7),
                        "work_type": "internal",
                        "kind": "work_order",
                        "title": "Prepare mix review reference",
                        "description": "Check the mix reference and prepare a review link for the producer.",
                        "assignee_person_id": person_id(role_indices["sound_mixer"]),
                        "is_blocking": False,
                        "status": "in_progress",
                        "billing_scope": "included",
                        "billing_status": "not_billable",
                        "currency": currency,
                        "due_at": now_at(2, 12),
                    },
                    {
                        "id": uid(number, "38", 6),
                        "organization_id": organization_id,
                        "episode_id": episode_id(7),
                        "workflow_stage_id": stage_id(7),
                        "work_type": "internal",
                        "kind": "work_order",
                        "title": "Resolve outstanding client note",
                        "description": "Assign an owner and resolve the remaining client note before sign-off.",
                        "is_blocking": True,
                        "status": "open",
                        "billing_scope": "included",
                        "billing_status": "not_billable",
                        "currency": currency,
                        "due_at": now_at(-1, 12),
                    },
                    {
                        "id": uid(number, "38", 7),
                        "organization_id": organization_id,
                        "episode_id": episode_id(1),
                        "workflow_stage_id": stage_id(4),
                        "work_type": "internal",
                        "kind": "work_order",
                        "title": "Client change — lower-third revision",
                        "description": "Approved editorial change for a revised lower-third and legal line.",
                        "assignee_person_id": person_id(role_indices["editor"]),
                        "is_blocking": False,
                        "status": "ready_for_review",
                        "billing_scope": "billable_change",
                        "billing_status": "draft",
                        "client_quote_amount": Decimal("850") * multiplier,
                        "client_quote_currency": currency,
                        "currency": currency,
                        "billing_notes": "Approved change to be billed against the active client PO.",
                        "due_at": now_at(4, 12),
                    },
                    {
                        "id": uid(number, "38", 8),
                        "organization_id": organization_id,
                        "episode_id": episode_id(2),
                        "workflow_stage_id": stage_id(4),
                        "work_type": "internal",
                        "kind": "work_order",
                        "title": "Archive prior editorial exports",
                        "assignee_person_id": person_id(role_indices["assistant_editor"]),
                        "is_blocking": False,
                        "status": "complete",
                        "billing_scope": "included",
                        "billing_status": "not_billable",
                        "currency": currency,
                        "completed_by_person_id": person_id(role_indices["assistant_editor"]),
                        "completed_at": now_at(-2, 17),
                    },
                ]
            )
        )
    )
    await connection.execute(
        insert(t.post_work_order_items).values(
            [
                {
                    "id": uid(number, "3a", 1),
                    "organization_id": organization_id,
                    "work_order_id": work_order_id,
                    "type": "service",
                    "description": "Caption correction and re-export",
                    "quantity": Decimal("1"),
                    "unit": "fixed",
                    "unit_rate": Decimal("1250") * multiplier,
                    "discount_percent": Decimal("0"),
                    "position": 1,
                },
                {
                    "id": uid(number, "3a", 2),
                    "organization_id": organization_id,
                    "work_order_id": work_order_id,
                    "type": "service",
                    "description": "Technical QC verification",
                    "quantity": Decimal("1"),
                    "unit": "unit",
                    "unit_rate": Decimal("900") * multiplier,
                    "discount_percent": Decimal("0"),
                    "position": 2,
                },
            ]
        )
    )

    # Each tenant starts with an explainable planning sample. These are not
    # opaque category totals: each estimate records quantity, unit, rate
    # source, and the room, person, service, delivery profile, or supplier it
    # represents. The same fixed IDs keep the browser demo stable.
    budget_specs = (
        # line, episode, category, description, quantity, unit, rate, source, resource, external
        (
            1,
            1,
            "Edit suite",
            "Editorial bay allowance for assembly and picture review.",
            5,
            "day",
            760,
            "master_rate_card",
            f"room:{room_id(1)} · {tenant['rooms'][0]}",
            False,
        ),
        (
            2,
            3,
            "Editorial artists",
            "Assistant-editor turnover and editorial support.",
            4,
            "day",
            535,
            "network_rate_card",
            f"person:{person_id(role_indices['assistant_editor'])} · Assistant editor",
            False,
        ),
        (
            3,
            2,
            "VFX",
            "VFX pulls, graphics turnover, and title review package.",
            1,
            "fixed",
            3450,
            "show_rate_card",
            f"service:{uid(number, '36', 7)} · VFX turnover",
            False,
        ),
        (
            4,
            5,
            "Colour",
            "Colour suite and supervised grade notes pass.",
            2,
            "day",
            1020,
            "episode_rate_card",
            f"room:{room_id(3)} · {tenant['rooms'][2]}",
            False,
        ),
        (
            5,
            7,
            "Sound",
            "Mix-stage time for final mix, stems, and review reference.",
            3,
            "day",
            1160,
            "network_rate_card",
            f"room:{room_id(4)} · {tenant['rooms'][3]}",
            False,
        ),
        (
            6,
            8,
            "QC",
            "Technical QC pass and corrective re-check allowance.",
            1,
            "fixed",
            485,
            "master_rate_card",
            f"room:{room_id(5)} · {tenant['rooms'][4]}",
            False,
        ),
        (
            7,
            1,
            "Delivery",
            "Delivery manifest preparation, metadata, and recipient handoff.",
            1,
            "fixed",
            1650,
            "manual_estimate",
            f"delivery_profile:{profile_id} · {network} delivery profile",
            False,
        ),
        (
            8,
            1,
            "External vendors",
            "External caption correction and specialist QC support.",
            1,
            "fixed",
            3500,
            "manual_estimate",
            f"vendor:{company_id(3)} · {tenant['name']} Facilities Vendor",
            True,
        ),
    )
    budget_rows = []
    budget_actual_rows = []
    for (
        index,
        episode_position,
        category,
        description,
        quantity,
        unit,
        rate,
        rate_source,
        resource_reference,
        external_cost,
    ) in budget_specs:
        amount = Decimal(quantity * rate) * multiplier
        line_id = uid(number, "30", index)
        show_position = next(
            position
            for position, show in enumerate(tenant["shows"], start=1)
            if episode_position <= position * 4 and episode_position > (position - 1) * 4
        )
        budget_rows.append(
            {
                "id": line_id,
                "organization_id": organization_id,
                "show_id": show_id(show_position),
                "season_id": season_id(show_position),
                "episode_id": episode_id(episode_position),
                "code": f"EST-{index:02d}",
                "category": category,
                "description": description,
                "planned_quantity": Decimal(quantity),
                "planned_unit": unit,
                "rate_snapshot": Decimal(rate) * multiplier,
                "rate_source": rate_source,
                "resource_reference": resource_reference,
                "estimate_status": "approved",
                "budgeted_amount": amount,
                # The allocation trigger owns this compatibility cache.
                "actual_amount": Decimal("0"),
                "currency": currency,
                "cost_type": "internal",
                "external_cost": external_cost,
            }
        )

    # A confirmed actual on the colour booking and a logged editorial work
    # order make the sample ledger traceable without using browser-entered
    # totals. Supplier actuals are appended after their invoice exists.
    budget_actual_rows.extend(
        [
            {
                "id": uid(number, "49", 1),
                "organization_id": organization_id,
                "budget_line_id": uid(number, "30", 4),
                "booking_id": booking_id(8),
                "source_type": "booking",
                "source_reference": f"booking-actual:{booking_id(8)}",
                "amount": Decimal("1120") * multiplier,
                "currency": currency,
                "allocation_date": now_at(-1).date(),
                "created_at": now_at(0),
                "updated_at": now_at(0),
            },
            {
                "id": uid(number, "49", 2),
                "organization_id": organization_id,
                "budget_line_id": uid(number, "30", 2),
                "work_order_id": uid(number, "38", 3),
                "source_type": "work_order",
                "source_reference": f"work-order-actual:{uid(number, '38', 3)}",
                "amount": Decimal("510") * multiplier,
                "currency": currency,
                "allocation_date": now_at(-1).date(),
                "created_at": now_at(0),
                "updated_at": now_at(0),
            },
        ]
    )
    await connection.execute(insert(t.budget_lines).values(budget_rows))
    # Existing demo figures are historical actuals.  Seed them as explicit
    # allocation rows rather than relying on the compatibility cache so every
    # visible actual can be traced back to a ledger entry after the migration.
    await connection.execute(insert(t.budget_actual_allocations).values(nullable_rows(budget_actual_rows)))
    # Freeze an approved baseline for every seeded episode that has planned
    # work. The item snapshots let the demo show original/current estimates
    # and later revisions without treating the mutable budget line as history.
    lines_by_episode: dict[str, list[dict]] = {}
    for line in budget_rows:
        lines_by_episode.setdefault(line["episode_id"], []).append(line)
    estimate_rows = []
    estimate_item_rows = []
    for estimate_position, (seed_episode_id, lines) in enumerate(lines_by_episode.items(), start=1):
        estimate_id = uid(number, "54", estimate_position)
        approved_amount = sum((Decimal(str(line["budgeted_amount"])) for line in lines), Decimal("0"))
        estimate_rows.append(
            {
                "id": estimate_id,
                "organization_id": organization_id,
                "episode_id": seed_episode_id,
                "revision_number": 1,
                "name": "Original approved episode estimate",
                "reason": "Seeded baseline from the active rate-card and supplier plan.",
                "status": "approved",
                "approved_amount": approved_amount,
                "created_by_user_id": users[0]["id"],
                "approved_by_user_id": users[0]["id"],
                "approved_at": now_at(-10),
                "created_at": now_at(-11),
                "updated_at": now_at(-10),
            }
        )
        for line_position, line in enumerate(lines, start=1):
            estimate_item_rows.append(
                {
                    "id": uid(number, "55", estimate_position * 10 + line_position),
                    "organization_id": organization_id,
                    "estimate_id": estimate_id,
                    "source_budget_line_id": line["id"],
                    "category": line["category"],
                    "description": line["description"],
                    "external_cost": line["external_cost"],
                    "planned_amount": line["budgeted_amount"],
                    "currency": currency,
                    "created_at": now_at(-10),
                }
            )
    await connection.execute(insert(t.episode_budget_estimates).values(estimate_rows))
    await connection.execute(insert(t.episode_budget_estimate_items).values(estimate_item_rows))
    for linked_booking_id, budget_line_id in (
        (booking_id(1), uid(number, "30", 1)),
        (booking_id(8), uid(number, "30", 4)),
        (booking_id(10), uid(number, "30", 5)),
        (booking_id(11), uid(number, "30", 6)),
    ):
        await connection.execute(
            update(t.bookings)
            .where(t.bookings.c.organization_id == organization_id)
            .where(t.bookings.c.id == linked_booking_id)
            .values(budget_line_id=budget_line_id)
        )
    await connection.execute(
        update(t.post_work_orders)
        .where(t.post_work_orders.c.organization_id == organization_id)
        .where(t.post_work_orders.c.id == uid(number, "38", 1))
        .values(budget_line_id=uid(number, "30", 8))
    )
    vendor_invoice_id, vendor_po_id = uid(number, "47", 1), uid(number, "48", 1)
    actual_vendor_cost = Decimal("2750") * multiplier
    await connection.execute(
        insert(t.vendor_invoices).values(
            id=vendor_invoice_id,
            organization_id=organization_id,
            vendor_company_id=company_id(3),
            work_order_id=work_order_id,
            show_id=show_id(1),
            episode_id=episode_id(1),
            budget_line_id=uid(number, "30", 8),
            invoice_number=f"{slug.upper()}-V-001",
            description="External QC and finishing support",
            amount=actual_vendor_cost,
            currency=currency,
            status="approved",
            invoice_date=now_at(-3).date(),
            due_date=now_at(12).date(),
        )
    )
    await connection.execute(
        insert(t.purchase_orders).values(
            id=vendor_po_id,
            organization_id=organization_id,
            vendor_company_id=company_id(3),
            show_id=show_id(1),
            episode_id=episode_id(1),
            po_number=f"{slug.upper()}-PO-001",
            currency=currency,
            approved_amount=Decimal("5000") * multiplier,
            issue_date=now_at(-14).date(),
            expiry_date=now_at(45).date(),
            status="approved",
            notes="Approved specialist finishing and delivery support.",
            external_document_url=f"https://example.com/purchase-orders/{slug}-001",
            created_by_user_id=users[0]["id"],
        )
    )
    await connection.execute(
        update(t.post_work_orders)
        .where(t.post_work_orders.c.id == work_order_id)
        .values(purchase_order_id=vendor_po_id)
    )
    await connection.execute(
        update(t.budget_lines)
        .where(t.budget_lines.c.id == uid(number, "30", 8))
        .values(purchase_order_id=vendor_po_id, work_order_id=work_order_id, vendor_invoice_id=vendor_invoice_id)
    )
    await connection.execute(
        insert(t.budget_actual_allocations).values(
            id=uid(number, "49", 3),
            organization_id=organization_id,
            budget_line_id=uid(number, "30", 8),
            vendor_invoice_id=vendor_invoice_id,
            source_type="vendor_invoice",
            source_reference=f"vendor-invoice:{vendor_invoice_id}",
            amount=actual_vendor_cost,
            currency=currency,
            allocation_date=now_at(-3).date(),
            created_at=now_at(0),
            updated_at=now_at(0),
        )
    )
    await connection.execute(
        insert(t.purchase_order_allocations).values(
            nullable_rows(
                [
                    {
                        "id": uid(number, "49", 1),
                        "organization_id": organization_id,
                        "purchase_order_id": vendor_po_id,
                        "allocation_type": "work_order",
                        "work_order_id": work_order_id,
                        "amount": Decimal("3500") * multiplier,
                        "allocation_date": now_at(-7).date(),
                        "reference": "WO-EXT-001",
                        "description": "External caption and QC commitment",
                    },
                    {
                        "id": uid(number, "49", 2),
                        "organization_id": organization_id,
                        "purchase_order_id": vendor_po_id,
                        "allocation_type": "vendor_invoice",
                        "vendor_invoice_id": vendor_invoice_id,
                        "amount": actual_vendor_cost,
                        "allocation_date": now_at(-3).date(),
                        "reference": f"{slug.upper()}-V-001",
                        "description": "Supplier invoice received",
                    },
                ]
            )
        )
    )

    artist_rate_specs = [
        (role, role_label(role), rate) for role, rate in DEMO_ARTIST_HOURLY_RATES.items() if role in role_indices
    ]
    service_rows = [
        {
            "id": uid(number, "36", index),
            "organization_id": organization_id,
            "name": label,
            "category": label,
            "artist_role": role,
            "unit": "hour",
            "rate": rate * multiplier,
            "currency": currency,
            "notes": "Default hourly artist rate.",
            "is_active": True,
        }
        for index, (role, label, rate) in enumerate(artist_rate_specs, start=1)
    ]
    await connection.execute(insert(t.service_rates).values(service_rows))
    master_card_id = uid(number, "45", 1)
    await connection.execute(
        insert(t.rate_cards).values(
            {
                "id": master_card_id,
                "organization_id": organization_id,
                "name": "Master rate card",
                "currency": currency,
                "is_active": True,
            }
        )
    )
    await connection.execute(
        insert(t.rate_card_items).values(
            nullable_rows(
                [
                    {
                        "id": uid(number, "46", index),
                        "organization_id": organization_id,
                        "rate_card_id": master_card_id,
                        "service_rate_id": uid(number, "36", index),
                        "target_type": "service",
                        "category": category,
                        "artist_role": role,
                        "unit": "hour",
                        "rate": rate * multiplier,
                        "internal_cost_rate": rate * multiplier * Decimal("0.60"),
                    }
                    for index, (role, category, rate) in enumerate(artist_rate_specs, start=1)
                ]
                + [
                    {
                        "id": uid(number, "46", len(artist_rate_specs) + index),
                        "organization_id": organization_id,
                        "rate_card_id": master_card_id,
                        "target_type": "room",
                        "room_id": room_id(index),
                        "category": DEMO_ROOM_HOURLY_RATES.get(room_type, ("Specialist room", Decimal("125")))[0],
                        "unit": "hour",
                        "rate": DEMO_ROOM_HOURLY_RATES.get(room_type, ("Specialist room", Decimal("125")))[1]
                        * multiplier,
                        "internal_cost_rate": DEMO_ROOM_HOURLY_RATES.get(
                            room_type, ("Specialist room", Decimal("125"))
                        )[1]
                        * multiplier
                        * Decimal("0.55"),
                    }
                    for index, room_type in enumerate(
                        ("edit_bay", "edit_bay", "color_suite", "mix_room", "qc_room"), start=1
                    )
                ]
            )
        )
    )

    # Confirmed bookings must carry commercial snapshots before an artist can
    # submit actual time. Seed both the booked room and artist components from
    # the same master-card rows the booking resolver would select in normal
    # operation; tentative holds deliberately remain unpriced.
    artist_rate_positions = {role: index for index, (role, _, _) in enumerate(artist_rate_specs, start=1)}
    room_types = ("edit_bay", "edit_bay", "color_suite", "mix_room", "qc_room")
    booking_component_rows: list[dict[str, object]] = []
    for index, spec in enumerate(booking_specs, start=1):
        (
            room_position,
            _episode_position,
            role,
            _start_day,
            start_hour,
            _end_day,
            end_hour,
            _booking_type,
            booking_status,
            is_option,
            _option_rank,
            _title,
            _actual_day,
            _actual_end_hour,
        ) = spec
        if booking_status != "confirmed" or is_option:
            continue
        quantity = Decimal(end_hour - start_hour)
        room_category, room_rate = DEMO_ROOM_HOURLY_RATES[room_types[room_position - 1]]
        artist_rate = DEMO_ARTIST_HOURLY_RATES[role]
        artist_item_position = artist_rate_positions[role]
        resource_rows = (
            {
                "component_type": "room",
                "room_id": room_id(room_position),
                "person_id": None,
                "resource_name": tenant["rooms"][room_position - 1],
                "category": room_category,
                "rate": room_rate,
                "internal_rate": room_rate * Decimal("0.55"),
                "rate_item_position": len(artist_rate_specs) + room_position,
            },
            {
                "component_type": "person",
                "room_id": None,
                "person_id": person_id(role_indices[role]),
                "resource_name": tenant["people"][role_indices[role] - 1][0],
                "category": role_label(role),
                "rate": artist_rate,
                "internal_rate": artist_rate * Decimal("0.60"),
                "rate_item_position": artist_item_position,
            },
        )
        for component_position, resource in enumerate(resource_rows, start=1):
            client_rate = Decimal(resource["rate"]) * multiplier
            booking_component_rows.append(
                {
                    "id": uid(number, "4f", (index * 2) - 2 + component_position),
                    "organization_id": organization_id,
                    "booking_id": booking_id(index),
                    "component_type": resource["component_type"],
                    "room_id": resource["room_id"],
                    "person_id": resource["person_id"],
                    "resource_name": resource["resource_name"],
                    "category": resource["category"],
                    "billing_unit": "hour",
                    "client_rate": client_rate,
                    "internal_cost_rate": Decimal(resource["internal_rate"]) * multiplier,
                    "currency": currency,
                    "rate_source": "master_rate_card",
                    "rate_card_scope": "master",
                    "rate_card_id": master_card_id,
                    "rate_card_item_id": uid(number, "46", int(resource["rate_item_position"])),
                    "is_negotiated_override": False,
                    "estimated_quantity": quantity,
                    "estimated_amount": client_rate * quantity,
                    "commercial_treatment": "wet_hire",
                    "actual_overtime_quantity": Decimal("0"),
                    "overtime_multiplier": Decimal("1.5"),
                    "created_at": now_at(0),
                    "updated_at": now_at(0),
                }
            )
    await connection.execute(insert(t.booking_charge_components).values(booking_component_rows))

    client_po_id = uid(number, "52", 1)
    billable_id = uid(number, "31", 1)
    billable_amount = Decimal("18400") * multiplier
    await connection.execute(
        insert(t.client_purchase_orders).values(
            id=client_po_id,
            organization_id=organization_id,
            client_company_id=company_id(1),
            show_id=show_id(1),
            episode_id=episode_id(6),
            po_number=f"{slug.upper()}-CLIENT-PO-001",
            currency=currency,
            approved_amount=billable_amount * Decimal("1.15"),
            issue_date=now_at(-8).date(),
            expiry_date=now_at(55).date(),
            status="active",
            notes="Client authorisation for finishing and delivery changes.",
            external_document_url=f"https://example.com/client-purchase-orders/{slug}-001",
            created_by_user_id=users[1]["id"],
        )
    )
    await connection.execute(
        insert(t.billables).values(
            id=billable_id,
            organization_id=organization_id,
            show_id=show_id(1),
            episode_id=episode_id(6),
            client_purchase_order_id=client_po_id,
            vendor="Client change",
            reference=f"{tenant['shows'][0][1]}-CHANGE-021",
            description="Finishing and clearance support",
            amount=billable_amount,
            currency=currency,
            status="approved",
            due_date=now_at(18).date(),
        )
    )
    await connection.execute(
        insert(t.client_purchase_order_allocations).values(
            id=uid(number, "53", 1),
            organization_id=organization_id,
            client_purchase_order_id=client_po_id,
            allocation_type="billable",
            billable_id=billable_id,
            amount=billable_amount,
            overrun_authorised=False,
            allocation_date=now_at(-5).date(),
            reference=f"{tenant['shows'][0][1]}-CHANGE-021",
            description="Approved finishing and clearance support",
            created_by_user_id=users[1]["id"],
        )
    )
    await connection.execute(
        insert(t.activity_log).values(
            [
                {
                    "id": uid(number, "32", 1),
                    "organization_id": organization_id,
                    "actor_user_id": users[0]["id"],
                    "action": "episode.picture_lock_approved",
                    "entity_type": "episode",
                    "entity_id": episode_id(3),
                    "metadata": {"status": "approved"},
                },
                {
                    "id": uid(number, "32", 2),
                    "organization_id": organization_id,
                    "actor_user_id": users[0]["id"],
                    "action": "qc.issue_created",
                    "entity_type": "episode",
                    "entity_id": episode_id(4),
                    "metadata": {"issue_count": 1, "risk": "high"},
                },
                {
                    "id": uid(number, "32", 3),
                    "organization_id": organization_id,
                    "actor_user_id": users[1]["id"],
                    "action": "workflow.changes_requested",
                    "entity_type": "episode",
                    "entity_id": episode_id(7),
                    "metadata": {"network": network},
                },
            ]
        )
    )


def main() -> None:
    asyncio.run(seed())


if __name__ == "__main__":
    main()
