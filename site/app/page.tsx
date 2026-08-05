import Link from "next/link";

import { SiteShell } from "../components/site-shell";
import { operationalAreas, productModules, repositoryUrl } from "../lib/content";
import { demoUrl, evaluationUrl } from "../lib/site";

export default function HomePage() {
  return (
    <SiteShell>
      <main id="main-content" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Workflow software for episodic TV post</p>
          <h1 id="hero-title">Run every episode. Keep the facility in sync.</h1>
          <p className="lede">Cutluma brings shows, episodes, approvals, bookings, work orders, QC, delivery manifests, budgets, catering, and CRM into one operational system for post-production facilities.</p>
          <div className="hero-actions">
            <a className="button button--primary" href={evaluationUrl} target="_blank" rel="noreferrer">Start a facility evaluation <span aria-hidden="true">↗</span></a>
            <a className="button button--secondary" href={demoUrl} target="_blank" rel="noreferrer">Explore the demo <span aria-hidden="true">↗</span></a>
          </div>
          <p className="hero-note">Workflow-first and designed to work alongside the media systems a facility already trusts. Review the source and deployment material on <a href={repositoryUrl} target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>.</p>
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
            <article><span>Fragmented context</span><p>Schedules, sign-offs, room time, delivery requirements, and cost are usually spread across disconnected tools.</p></article>
            <article><span>Episode-level reality</span><p>Teams, signers, bookings, and commercial exposure can change from one episode to the next inside the same show.</p></article>
            <article><span>Operational handover</span><p>The decision to move work forward needs a clear record of who did what, what is blocked, and what comes next.</p></article>
          </div>
        </section>

        <section className="section home-product" aria-labelledby="product-title">
          <p className="section-kicker">Product overview</p>
          <h2 id="product-title" className="section-title">One operational record for the season, the facility, and the handoff.</h2>
          <p className="section-copy product-overview-copy">Plan the work, control sign-off, schedule the resources, track exceptions, and keep client-facing delivery and commercial information connected to the episode.</p>
          <div className="product-module-list" aria-label="Product areas">{productModules.map((module) => <span key={module}>{module}</span>)}</div>
          <div className="operation-list">{operationalAreas.map((area) => <article key={area.number} className="operation-row"><span className="operation-number">{area.number}</span><div><h3>{area.title}</h3><p>{area.copy}</p></div></article>)}</div>
          <Link className="button button--secondary section-action" href="/product">Explore the product <span aria-hidden="true">→</span></Link>
        </section>

        <section className="section home-evaluation surface" aria-labelledby="evaluation-title">
          <p className="section-kicker">Facility evaluation</p>
          <h2 id="evaluation-title" className="section-title">Start with the work that is hard to coordinate today.</h2>
          <p className="section-copy">Use the demo to look at a real operational path, then decide whether a small, focused facility pilot is worth defining.</p>
          <div className="hero-actions">
            <Link className="button button--primary" href="/evaluate">Plan an evaluation <span aria-hidden="true">→</span></Link>
            <Link className="text-link" href="/deployment">Explore deployment options <span aria-hidden="true">→</span></Link>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
