---
title: "Why I need a middleman to read my own bank account"
description: "PSD2 gives me a right to my bank data but not the key — and the way it splits reading from paying is what keeps my tool read-only."
pubDate: 2026-10-19
tags: ["apis", "security", "til"]
draft: false
---

I'm building a small finance tracker for our household: where the money goes, what the
contracts cost per year, which grocery receipt explains which card payment. It runs on my
own machine, and one rule stands above all others: **it may only ever read.** Not "it promises not to pay anything" — it must be *unable* to. A tool
that holds a full bank login can do everything I can do, and I don't want a bug, a leaked
file or a misbehaving AI agent anywhere near a transfer button.

So I went looking for my bank's API. Erste Bank has a developer portal, and its FAQ has the
exact question I had:

> *I am an Erste customer. Can I use the PSD2 APIs to access my own data?*
> **No.** Our PSD2 APIs are only available for PSD2 licensed Third Party Providers.

The API exists. The data is mine. I'm not allowed in. That one "No" is the whole shape of
European open banking.

## What PSD2 actually says

PSD2 is an EU directive from 2015 (Austria turned it into national law in 2018) that forced
banks to let other companies access your account — with your consent. It defines three
roles:

- **your bank**, which keeps the account;
- **account information services**, which may *read* balances and transactions you point
  them at;
- **payment initiation services**, which may *start a payment* from your account.

Reading and paying are separate services with separate permissions, and the law treats them
very differently. A company that only reads needs a *registration* with the regulator and
liability insurance — no starting capital. A company that can move money needs a full
*authorisation* and at least €50,000 of initial capital.

The interesting detail is how that split is enforced. When a provider calls a bank's API, it
presents a qualified electronic certificate (an eIDAS certificate, the EU's legally
recognised kind). That certificate carries the provider's registration number from a public
register *and its PSD2 roles*. A certificate that says "account information" can ask for
account information. It cannot reach the payment endpoints, because the bank is required to
check the role.

## Why I can't just plug in

The certificate is also why I'm locked out. A trust provider will only issue one with a
register number on it, and the register number only exists once a regulator has registered
you. No certificate, nothing for the bank's API to accept.

The law itself doesn't exclude private people. Article 33 says "natural
or legal persons" can register as an account information provider. On paper I could
register myself with Austria's financial regulator. In practice that means insurance sized
by the European Banking Authority's formula, governance documents, a regulatory process and
a qualified certificate — to read my own current account. That is a business process, not
a hobby setup.

