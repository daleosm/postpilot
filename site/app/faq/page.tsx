import type { Metadata } from "next";

import { SiteShell } from "../../components/site-shell";
import { faqs } from "../../lib/content";

export const metadata: Metadata = { title: "FAQ", description: "Answers to practical questions about evaluating and self-hosting Cutluma." };

export default function FaqPage() {
  return (
    <SiteShell>
      <main id="main-content" tabIndex={-1}>
        <section className="page-hero page-hero--compact" aria-labelledby="faq-title"><p className="eyebrow">FAQ</p><h1 id="faq-title">Useful before you evaluate it.</h1><p className="lede">A few practical answers about Cutluma, workflow fit, client access, and self-hosting responsibility.</p></section>
        <section className="section faq"><div className="faq-heading"><p className="section-kicker">Questions and answers</p><h2 className="section-title">Start with the operating reality.</h2></div><div className="faq-list">{faqs.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</div></section>
      </main>
    </SiteShell>
  );
}
