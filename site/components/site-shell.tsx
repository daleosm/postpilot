import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { href: "/product", label: "Product" },
  { href: "/evaluate", label: "Evaluate" },
  { href: "/deployment", label: "Deployment" },
  { href: "/contribute", label: "Contribute" },
] as const;

export function SiteShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div id="top" className="site-page">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="shell">
        <header className="site-header">
          <Link className="wordmark" href="/" aria-label="Cutluma home">Cutluma</Link>
          <nav className="site-nav" aria-label="Main navigation">
            {navigation.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
          </nav>
          <Link className="header-link" href="/product">Product overview <span aria-hidden="true">→</span></Link>
          <details className="mobile-nav">
            <summary aria-label="Open site navigation"><span>Menu</span><span className="mobile-nav__icon" aria-hidden="true">☰</span></summary>
            <nav aria-label="Mobile navigation">
              <Link href="/">Home</Link>
              {navigation.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
              <Link href="/faq">FAQ</Link>
            </nav>
          </details>
        </header>
        {children}
        <footer className="site-footer">
          <span>Cutluma</span>
          <span>TV post-production operations software, deployable your way</span>
        </footer>
      </div>
    </div>
  );
}
