---
title: "The Firefox port I budgeted for didn't exist"
description: "One browser-extension folder loads in both Chrome and Firefox unchanged. The only real fork is how you install it permanently — and the reputations there are backwards."
pubDate: 2026-07-04
tags: ["web", "tooling", "til"]
draft: false
---

We needed a small tool at work: something to add a header to browser requests so
we could test feature flags. Every option in the stores wanted an account,
paywalled the basics, or — the one everyone reaches for — now runs ads and nudges
you toward a subscription inside what is, functionally, a developer tool.

I'd assumed that friction bought something. That the job was fiddly enough to be
worth paying for. Then I looked at what it actually takes, and the browser
already does the whole thing: a few dozen lines do the work, and everything else
is the interface around it. A weekend later we had
[Overhead](https://overhead.metzner.uk) — free, MIT, no account, no ads, plus one
convenience the paid ones don't have: it can pull our own systems' flag names
straight from a URL, so nobody has to remember or guess them.

Then I budgeted real time for the Firefox version. There wasn't one. The same
folder loads in both browsers, unchanged, with three small tricks that live
entirely in the plumbing.

Where the two genuinely differ is **installing it permanently**, and here the
reputations are backwards. Chrome has no approval step at all — and also no real
way to install a private extension: you load the folder as a developer and live
with the warning banner, unless you run company-managed browsers. Firefox
*requires* every extension to be signed, even one you're only handing to your own
team, which sounds like exactly the bureaucracy it's famous for. Except that path
is fully automated: no store page, no human reading it, no waiting. One command
in CI, and a couple of minutes later a signed file is attached to the release.
Anyone on the team drags it in, and it survives restarts.

Two catches worth knowing before you copy this. A privately signed extension
doesn't update itself — that needs an update file you host somewhere, which we
haven't bothered with. And signing is one-way: a version number can only ever be
signed once, so a botched upload means bumping the number and going again.

The rule of thumb: check whether the port you're dreading actually exists before
you plan around it.

## The three tricks, in code

Every API call goes through `globalThis.browser ?? globalThis.chrome`, which
picks the promise-based namespace on whichever browser is running. The manifest
declares the background script under *both* keys — Chromium reads
`service_worker`, Firefox reads `scripts`, and each ignores the other silently:

```json
"background": {
  "service_worker": "sw.js",
  "scripts": ["sw.js"],
  "type": "module"
}
```

The header work itself is one dynamic
[`declarativeNetRequest`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest)
rule with a `modifyHeaders` action. And the manifest sets
`browser_specific_settings.gecko.id` — under MV3, AMO no longer assigns an ID at
submission, and `storage.sync` won't work without one.

Signing runs through the unlisted channel:

```bash
npx web-ext sign --channel=unlisted \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```

The credentials come from a form on AMO. We run this from a GitHub Actions
workflow on version tags, and the signed `.xpi` lands on the release. Auto-update
would need an `update_url` in the manifest plus a self-hosted `updates.json`.

## Follow-up resources

- [Overhead](https://overhead.metzner.uk) — the extension this post is about ([source](https://github.com/dmetzner/overhead), MIT)
- [Signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) — Firefox Extension Workshop
- [Extensions and the add-on ID](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/) — why MV3 needs an explicit ID
- [`browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings) — MDN
- [web-ext command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign) — the `sign` command
- [Distribute your extension](https://developer.chrome.com/docs/extensions/how-to/distribute) — Chrome's (store-only) options
