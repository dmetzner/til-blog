---
title: "Bot-proofing auth on a static site: Turnstile + Supabase, in the right order"
description: "No server of your own, but you still need to stop mass signups. Cloudflare Turnstile + Supabase does it — as long as you deploy the two halves in the order that doesn't lock everyone out."
pubDate: 2026-07-24
tags: ["security", "web", "til"]
draft: false
---

[Verso](https://verso.metzner.uk) has accounts now — email + password, via
Supabase Auth. The moment you have a public signup form with no server of your
own in front of it, you have a bot problem: someone will find the endpoint and
create ten thousand junk accounts, burning your free-tier quota for fun.

The fix is [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/),
a privacy-friendly CAPTCHA (no Google, usually invisible). What I actually
learned wiring it in was less about the widget and more about the *order* you turn
things on — get it wrong and you lock out every real user too.

## How the two halves fit together

Turnstile is a client widget + a server verification, and Supabase slots neatly
into both ends. The widget renders in the form and hands you a token; you pass
that token to Supabase, and Supabase verifies it server-side with your secret
before it will create the account:

```ts
// client: the widget's callback stashes a token, which the signup call forwards
export async function signUp(email: string, password: string, captchaToken?: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: captchaToken ? { captchaToken } : undefined
  });
}
```

You never verify the token yourself. The site key is public (it's in the widget);
the **secret** goes into Supabase → Auth → Attack Protection, and Supabase calls
Cloudflare's `siteverify` for you. That's the whole appeal — the "server side" of
a CAPTCHA runs inside a backend you didn't have to build.

Loading the widget script is best-effort, so a blocked CDN can't wedge the form:

```ts
s.onerror = () => resolve(); // don't hang the login form if the script is blocked
```

## The sharp edge: deploy the client *before* flipping the switch

Here's the mistake that's very easy to make and very annoying to debug. There are
two independent switches:

1. **Client** sends a `captchaToken` (you deploy the widget).
2. **Server** *requires* a `captchaToken` (you enable CAPTCHA in Supabase).

If you flip switch 2 before switch 1 is live, Supabase starts rejecting every
signup that arrives without a token — which is *all of them*, including yours,
until the new client is deployed. You've locked out the whole world with a
setting toggle.

So the order is non-negotiable:

1. Ship the client that renders Turnstile and forwards the token. Verify real
   signups still work (server isn't enforcing yet, token is just along for the
   ride).
2. *Then* enable CAPTCHA server-side in Supabase.

Same discipline applies to turning it *off*: relax the server first, then remove
the widget. Always widen before you narrow.

## Every test hostname must be on the widget's allow-list

The second thing that bit me: a Turnstile widget is pinned to a list of
hostnames, and it silently refuses to solve on any domain that isn't on it. A
static site like this one gets deployed to *several* domains at once:

- the custom domain (`verso.metzner.uk`)
- the platform preview domain (`*.pages.dev` on Cloudflare Pages)
- `localhost` for local dev

Miss one and the widget just… doesn't work there, with no obvious error — you sit
staring at a challenge that never completes. Add every hostname you'll ever load
the form on to the widget config up front. The site key itself is fine to commit;
it's public by design:

```ts
// the public site key; the matching SECRET lives in Supabase, never in the repo
export const TURNSTILE_SITE_KEY = '0x4AAAAAAD6B0V8C7RunRZin';
export const captchaOn = TURNSTILE_SITE_KEY.length > 0;
```

An empty key means the feature is off — no widget, no third-party request, signup
just works without a token. Handy for keeping the whole thing togglable.

## Two smaller decisions worth calling out

**Email confirmation vs. instant login.** Supabase can require users to click a
link in a confirmation email before their account works. That's real bot friction
— but it also means running outbound email, and a confirmation step is a wall new
users bounce off. Verso keeps confirmations off for now (no outbound mail set up)
and leans on Turnstile as the gate; the login form still handles the
"not confirmed yet" case so flipping it on later is a config change, not a
rewrite.

**Don't leak *why* a login failed.** When sign-in fails, the form shows one
generic "check your email and password" message rather than "no such user" or
"wrong password." Distinguishing the two tells an attacker which emails are
registered — a free account-enumeration oracle. The one exception is that a
CAPTCHA failure gets its own message, because that one's actionable by a real
user:

```ts
if (s.includes('captcha')) return t('auth.errCaptcha');
if (s.includes('not confirmed')) return t('auth.errUnconfirmed');
if (s.includes('password') || s.includes('email')) return t('auth.error'); // generic
```

## The takeaway

You can bolt real bot protection onto a serverless static site without running
anything yourself — Turnstile does the challenge, Supabase does the verification.
The only genuinely dangerous part is operational: **widen access before you
restrict it.** Deploy the client that sends the token, confirm it works, *then*
make the server demand it. Do it the other way round and your first "test" is
locking yourself out of your own app.
