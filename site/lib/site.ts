const placeholderMarketingUrl = "https://www.cutluma.example";
const fallbackDemoUrl = "http://postpilot-189307880.eu-west-1.elb.amazonaws.com";
const fallbackEvaluationUrl = "https://github.com/daleosm/postpilot/issues/new";

function configuredOrigin(value: string | undefined) {
  if (!value?.trim()) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function originFrom(value: string | undefined, fallback: string) {
  return configuredOrigin(value) ?? fallback;
}

function configuredPublicUrl(value: string | undefined) {
  if (!value?.trim()) return undefined;

  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const configuredMarketingUrl = configuredOrigin(process.env.MARKETING_SITE_URL);

/**
 * Public-site canonical URL. Configure MARKETING_SITE_URL before deploying
 * the static site to a real www host.
 */
export const marketingSiteUrl = originFrom(configuredMarketingUrl, placeholderMarketingUrl);
export const hasConfiguredMarketingSiteUrl = Boolean(configuredMarketingUrl);

/**
 * Authenticated application/demo host. It remains independent from www.
 */
export const demoUrl = originFrom(process.env.NEXT_PUBLIC_CUTLUMA_APP_URL, fallbackDemoUrl);

/**
 * Public evaluation or pilot contact route. It can be a hosted form, calendar,
 * email link, or CRM landing page. Until configured, GitHub Issues provides a
 * usable public route without inventing a project email address.
 */
export const evaluationUrl = configuredPublicUrl(process.env.NEXT_PUBLIC_CUTLUMA_CONTACT_URL) ?? fallbackEvaluationUrl;
