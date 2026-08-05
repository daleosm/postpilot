import type { Metadata } from "next";

import { SiteShell } from "../../components/site-shell";
import { deploymentOptions, enterpriseSelfHostedBenefits, repositoryUrl } from "../../lib/content";

export const metadata: Metadata = {
  title: "Deployment options",
  description: "Choose Cutluma Cloud or a self-hosted deployment, with an enterprise support path for facilities that run their own platform.",
};

export default function DeploymentPage() {
  return (
    <SiteShell>
      <main id="main-content" tabIndex={-1}>
        <section className="page-hero" aria-labelledby="deployment-title">
          <p className="eyebrow">Deployment options</p>
          <h1 id="deployment-title">Choose Cutluma Cloud or self-hosted control.</h1>
          <p className="lede">Use Cutluma Cloud when you want us to operate the platform, or self-host when your facility needs to run it in its own environment. In either model, Cutluma sits alongside—not inside—your media systems.</p>
        </section>
        <section className="section deployment" aria-labelledby="deployment-model-title">
          <div className="deployment-intro"><p className="section-kicker">Two ways to run the operational layer</p><h2 id="deployment-model-title" className="section-title">Cloud simplicity or self-hosted control.</h2><p className="section-copy">Choose whether Cutluma operates the platform for you or whether your facility operates it itself. The media estate remains where your facility chooses.</p></div>
          <div className="self-hosted-panel surface"><div className="self-hosted-grid">{deploymentOptions.map((option) => <article key={option.title}><h3>{option.title}</h3><p>{option.copy}</p></article>)}</div><p className="self-hosted-disclaimer">For self-hosted community deployments, the facility is responsible for its environment, backups, monitoring, upgrades, and incident response. Enterprise self-hosted adds support only where those commitments are agreed in writing.</p><div className="self-hosted-actions"><a className="button button--primary" href={repositoryUrl} target="_blank" rel="noreferrer">View deployment material <span aria-hidden="true">↗</span></a><a className="text-link" href="https://github.com/daleosm/postpilot/blob/main/docs/self-hosting.md" target="_blank" rel="noreferrer">Read technical guidance <span aria-hidden="true">↗</span></a></div></div>
        </section>
        <section className="section enterprise" aria-labelledby="enterprise-title">
          <div className="enterprise-intro"><p className="section-kicker">Enterprise self-hosted</p><h2 id="enterprise-title" className="section-title">Keep the platform in your environment, with a commercial support path.</h2><p className="section-copy">Enterprise self-hosted is designed for facilities that need the operational control of a local or customer-cloud deployment, alongside agreed engineering support and release discipline.</p></div>
          <div className="enterprise-grid">{enterpriseSelfHostedBenefits.map((benefit) => <article key={benefit.title}><h3>{benefit.title}</h3><p>{benefit.copy}</p></article>)}</div>
          <p className="enterprise-note">Service levels, release cadence, supported versions, integrations, monitoring, and any custom branding are commercial terms to agree per customer—not implied product guarantees.</p>
        </section>
      </main>
    </SiteShell>
  );
}
