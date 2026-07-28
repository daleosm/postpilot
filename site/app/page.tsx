const operationalAreas = [
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
];

const productModules = [
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
];

const selfHostingPoints = [
  {
    title: "Run it on your infrastructure",
    copy: "Cutluma is a Next.js frontend and FastAPI backend backed by PostgreSQL. A facility can run it behind its own HTTPS reverse proxy, on a VM, a container platform, or internal infrastructure.",
  },
  {
    title: "Keep operational data under facility control",
    copy: "The facility chooses where its PostgreSQL data, deployment secrets, backups, access controls, and operational references live. Self-hosting transfers operational responsibility as well as control.",
  },
  {
    title: "Inspect, improve, and contribute",
    copy: "The source is available for teams to inspect, diagnose, patch, and contribute improvements through the repository—rather than relying on a single hosted vendor to resolve every issue.",
  },
  {
    title: "Choose a deployment path that fits",
    copy: "The repository includes Dockerfiles for container builds and an AWS/EKS pilot path using Terraform, EKS, RDS, ECR, GitHub Actions, and Argo CD. The supplied EKS setup is documented as a cost-conscious pilot, not an automatic high-availability production design.",
  },
];

const repositoryUrl = "https://github.com/daleosm/postpilot";

const featureSections = [
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
];

const faqs = [
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
    answer: "Yes. The project is designed to run with a PostgreSQL database the facility controls. The repository includes local development guidance plus Docker and AWS/EKS deployment material.",
  },
  {
    question: "How is client access controlled?",
    answer: "Client accounts can be limited to the shows and episodes relevant to them. Facility teams set access through account membership, episode assignments, and capability policies.",
  },
];

