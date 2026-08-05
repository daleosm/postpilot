export const repositoryUrl = "https://github.com/daleosm/postpilot";

export const operationalAreas = [
  {
    number: "01",
    title: "The episode is the operating unit",
    copy: "Keep shows, seasons, episodes, deadlines, episode teams, client contacts, and operational history together—without treating a series as a generic project.",
  },
  {
    number: "02",
    title: "Decisions move the work forward",
    copy: "Run a facility-configured workflow with named episode signers, approvals, work orders, practical QC gates, and delivery-manifest checks.",
  },
  {
    number: "03",
    title: "The facility stays commercially aware",
    copy: "Plan bookings and people, then keep budgets, rate cards, catering, CRM records, and commercial context close to the work.",
  },
] as const;

export const productModules = [
  "Shows & episodes",
  "Workflow & approvals",
  "Bookings & rooms",
  "Work orders",
  "QC exceptions",
  "Delivery manifests",
  "Budgets & rate cards",
  "Catering",
  "Client & vendor CRM",
  "Access controls",
] as const;

export const evaluationSteps = [
  {
    number: "01",
    title: "Choose a real operating problem",
    copy: "Start with a live episode handover, a finishing bottleneck, delivery visibility, or room-planning pressure—not an abstract software comparison.",
  },
  {
    number: "02",
    title: "Walk the team through the workflow",
    copy: "Use the demo to follow one episode through stages, named sign-off, work orders, bookings, QC, delivery, and commercial context.",
  },
  {
    number: "03",
    title: "Agree the smallest useful pilot",
    copy: "Define the people, episodes, deployment approach, and operational outcome that would make a pilot worth continuing.",
  },
] as const;

export const designPartnerFocus = [
  "Producer and post-supervisor workflow fit",
  "Room, artist, and late-change coordination",
  "QC, delivery, and client handover visibility",
  "Commercial controls that reflect actual facility practice",
] as const;

export const contributorActions = [
  {
    title: "Run and inspect the project",
    copy: "Use the repository documentation to understand the application, API, database, testing, and deployment paths before proposing a change.",
  },
  {
    title: "Start with a focused improvement",
    copy: "Raise an issue or pull request around a real operational problem, a test gap, documentation, accessibility, or deployment reliability.",
  },
  {
    title: "Choose licensing before broad adoption",
    copy: "The project is licensed under GNU AGPLv3. Review the licence before operating or distributing a modified version, especially when it is available to users over a network.",
  },
] as const;

export const deploymentOptions = [
  {
    title: "Cutluma Cloud",
    copy: "Use Cutluma as a cloud-operated service when the facility wants the operational platform run for it. Project media remains in the storage, MAM, transfer, and review systems the facility already trusts.",
  },
  {
    title: "Self-hosted",
    copy: "Run Cutluma on facility infrastructure or in a facility-controlled cloud account. The AGPLv3 community edition provides the source and deployment material; enterprise self-hosted adds a supported commercial path.",
  },
] as const;

export const enterpriseSelfHostedBenefits = [
  {
    title: "Hardened release process",
    copy: "A separately managed enterprise release channel can add defined QA, security review, and release-readiness checks before a facility adopts an update.",
  },
  {
    title: "Security and lifecycle commitments",
    copy: "The support agreement can define supported versions, security-patch handling, and the maintenance window that a facility needs for its operating environment.",
  },
  {
    title: "Support and escalation",
    copy: "A commercial agreement can provide named technical contacts, defined response targets, incident escalation, and deployment guidance for the facility’s own infrastructure.",
  },
  {
    title: "Enterprise deployment support",
    copy: "Enterprise work can cover identity integration, platform hardening, observability, performance planning, and a deployment review—scoped to the facility’s environment.",
  },
] as const;

