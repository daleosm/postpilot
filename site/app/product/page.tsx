import type { Metadata } from "next";

import { FeatureSections } from "../../components/feature-sections";
import { SiteShell } from "../../components/site-shell";
import { productModules } from "../../lib/content";

export const metadata: Metadata = { title: "Product", description: "Explore Cutluma's workflow, bookings, work orders, delivery, commercial, CRM, and runner operations." };

export default function ProductPage() {
  return (
    <SiteShell>
      <main id="main-content" tabIndex={-1}>
        <section className="page-hero" aria-labelledby="product-title">
          <p className="eyebrow">Product</p>
          <h1 id="product-title">One operational record from edit through delivery.</h1>
          <p className="lede">Cutluma connects episode workflow, resource planning, delivery readiness, and commercial context without trying to replace a facility’s media systems.</p>
          <div className="product-module-list" aria-label="Product areas">{productModules.map((module) => <span key={module}>{module}</span>)}</div>
        </section>
        <FeatureSections />
      </main>
    </SiteShell>
  );
}
