import type { Metadata } from "next";

import { SiteShell } from "../../components/site-shell";
import { contributorActions, repositoryUrl } from "../../lib/content";

export const metadata: Metadata = { title: "Contribute", description: "Inspect Cutluma's source, operating choices, and contribution path." };

export default function ContributePage() {
  return (
    <SiteShell>
      <main id="main-content" tabIndex={-1}>
        <section className="page-hero" aria-labelledby="contribute-title"><p className="eyebrow">Build in public</p><h1 id="contribute-title">Make the source, operating choices, and next decisions inspectable.</h1><p className="lede">Cutluma is designed for thoughtful technical and operational feedback from people who understand the reality of TV post-production.</p></section>
        <section className="section contribution"><div className="contribution-grid">{contributorActions.map((action) => <article key={action.title}><h3>{action.title}</h3><p>{action.copy}</p></article>)}</div><div className="contribution-actions"><a className="button button--secondary" href={repositoryUrl} target="_blank" rel="noreferrer">Explore the repository <span aria-hidden="true">↗</span></a><a className="text-link" href="https://github.com/daleosm/postpilot/blob/main/docs/contributing.md" target="_blank" rel="noreferrer">Read the contribution guide <span aria-hidden="true">↗</span></a></div></section>
      </main>
    </SiteShell>
  );
}
