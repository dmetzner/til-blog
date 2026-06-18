// ─────────────────────────────────────────────────────────────
//  Personal data shared with the portfolio (daniel.metzner.uk).
//  Deliberately duplicated, not packaged: the two sites are different
//  frameworks (React vs Astro), so only this small data file overlaps.
//  Keep the email split + legal text in sync with the portfolio's config.ts.
// ─────────────────────────────────────────────────────────────

export const config = {
  name: "Daniel Metzner",
  githubUser: "dmetzner",
  linkedin: "https://www.linkedin.com/in/daniel-metzner/",
  portfolio: "https://daniel.metzner.uk",

  // Email kept split into local-part + host so the full address never appears
  // verbatim in the HTML/JS — it's assembled at runtime (see scripts/site.ts),
  // which defeats naive address-harvesting bots.
  emailUser: "contact",
  emailHost: "metzner.uk",

  // Cookieless analytics (no consent banner). Reuses the portfolio's GoatCounter
  // site ("metzner" → https://metzner.goatcounter.com). Because both sites share
  // one dashboard, blog hits are recorded with the host prefixed (see Base.astro)
  // so they don't collide with the portfolio's paths. GoatCounter ignores
  // localhost, so no dev hits — that's expected. Empty string = analytics off.
  goatcounter: "metzner",

  // The EN/DE toggle only swaps the tagline (+ the always-German legal pages).
  // Everything else stays English on purpose — posts are single-language.
  tagline: {
    en: "The small stuff that quietly makes you a better dev — one note at a time.",
    de: "Das kleine Zeug, das dich nebenbei zum besseren Dev macht — Notiz für Notiz.",
  },
};