export const featureSections = [
  {
    id: "workflow",
    kicker: "Workflow and approvals",
    title: "Make the next sign-off unambiguous.",
    problem: "Episode decisions can disappear into notes, inboxes, and verbal handovers—leaving the team unsure who owns the next move.",
    result: "An ordered episode path shows the active stage, selected signers, practical blockers, and the exact approval needed to move on.",
    image: "/screenshots/prepared/cutluma-episode-workflow.webp",
    fallback: "/screenshots/prepared/cutluma-episode-workflow.png",
    alt: "Cutluma episode workflow view showing stage progress and workflow actions for a seeded TV episode.",
  },
  {
    id: "bookings",
    kicker: "Bookings and resource planning",
    title: "Keep rooms and artists bookable in reality.",
    problem: "A post schedule must account for rooms, people, holds, buffers, and episode work at the same time—not just calendar events.",
    result: "Room-centred Gantt planning makes confirmed work, pencil holds, reservations, conflicts, and multi-day sessions visible before a producer commits time.",
    image: "/screenshots/prepared/cutluma-bookings-gantt.webp",
    fallback: "/screenshots/prepared/cutluma-bookings-gantt.png",
    alt: "Cutluma bookings Gantt calendar showing rooms, dates, confirmed bookings, pencil holds, work reservations, and conflicts.",
  },
  {
    id: "work-orders",
    kicker: "Work orders and actual time",
    title: "Turn a request into accountable work.",
    problem: "Small fixes and late requests are easy to lose when they are only messages, and their time is difficult to trace back to the episode.",
    result: "Work orders place the assignment, owner, workflow context, booking reservation, actual time, and billable status in one operational record.",
    image: "/screenshots/prepared/cutluma-work-orders.webp",
    fallback: "/screenshots/prepared/cutluma-work-orders.png",
    alt: "Cutluma episode work orders view with seeded operational tasks and their workflow context.",
  },
  {
    id: "delivery",
    kicker: "QC and delivery manifests",
    title: "Know what is ready to leave the facility.",
    problem: "A passed QC report is not the same as having every required master, caption, stem, version, and receipt ready for a recipient.",
    result: "Episode delivery manifests make requirements, QC state, dispatch references, deadline risk, and recipient receipt progress visible together.",
    image: "/screenshots/prepared/cutluma-delivery-manifest.webp",
    fallback: "/screenshots/prepared/cutluma-delivery-manifest.png",
    alt: "Cutluma delivery manifest showing a seeded delivery profile, required items, readiness, dispatch, and client receipt state.",
  },
  {
    id: "budgets",
    kicker: "Budgets and rate cards",
    title: "Price work from the facility’s live rate logic.",
    problem: "If estimates, room time, artist time, and overrides are detached from operations, a budget becomes a delayed spreadsheet rather than a decision tool.",
    result: "Master, client, show, and episode rate cards support controlled overrides while budget views stay tied to real operational work and actuals.",
    image: "/screenshots/prepared/cutluma-budget-rate-cards.webp",
    fallback: "/screenshots/prepared/cutluma-budget-rate-cards.png",
    alt: "Cutluma budget portfolio with the service rate card management panel open.",
  },
  {
    id: "crm",
    kicker: "Client and vendor CRM",
    title: "Keep the right external contact close to the work.",
    problem: "Approval, delivery, finance, legal, and supplier contacts are often spread across individual address books and disconnected from the show.",
    result: "Client and vendor accounts bring operational contacts, account gaps, relationship ownership, and commercial context into the facility record.",
    image: "/screenshots/prepared/cutluma-client-vendor-crm.webp",
    fallback: "/screenshots/prepared/cutluma-client-vendor-crm.png",
    alt: "Cutluma client and vendor CRM directory showing account follow-ups, contact gaps, and operational relationship context.",
  },
  {
    id: "catering",
    kicker: "Catering and runner operations",
    title: "Support the post floor without losing episode context.",
    problem: "Runners should not need to interrupt artists for every meal or refreshments request, and ad-hoc spend still needs a clear episode connection.",
    result: "Room-based catering requests use an active booking or assigned work order to keep the request practical for runners and attributable to the correct episode.",
    image: "/screenshots/prepared/cutluma-catering-runner-operations.webp",
    fallback: "/screenshots/prepared/cutluma-catering-runner-operations.png",
    alt: "Cutluma catering request screen showing room selection and a seeded post-floor hospitality workflow.",
  },
] as const;

export const faqs = [
  {
    question: "Does Cutluma host cuts, masters, or project media?",
    answer: "No. Cutluma is workflow-first software. It records operational metadata and can hold external references, while facilities keep media in the storage, MAM, transfer, and review systems they already use.",
  },
  {
    question: "Can a facility configure its own workflow and access policy?",
    answer: "Yes. Each facility can use an ordered workflow, configurable sign-off slots, role policies, and capability-based access. Episode teams select the people who sign off work.",
  },
  {
    question: "Can it be self-hosted?",
    answer: "Yes. Cutluma can be deployed as managed cloud, into a customer-controlled cloud environment, or on facility infrastructure. The project includes local development guidance plus Docker and AWS/EKS deployment material. In a customer-managed deployment, the facility owns backups, upgrades, monitoring, and incident response.",
  },
  {
    question: "How is client access controlled?",
    answer: "Client accounts can be limited to the shows and episodes relevant to them. Facility teams set access through account membership, episode assignments, and capability policies.",
  },
  {
    question: "How can a facility evaluate Cutluma?",
    answer: "Start with one real operating pain point and a small pilot hypothesis. The product demo is useful for understanding the workflow, while a pilot should define its own people, episode scope, deployment approach, and success criteria.",
  },
] as const;