So the right to my data is mine, but the door belongs to licensed intermediaries. Erste does
sell a [premium API for corporate clients](https://developers.erstegroup.com/ersteconnect),
but that is a product, not a PSD2 right, and not one a private customer gets.

## The middleman I picked, and what it can't do

Aggregators are companies that hold the licence and connect to thousands of bank APIs, then
let apps use that access. Most are business products sold through a sales call. GoCardless's
free tier, which hobby finance apps leaned on for years, showed in October 2026 "New signups for
Bank Account Data are currently disabled."

Enable Banking, a Finnish provider registered with the Finnish regulator, has a clause that
changes the picture: [its terms](https://enablebanking.com/terms) allow production use "for the
personal use of private individuals", limited to accounts you link yourself. My app sits in "Inactive" until I link my own accounts in their
control panel, and from then on it can only fetch those. The registration page also listed
exactly one service for it: *Account Information*, and Enable Banking itself is only
registered for account information. Payment initiation would need a payment
licence I don't have.

Linking in their control panel turned out to be only the allowlist; each bank still wants
its own consent through the normal flow. Once I gave it, the first fetch from Erste returned
well over a thousand bookings, going back almost four years. What the setup gives me is the
property I wanted, and not from a promise:

- **The role is in the certificate.** The access Enable Banking uses for me is account
  information. A payment can't be expressed through it.
- **My bank login never reaches them.** The consent flow is built to send me to George itself:
  the bank asks for its own second factor, and the provider only receives a time-limited
  consent, never my password.
- **My own client has a second wall.** It refuses any API route that isn't on a short
  read-only list, before a request ever leaves the machine (code below).

The honest cost: the data passes through their servers on its way to me. They are a
regulated company bound by purpose limitation — the law says an account information provider
may not use the data for anything except the service you asked for — but it is still a third
party seeing my transactions. For me that's acceptable *because* it can't spend; for the
same reason I refused the tempting alternative of a script that logs into George with my
password and downloads the export. That script would be able to do everything I can.

## The numbers developers trip over

The first three come from the technical standard that implements PSD2, not from any
particular bank, which is why they show up everywhere:

- **You re-authenticate at least every 180 days.** After that you approve the access again at
  your bank. Until July 2023 it was 90 days, and some banks asked on every single access — the
  EU amended the rules because of exactly that.
- **"Last 90 days" is a legal boundary, not a technical one.** The exemption that lets
  providers read without asking you every time only covers transactions from the last 90
  days. Many banks serve much more history right after you consent — Enable Banking's FAQ
  says often only for about an hour — so the rule of thumb is: **backfill immediately after
  consent**, and keep everything you fetched.
- **Four unattended reads a day.** Without you actively in front of the app, a provider may
  fetch "no more than four times in a 24-hour period" unless the provider and the bank agree
  on more and you consent. A cron job every five minutes isn't merely rate-limited; the
  regulation never allowed it.

And two that aren't law but bite just the same. The first: **a bank's transaction id isn't
necessarily unique.** At every quarter-end, Erste books the account fee, a €0.00 closing
entry and sometimes a cent of interest under one shared reference — every quarter in my
data. My first version merged repeated fetches by that id, which would have quietly
dropped all but one of them on the next run. Identity is now the id plus date, amount, direction and reference text. The second: the most common standard in the EU is the
Berlin Group's NextGenPSD2, and each bank implements its own subset of it, so "supports PSD2" says little
about which login flow or how much history you get.

## What comes next

PSD2's successor, a directly applicable Payment Services Regulation, was politically agreed
in November 2025; as of September 2026 the European Parliament's tracker still lists it as
"close to adoption", not law. Among other things it would add a permissions dashboard inside
your banking app listing every provider with access. The broader "open finance" law for
savings, investments and pensions is listed as blocked on the same tracker; one sticking
point is whether Big Tech platforms may use it.

The takeaway I keep: **open banking gave me a right, not a key.** The key sits with
licensed providers, and the regulation splits it into "read" and "pay" so cleanly that I can
pick a provider whose key only opens one of the two doors.

## The read-only client

Enable Banking authenticates an app with a short-lived JWT signed by the app's own RSA key
(the private key never leaves my machine; I uploaded a self-signed certificate). The system
`openssl` signs it, so the client needs no dependency:

```python
def jwt(app_id, key, now, lifetime=3600):
    head = b64(json.dumps({"typ": "JWT", "alg": "RS256", "kid": app_id}))
    body = b64(json.dumps({"iss": "enablebanking.com", "aud": "api.enablebanking.com",
                           "iat": now, "exp": now + lifetime}))      # max 24 h
    sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key],
                         input=f"{head}.{body}".encode(), capture_output=True, check=True).stdout
    return f"{head}.{body}.{b64(sig)}"
```

And the second wall — every call goes through this check, and the payments API simply isn't
on the list. The first version only had the regexes; an independent review of this post
pointed out that `/sessions/..` matched them, so a path now has to be plain segments before
it is matched at all:

```python
READ_ONLY_ROUTES = [
    ("GET",  r"^/aspsps$"),                                   # which banks exist
    ("POST", r"^/auth$"),                                     # start a consent at the bank
    ("POST", r"^/sessions$"),                                 # turn the bank's code into a session
    ("GET",  r"^/sessions/[^/]+$"),
    ("GET",  r"^/accounts/[^/]+/(balances|transactions|details)$"),
]

def allowed(method, path):
    segs = path.split("/")[1:]
    if "%" in path or any(not re.fullmatch(r"[A-Za-z0-9_-]+", s) for s in segs):
        return False                      # no '..', no '.', no encoded tricks
    return any(method == m and re.match(rx, path) for m, rx in READ_ONLY_ROUTES)

def call(method, path, **kw):
    if not allowed(method, path):
        raise PermissionError(f"refused: {method} {path} is not a read-only route")
    ...                                   # the signed request itself
```

A test asserts that `POST /payments`, `DELETE` on a session and the dot-segment paths are
refused before any network call. Adding a route to that list is a change to the security
model, not a feature.

## Follow-up resources

- [PSD2, Directive (EU) 2015/2366](https://eur-lex.europa.eu/eli/dir/2015/2366/oj) — Art. 4
  (the roles), Art. 33 (registration), Art. 67 (what a reader may do)
- [RTS on strong customer authentication, (EU) 2018/389](https://eur-lex.europa.eu/eli/reg_del/2018/389/oj)
  and its [2022 amendment](https://eur-lex.europa.eu/eli/reg_del/2022/2360/oj) — the 90/180
  days and the four reads a day
- [Erste Developer Portal FAQ](https://developers.erstegroup.com/support/faq/common)
- [Enable Banking: linked accounts](https://enablebanking.com/docs/api/linked-accounts/)
