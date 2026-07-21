# Product and operations guide

## Product boundary

PostPilot manages operational workflow for episodic television post-production. It is not a replacement for a MAM, cloud storage, transfer service, or video-review platform. Store sensitive media in the facility’s chosen system and record an external reference or secure link in PostPilot when it helps the team coordinate work.

## Core operating model

The programme structure is:

~~~text
Organisation (post house)
  └── Show
        └── Season
              └── Episode
~~~

An episode is the unit of operational work. It carries dates, the assigned team, current workflow stage, bookings, work orders, QC, delivery-manifest items, costs, activity, and relevant CRM contacts.

### Episode workflow

Each organisation configures one ordered workflow. A stage can have:

- a name and position;
- one or more required sign-off slots;
- an early-start allowance;
- a QC or delivery gate; and
- an optional terminal marker.

Each episode has one current stage and one simple state: `not_started`, `in_progress`, `awaiting_sign_off`, `blocked`, or `complete`. When the named episode-team signers have completed all required sign-offs, the episode advances to the next configured stage.

The engine does not encode named job roles. A tenant’s role policies grant capabilities, while the episode team selects the real person who signs off a stage.

Practical gates remain visible as simple blockers:

- a blocking work order prevents its linked stage signing off;
- QC-gated work requires an acceptable QC outcome or authorised waiver;
- delivery-gated work requires the relevant manifest items to be dispatched; and
- client-acceptance work requires receipt confirmation or an authorised exception.

## Operational modules

### Shows and episodes

Use shows for the programme-level view: seasons, episode health, delivery contacts, current work, workflow settings, and activity. Use the episode workspace to run the actual post process, maintain its team, and work through the episode tabs.

### Approvals

Approvals shows only the workflow work awaiting a selected episode signer. A user must have the sign-off capability and be the named signer for that episode and stage. This keeps stage sign-off tied to accountable people rather than a broad job title alone.

### Bookings and my time

Bookings are facility reservations for people and rooms. The room-centric Gantt covers edit bays, specialist finishing rooms, option holds, conflicts, booking buffers, and multi-day work.

Artists can record actual time and overtime against their assigned work. Producers and finance users can use actuals when reviewing cost or billing readiness. A work order can be dragged onto the calendar to reserve a suite and person without losing its work/billing link.

### Work orders

Work orders capture discrete operational requests that should not be hidden in a note or calendar block. They can be internal or external vendor work, linked to an episode/workflow stage, assigned to a person, and marked as blocking when the stage cannot sign off without completion.

### Quality control

QC records reports and individual issues. Issues can include severity, timecode, resolution state, and re-QC history. A failed or unresolved condition can feed correction work and block a configured workflow gate.

### Delivery manifests

Delivery profiles describe reusable requirements—such as masters, M&E, stems, captions, textless elements, metadata, recipients, territories, languages, and QC requirements. Applying a profile creates a snapshot manifest for an episode, so later profile edits do not rewrite historical episode requirements.

Delivery items carry status, due date, external reference, QC state, dispatch, and receipt confirmation. No files need to be uploaded to PostPilot.

### Budget, rates, and commercial records

Rate cards use a practical inheritance model:

~~~text
Master rate card → network/client rate card → show rate card → episode override
~~~

Bookings, actual time, work orders, and budget lines provide live commercial context. Vendor purchase orders record authorised external spend and allocations. Client purchase orders record authorised client billing. They are deliberately separate: vendor commitments must not affect client PO balances, and vice versa.

### CRM and facility services

CRM accounts represent clients, production companies, networks, studios, and vendors. Contacts can be marked for creative approval, technical delivery, finance, legal, or client review. Shows assign the appropriate named contacts.

Catering gives runners a fulfilment queue while linking the actual purchased cost to the relevant episode. It supports the operational reality that a runner may only know a cost after purchase.

## Multi-tenant and client access

An organisation is a tenant. Operational data is isolated by the active organisation, and the browser never gets to choose an organisation ID as authority.

Client accounts are a restricted external account type. They can be assigned to relevant episode teams and see only the explicitly shared approval and delivery information appropriate to their episode access. They do not gain facility schedules, internal QC notes, costs, or unshared references.

## Demo data and debug mode

The seed creates five separate demonstration post houses with their own people, rooms, shows, workflows, bookings, commercial records, QC, delivery, activity, and catering. It is idempotent for the fixed demo organisations.

`POSTPILOT_DEBUG_DEMO=true` adds clearly labelled user and organisation switchers. They use live PostgreSQL records, so edits persist while switching context. This mode is for local or controlled testing only.
