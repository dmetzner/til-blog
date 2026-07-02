import { config } from "../config";

// ── Theme: system → light → dark, persisted, live-follows OS in system mode.
// Ported from the portfolio's useTheme.ts. The no-flash first paint is handled
// by the inline bootstrap in Base.astro; this wires up the toggle afterwards.
type Pref = "system" | "light" | "dark";
const KEY = "theme";
const ORDER: Pref[] = ["system", "light", "dark"];
const root = document.documentElement;

const systemTheme = (): "light" | "dark" =>
  matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

const storedPref = (): Pref => {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
};

function applyPref(pref: Pref) {
  if (pref === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, pref);
  root.dataset.themePref = pref;
  root.dataset.theme = pref === "system" ? systemTheme() : pref;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", root.dataset.theme === "light" ? "#f4f4f6" : "#070708");
}

applyPref(storedPref());

// In system mode, follow OS changes live.
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (storedPref() === "system") root.dataset.theme = systemTheme();
});

document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const next = ORDER[(ORDER.indexOf(storedPref()) + 1) % ORDER.length];
  applyPref(next);
});

// ── Language: EN/DE. Only the tagline + legal pages react (CSS via data-lang);
// the rest of the UI stays English. First paint is set by the inline bootstrap.
function applyLang(lang: "en" | "de") {
  localStorage.setItem("lang", lang);
  root.dataset.lang = lang; // document stays lang="en"; only fragments toggle
}
for (const btn of document.querySelectorAll<HTMLElement>("[data-set-lang]")) {
  btn.addEventListener("click", () => applyLang(btn.dataset.setLang === "de" ? "de" : "en"));
}

// ── Email assembled at runtime (never verbatim in the HTML → bot-resistant).
const email = `${config.emailUser}@${config.emailHost}`;

const copyBtn = document.querySelector<HTMLButtonElement>("[data-copy-email]");
copyBtn?.addEventListener("click", () => {
  const label = copyBtn.querySelector("[data-email-label]");
  navigator.clipboard?.writeText(email).then(() => {
    if (!label) return;
    const prev = label.textContent;
    label.textContent = "copied ✓";
    setTimeout(() => {
      label.textContent = prev;
    }, 1800);
  });
});

// Legal "email" links reveal the address (and a mailto) only on click.
for (const a of document.querySelectorAll<HTMLAnchorElement>("[data-email-link]")) {
  a.addEventListener("click", (e) => {
    if (a.dataset.revealed) return; // second click follows the real mailto
    e.preventDefault();
    a.textContent = email;
    a.href = `mailto:${email}`;
    a.dataset.revealed = "1";
  });
}

// ── Share: native share sheet where available, copy-link fallback otherwise.
const shareBtn = document.querySelector<HTMLButtonElement>("[data-share]");
shareBtn?.addEventListener("click", async () => {
  const url = location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: document.title, url });
    } catch {
      // user dismissed the share sheet — nothing to do
    }
    return;
  }
  const label = shareBtn.querySelector("[data-share-label]");
  try {
    await navigator.clipboard?.writeText(url);
    if (label) {
      const prev = label.textContent;
      label.textContent = "link copied ✓";
      setTimeout(() => {
        label.textContent = prev;
      }, 1800);
    }
  } catch {
    // clipboard blocked — leave the label as is
  }
});

// ── Code blocks: a copy button on each fenced block in a post.
for (const pre of document.querySelectorAll<HTMLElement>(".prose pre")) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "code-copy mono";
  btn.textContent = "copy";
  btn.addEventListener("click", () => {
    const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
    navigator.clipboard?.writeText(code).then(() => {
      btn.textContent = "copied ✓";
      setTimeout(() => {
        btn.textContent = "copy";
      }, 1500);
    });
  });
  pre.appendChild(btn);
}

// ── Legal modal (Impressum / Datenschutz).
const overlay = document.querySelector<HTMLElement>("[data-legal-overlay]");
const panels = document.querySelectorAll<HTMLElement>("[data-legal]");

let lastFocused: HTMLElement | null = null;

function openLegal(kind: string) {
  if (!overlay) return;
  for (const p of panels) p.hidden = p.dataset.legal !== kind;
  overlay.hidden = false;
  lastFocused = document.activeElement as HTMLElement;
  overlay.querySelector<HTMLElement>("[data-close-legal]")?.focus();
}
function closeLegal() {
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  lastFocused?.focus(); // return focus to the trigger
}

for (const btn of document.querySelectorAll<HTMLElement>("[data-open-legal]")) {
  btn.addEventListener("click", () => openLegal(btn.dataset.openLegal ?? ""));
}
document.querySelector("[data-close-legal]")?.addEventListener("click", closeLegal);
overlay?.addEventListener("click", (e) => {
  if (e.target === overlay) closeLegal();
});
addEventListener("keydown", (e) => {
  if (!overlay || overlay.hidden) return;
  if (e.key === "Escape") {
    closeLegal();
    return;
  }
  // Trap Tab within the open dialog so focus can't walk to the page behind it.
  if (e.key === "Tab") {
    const focusable = overlay.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const visible = [...focusable].filter((el) => el.offsetParent !== null);
    if (visible.length === 0) return;
    const first = visible[0];
    const last = visible[visible.length - 1];
    const active = document.activeElement as HTMLElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
