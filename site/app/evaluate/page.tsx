import type { Metadata } from "next";

import { SiteShell } from "../../components/site-shell";
import { designPartnerFocus, evaluationSteps } from "../../lib/content";
import { demoUrl, evaluationUrl } from "../../lib/site";

export const metadata: Metadata = { title: "Evaluate", description: "Use a real facility operating problem to evaluate Cutluma through a small, focused pilot." };

export default function EvaluatePage() {
  return (
    <SiteShell>
      <main id="main-content" tabIndex={-1}>
        <section className="page-hero" aria-labelledby="evaluate-title">
          <p className="eyebrow">Facility evaluation</p>
          <h1 id="evaluate-title">Evaluate the operational change, not a feature checklist.</h1>
          <p className="lede">A useful conversation starts with the work that is hard to coordinate today. Cutluma is best evaluated against a real episode, real handoffs, and the people who own them.</p>
          <div className="hero-actions"><a className="button button--primary" href={evaluationUrl} target="_blank" rel="noreferrer">Discuss a pilot <span aria-hidden="true">↗</span></a><a className="button button--secondary" href={demoUrl} target="_blank" rel="noreferrer">Explore the demo <span aria-hidden="true">↗</span></a></div>
        </section>
        <section className="section evaluation" aria-label="Suggested facility evaluation path">
          <div className="evaluation-grid">{evaluationSteps.map((step) => <article key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.copy}</p></article>)}</div>
        </section>
        <section className="section roadmap" aria-labelledby="roadmap-title">
          <div className="roadmap-intro"><p className="section-kicker">Design partners</p><h2 id="roadmap-title" className="section-title">Build the operating system with the people who run the floor.</h2><p className="section-copy">Cutluma is looking for facilities willing to pressure-test the product against real post-production practice. The aim is to validate useful operating habits before claiming broad fit.</p></div>
          <div className="roadmap-panel surface"><div><p className="register-label">Current design-partner focus</p><ul className="roadmap-list">{designPartnerFocus.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="roadmap-callout"><p className="register-label">For facilities and investors</p><p>See a transparent product, source, test, and deployment story—then decide whether the next milestone solves a problem worth validating together.</p><a className="text-link" href={evaluationUrl} target="_blank" rel="noreferrer">Start the conversation <span aria-hidden="true">↗</span></a></div></div>
        </section>
      </main>
    </SiteShell>
  );
}
