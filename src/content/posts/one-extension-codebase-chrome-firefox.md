---
title: "One extension codebase for Chrome and Firefox — signing is the only real fork"
description: "The same unpacked MV3 folder loads in both browsers; the divergence is how you get a permanent install, and Firefox's signing story is friendlier than its reputation."
pubDate: 2026-07-04
tags: ["web", "tooling", "til"]
draft: false
---

We needed a header-injection extension at work for feature-flag testing, and
every existing one seemed to bundle ads or worse. So we built our own — a
small, public MV3 devtool that injects request headers, with one convenience
the others lack: it imports the known feature-flag headers of our systems
straight from an endpoint or a JSON file, so nobody has to guess header names.
I budgeted real time for "the Firefox port". There wasn't one. The same folder
loads unpacked in Chrome and as a temporary add-on in Firefox, unchanged.

Three tricks carry it. Every API call goes through
`globalThis.browser ?? globalThis.chrome`, which picks the promise-based
WebExtension namespace on whichever browser is running. The manifest declares
the background script under *both* keys — Chromium reads `service_worker`,
Firefox reads `scripts`, and each silently ignores the one it doesn't
understand:

```json
"background": {
  "service_worker": "sw.js",
  "scripts": ["sw.js"],
  "type": "module"
}
```

And the manifest sets `browser_specific_settings.gecko.id` — for MV3, AMO no
longer assigns an ID at submission, and `storage.sync` won't work without one.

Where the browsers genuinely fork is **distribution**. For a self-distributed
tool you don't need a public store listing on either side, and here the
reputations are backwards. Chrome has no signing step at all — but also
effectively no self-distribution path: load-unpacked is it (persistent, but
with a developer-mode nag), unless you control enterprise policies. Firefox
*requires* signing even for self-distributed
add-ons, which sounds like bureaucracy — except the **unlisted channel** is
fully automated. Automated validation, immediate signature, no human review,
no store page. One CI step:

```bash
npx web-ext sign --channel=unlisted \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```

The API credentials come from a form on AMO. We wired this into a GitHub
Actions workflow on version tags; a signed `.xpi` lands on the release a
couple of minutes later, and anyone on the team drags it into Firefox for an
install that survives restarts. So the browser famous for strict signing ends
up with the *smoother* permanent-install story for self-distributed tools.

The catch: an unlisted `.xpi` doesn't auto-update — that needs an `update_url`
in the manifest plus a self-hosted `updates.json`, which we haven't bothered
with yet. And signing is forever-ish: each version number can only be signed
once per channel, so a botched upload means bumping the version.

Rule of thumb: write against `browser ?? chrome`, declare the background
script twice, set a gecko ID from day one — and stop treating Firefox signing
as a reason to ship Chrome-only.

## Follow-up resources

- [Signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) — Firefox Extension Workshop
- [Extensions and the add-on ID](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/) — why MV3 needs an explicit ID
- [`browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings) — MDN
- [web-ext command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign) — the `sign` command
- [Distribute your extension](https://developer.chrome.com/docs/extensions/how-to/distribute) — Chrome's (store-only) options
