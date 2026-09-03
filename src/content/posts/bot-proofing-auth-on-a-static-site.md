---
title: "I locked myself out of my own app with one toggle"
description: "A static site can have real signup protection without running a server of your own. The dangerous part isn't the setup — it's the order you switch the two halves on."
pubDate: 2026-07-24
tags: ["security", "web", "til"]
draft: false
---

[Verso](https://verso.metzner.uk) has accounts now — email and password. The
moment a signup form is public and there's no server of mine in front of it, I
have a bot problem: someone finds the form, creates ten thousand junk accounts,
and burns my free quota for the fun of it.

The fix is a challenge in front of the form. I used
[Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) — no
Google involved, and for a real person it's usually invisible; you never see a
puzzle. The clever part is that I don't have to check the answer myself: the form
passes the challenge result to the service that holds my accounts, and *that*
service asks Cloudflare whether it's genuine. The security half runs inside a
back end I never had to build.

Then I locked myself out of my own app.

There are two switches, and they're independent: the form has to start *sending*
proof it passed the challenge, and the account service has to start *demanding*
it. I flipped the demanding one first. Every signup arriving without proof was
refused instantly — which was all of them, mine included, until the new form was
live. **Widen access before you restrict it.** Ship the sending half, watch real
signups still work, and only then make the other side insist on it. Turning the
feature back off runs in reverse: relax the demand first, remove the widget
after.

The second thing that bit me is quieter. The challenge is pinned to a list of
addresses it's allowed to appear on, and on any other address it simply refuses
to complete — no error, no message, you just sit there watching it never finish.
A site like this one lives at three addresses at once: the real domain, the
preview domain the host generates for every deploy, and my own laptop. Miss one
and it's broken exactly where you test.

I left the "click the link in your email"
step off for now — it's real friction for a bot, but it's also a wall new people
bounce off, and it means running outbound mail I don't run. And when a login
fails, the message is deliberately vague: "check your email and password". Saying
*no such user* would quietly confirm which addresses have accounts, one guess at
a time. The single exception is a failed challenge, which gets its own message,
because that's the one thing a real person can actually do something about.

Same lesson as [FIFA's](/posts/fifa-shipped-a-beginners-bug/), from the other
end: the interesting failures aren't in the code, they're in what you switched on
first.

## The wiring, in code

The client hands a token to Supabase; Supabase verifies it with Cloudflare before
it will create the account. You never call `siteverify` yourself — the **secret**
lives in Supabase → Auth → Attack Protection, and never in the repo:

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

The site key is public by design — it's visible in the widget anyway — so it can
be committed, and an empty one is a clean off-switch:

```ts
// the public site key; the matching SECRET lives in Supabase, never in the repo
export const TURNSTILE_SITE_KEY = '0x4AAAAAAD6B0V8C7RunRZin';
export const captchaOn = TURNSTILE_SITE_KEY.length > 0;
```

Loading the widget script is best-effort, so a blocked CDN can't wedge the login
form:

```ts
s.onerror = () => resolve(); // don't hang the login form if the script is blocked

if (s.includes('captcha')) return t('auth.errCaptcha');
if (s.includes('not confirmed')) return t('auth.errUnconfirmed');
if (s.includes('password') || s.includes('email')) return t('auth.error'); // generic
```

Hostnames to allow-list up front: the custom domain (`verso.metzner.uk`), the
platform preview domain (`*.pages.dev` on Cloudflare Pages), and `localhost`.
