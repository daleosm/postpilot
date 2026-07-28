# Cutluma static site

This is a separate, static Next.js site for Cutluma's public product and sales material. It deliberately has no connection to the authenticated PostPilot application, FastAPI API, database, session, or product routes.

## Local development

From the repository root:

~~~bash
pnpm install
pnpm --filter @cutluma/site dev
~~~

Open [http://localhost:3100](http://localhost:3100).

## Static production build

~~~bash
pnpm --filter @cutluma/site build
~~~

Next.js writes the deployable static files to `site/out/`. They can be hosted on any static web host without a Node.js server, database, API credential, or application session.

To preview a completed static build locally:

~~~bash
pnpm --filter @cutluma/site preview
~~~

## SEO and host configuration

Set these **at build time** for a real public deployment:

~~~bash
MARKETING_SITE_URL=https://www.example.com \
NEXT_PUBLIC_CUTLUMA_APP_URL=https://app.example.com \
pnpm --filter @cutluma/site build
~~~

`MARKETING_SITE_URL` is the canonical public URL used by metadata, Open Graph,
the sitemap, and `robots.txt`. Until it is set, the site deliberately emits a
non-indexing robots policy and uses `https://www.cutluma.example` only as a
safe metadata placeholder. Do not deploy that placeholder as a public
canonical URL.

`NEXT_PUBLIC_CUTLUMA_APP_URL` sets the **Open demo** destination. It is a
public URL and is intentionally separate from the static site host.

## Deployment handoff: `www` and the application host

Deploy `site/out/` to a static host under the public site hostname,
for example `www.example.com`. This site has no application API, database,
session, or authentication dependency.

Deploy the authenticated Cutluma/PostPilot product separately, for example at
`app.example.com`. It retains its own frontend, FastAPI API, PostgreSQL,
runtime secrets, and application-origin configuration. Do not route the
site's `/v1` paths to the product API and do not use the static site build as
the authenticated application frontend.

Before enabling indexing, choose the public brand and canonical host, update
the two build-time URLs above, then rebuild and publish the generated static
files. This keeps the social image, canonical metadata, sitemap, and demo CTA
consistent with the chosen public name and host.

## Scope

The site will document the product using real demo screenshots and factual product claims only. It must remain separate from the authenticated application, which will eventually be served from an `app.` subdomain while this site is served from `www.`.