export default function MarketingHome() {
  return (
    <div id="top" className="site-page">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="shell">
        <header className="site-header">
          <a className="wordmark" href="#top" aria-label="Cutluma home">
            Cutluma
          </a>
          <nav className="site-nav" aria-label="Main navigation">
            <a href="#workflow">Workflow</a>
            <a href="#bookings">Bookings</a>
            <a href="#budgets">Budget</a>
            <a href="#self-hosted">Self-hosted</a>
          </nav>
          <a className="header-link" href="#product">
            Product overview <span aria-hidden="true">↓</span>
          </a>
          <details className="mobile-nav">
            <summary aria-label="Open site navigation">
              <span>Menu</span><span className="mobile-nav__icon" aria-hidden="true">☰</span>
            </summary>
            <nav aria-label="Mobile navigation">
              <a href="#product">Product overview</a>
              <a href="#workflow">Workflow</a>
              <a href="#bookings">Bookings</a>
              <a href="#budgets">Budget</a>
              <a href="#self-hosted">Self-hosted</a>
              <a href="#faq">FAQ</a>
            </nav>
          </details>
        </header>

        <main id="main-content" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Open-source workflow software for episodic TV post</p>
          <h1 id="hero-title">Run every episode. Keep the facility in sync.</h1>
          <p className="lede">
            Cutluma brings shows, episodes, approvals, bookings, work orders, QC, delivery manifests, budgets, catering, and CRM into one operational system for post-production facilities.
          </p>
          <div className="hero-actions">
            <a className="button button--primary" href={demoUrl} target="_blank" rel="noreferrer">Open demo <span aria-hidden="true">↗</span></a>
            <a className="button button--secondary" href={repositoryUrl} target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
          </div>
          <p className="hero-note">Self-hosted, workflow-first, and designed to work alongside the media systems a facility already trusts.</p>
        </section>

        <section className="section section--intro" aria-labelledby="audience-title">
          <div className="section-intro-grid">
            <p className="section-kicker">Built for the operational side of post</p>
            <div>
              <h2 id="audience-title" className="section-title">For the people keeping a season moving.</h2>
              <p className="section-copy">Post supervisors, producers, editors, assistants, finishing, sound, VFX, QC, delivery, finance, runners, and client teams work from the same episode context—with access shaped around their actual responsibility.</p>
            </div>
          </div>
          <div className="problem-grid" aria-label="Operational problems Cutluma addresses">
            <article>
              <span>Fragmented context</span>
              <p>Schedules, sign-offs, room time, delivery requirements, and cost are usually spread across disconnected tools.</p>
            </article>
            <article>
              <span>Episode-level reality</span>
              <p>Teams, signers, bookings, and commercial exposure can change from one episode to the next inside the same show.</p>
            </article>
            <article>
              <span>Operational handover</span>
              <p>The decision to move work forward needs a clear record of who did what, what is blocked, and what comes next.</p>
            </article>
          </div>
        </section>

        <section id="product" className="section" aria-labelledby="product-title">
          <p className="section-kicker">Product overview</p>
          <h2 id="product-title" className="section-title">One operational record for the season, the facility, and the handoff.</h2>
          <p className="section-copy product-overview-copy">Plan the work, control sign-off, schedule the resources, track exceptions, and keep client-facing delivery and commercial information connected to the episode.</p>
          <div className="product-module-list" aria-label="Product areas">
            {productModules.map((module) => <span key={module}>{module}</span>)}
          </div>
          <div className="operation-list">
            {operationalAreas.map((area) => (
              <article key={area.number} className="operation-row">
                <span className="operation-number">{area.number}</span>
                <div>
                  <h3>{area.title}</h3>
                  <p>{area.copy}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {featureSections.map((feature, index) => (
          <section id={feature.id} className={`section feature-section feature-section--${index % 2 === 0 ? "image-right" : "image-left"}`} aria-labelledby={`${feature.id}-title`} key={feature.id}>
            <div className="feature-section__copy">
              <p className="section-kicker">{feature.kicker}</p>
              <h2 id={`${feature.id}-title`} className="section-title">{feature.title}</h2>
              <div className="feature-section__detail">
                <p className="feature-section__label">Operational problem</p>
                <p>{feature.problem}</p>
              </div>
              <div className="feature-section__detail feature-section__detail--result">
                <p className="feature-section__label">Practical result</p>
                <p>{feature.result}</p>
              </div>
            </div>
            <a className="feature-shot" href={feature.image} target="_blank" rel="noreferrer" aria-label={`Open the ${feature.kicker} product screenshot`}>
              <picture>
                <source srcSet={feature.image} type="image/webp" />
                <img src={feature.fallback} alt={feature.alt} width="1035" height="648" loading={index === 0 ? "eager" : "lazy"} decoding="async" />
              </picture>
              <span>Open real product screen <b aria-hidden="true">↗</b></span>
            </a>
          </section>
        ))}

        <section id="self-hosted" className="section self-hosted" aria-labelledby="self-hosted-title">
          <div className="self-hosted-panel surface">
            <p className="section-kicker">Self-hosted and open source</p>
            <h2 id="self-hosted-title" className="section-title">Keep the operational system under facility control.</h2>
            <p className="section-copy">Cutluma is workflow-first software, not a media-hosting platform. Facilities can retain project media in their existing storage, MAM, transfer, and review systems while running the operational layer themselves.</p>
            <div className="self-hosted-grid">
              {selfHostingPoints.map((point) => (
                <article key={point.title}>
                  <h3>{point.title}</h3>
                  <p>{point.copy}</p>
                </article>
              ))}
            </div>
            <p className="self-hosted-disclaimer">Self-hosting does not provide automatic uptime, compliance certification, or managed support. Each facility remains responsible for its deployment, monitoring, backups, security, upgrades, and incident response.</p>
            <div className="self-hosted-actions">
              <a className="button button--primary" href={repositoryUrl} target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
              <a className="text-link" href="https://github.com/daleosm/postpilot/blob/main/docs/self-hosting.md" target="_blank" rel="noreferrer">Read self-hosting guidance <span aria-hidden="true">↗</span></a>
            </div>
          </div>
        </section>

        <section id="faq" className="section faq" aria-labelledby="faq-title">
          <div className="faq-heading">
            <p className="section-kicker">FAQ</p>
            <h2 id="faq-title" className="section-title">Useful before you evaluate it.</h2>
          </div>
          <div className="faq-list">
            {faqs.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="section final-cta" aria-labelledby="cta-title">
          <p className="section-kicker">Cutluma</p>
          <h2 id="cta-title">A clearer way to run episodic post-production.</h2>
          <p>Explore the source, follow the build, and help shape the operational tool post houses need.</p>
          <div className="hero-actions">
            <a className="button button--primary" href={repositoryUrl} target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
            <a className="button button--secondary" href="#top">Back to top <span aria-hidden="true">↑</span></a>
          </div>
        </section>
        </main>

        <footer className="site-footer">
          <span>Cutluma</span>
          <span>Open-source TV post-production operations software</span>
        </footer>
      </div>
    </div>
  );
}
import { demoUrl } from "../lib/site";
