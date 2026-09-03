---
title: "Good app, no public API — so I gave it one"
description: "No public API means no custom tooling, no dashboard tile, nothing an agent can call. So I read what my own phone sends — and the useful lesson was the endpoint that answered \"give me today\" with a cheerful, completely empty success."
pubDate: 2026-08-09
tags: ["android", "apis", "reverse-engineering", "mobile", "til"]
draft: false
---

There's an app I use every day for tracking. The app is good. What it doesn't have
is any way in from outside: no public interface, no documentation, nothing a script
of mine or an agent could call. So the numbers live in there, and everything I'd
like to build around them — a tile on my dashboard, a small client that isn't their
slow website, anything automated at all — is off the table.

Except the app is *clearly* talking to something, and that something answers every
question I wanted answered. So I spent a morning reading what my own phone says.

Before starting I wrote down the rules, because at 2pm you're tired and a shortcut
looks reasonable. My account, my device, my traffic — I never touch anyone else's
data. Read, don't hammer: my client asks roughly as often as the app does, no bulk
export, no retry storms. Their protected things stay protected — I found their own
API documentation sitting behind a password on their server, and left it alone,
which cost me nothing because the app already on my phone contained the same
information. And the keys that identify their app stay out of anything public.

Two things came out of it that I'd tell anyone.

**The cheap step is the one I skipped.** I went straight for watching the traffic,
which is the fiddly half — phones deliberately don't trust a laptop pretending to
be the internet. Taking the app apart *on my laptop* costs nothing, needs no
interception at all, and handed me the entire list of addresses it talks to before
I'd captured a single request. Better still, the app shipped a
machine-generated description of every kind of data it exchanges: someone's build
tool wrote that from an internal spec, and it came along for the ride. I never
had to guess at a single field name.

**And the trap that made the whole thing worth doing.** The app talks to two
systems: a modern one and an older one nobody advertises. Naturally I wired my
client to the modern one, which has an endpoint that looks exactly like "give me
today's entries". It answered *successfully*, with nothing in it. Not an error, not
a refusal — a cheerful, empty, entirely convincing success. Meanwhile the app's own
screen showed a full day of records, because most record types still live in the
old system.

That's the worst failure there is: **absence of data presented as data.** A
success with an empty body is not a verified read. Had I shipped it, my dashboard
would have told me — confidently, and wrongly — that I'd logged nothing on days I'd
logged plenty. So the rule I came away with is to reproduce a number I can *see on
the app's own screen* before believing any endpoint means what its name says.

Which sets the finishing standard too. A second client that disagrees with the app
is worse than no client, because now you have two numbers and no way to know which
one is lying. Three separate things had to be fixed before mine matched, and each
was individually plausible: a unit conversion where their constant isn't the
textbook one, figures given per 100 grams rather than as eaten, and a timezone
applied twice so everything read two hours late. The test that caught all three
was holding my phone next to my screen and comparing the totals.

Two mornings of work. The app is still the app — I just stopped being locked out of
my own records, and I have a written-down description of the interface I can hand
to anything else that wants it.

## The full walkthrough

Everything below is the path in the order I actually walked it, including the parts
that went wrong. Nothing here is specific to that app; you can follow it against
any Android app you have an account with, and I flag the iOS differences as they
come up.

### Rule zero, in full

The rules from the top of this post, with the detail: this is interop and I want to keep
it that way.

- **My account, my device, my traffic.** I never test against endpoints that belong to
  other users.
- **Read, don't hammer.** No crawling, no bulk export of their database, no retry
  storms. If their app asks once per day view, so do I.
- **Their protected things stay protected.** Their API documentation sits behind HTTP
  basic auth. That password is theirs, I didn't go near it, and I didn't need to.
- **Their client keys never get published.** An app ships credentials that identify *the
  app*. Extracting them so my own client can talk to the server is one thing; committing
  them to a public repo, or shipping them inside a public web app, is a different act
  with a different answer. Mine live in a gitignored file, read from disk at runtime.

### Step 1: point the phone at a proxy

The standard tool is [mitmproxy](https://mitmproxy.org). Install it, run it, and write a
tiny addon so you get structured output instead of scrollback:

```bash
brew install mitmproxy
mitmdump --listen-port 8080 -s sniff.py
```

The addon matters more than it looks. Your phone routes **all** its traffic through this
proxy — every other app included — and a raw dump is every one of those apps' bearer
tokens sitting in a file on your laptop. So log bodies only for the hosts you care
about, and reduce everything else to one line:

```python
import json, re, time

INTERESTING = re.compile(r"the-vendor", re.I)
SECRET_HEADERS = {"authorization", "cookie", "set-cookie", "x-api-key"}

def response(flow):
    req, res = flow.request, flow.response
    if not INTERESTING.search(req.pretty_host):
        record({"kind": "other", "host": req.pretty_host,
                "path": req.path.split("?")[0], "status": res.status_code})
        return
    record({"kind": "target", "method": req.method, "url": req.pretty_url,
            "req_headers": redact(req.headers),
            # NOT raw_content: that's still gzipped, and it will log as
            # "<binary 147 bytes>" for every single response.
            "req_body": body(req.content),
            "status": res.status_code, "res_body": body(res.content)})

def error(flow):
    # A TLS failure IS a finding — it's how certificate pinning announces itself.
    record({"kind": "error", "host": flow.request.pretty_host, "error": str(flow.error)})
```

Two details cost me time. `flow.content` versus `flow.raw_content`: responses were
gzipped, and `raw_content` gives you the compressed bytes — my first capture logged
`<binary 147 bytes>` for the single most important response of the exercise. And
**redact by header name, but keep the scheme**: `Basic` and `Bearer` mean completely
different things, so `Basic <redacted len=102>` — the word and the length — beats
`<redacted>`. You'll see shortly why the length alone is worth having.

Then on the phone: WiFi → your network → **Proxy: Manual**, your laptop's LAN IP, port
8080. Browse to `http://mitm.it` and install the CA certificate it offers.

### The first two things that look broken and aren't

**"No internet connection."** Android's captive-portal probe
(`connectivitycheck.gstatic.com/generate_204`) is made below the app layer and ignores
the WiFi proxy, so it fails while every app works fine — the host never appears in your
capture at all. Cosmetic, except Android then decides WiFi is dead and may quietly move
apps to **mobile data**, bypassing your proxy: empty capture, no error, no clue. **Turn
mobile data off** while capturing (or silence the probe with
`adb shell settings put global captive_portal_mode 0`).

**Chrome works, the app doesn't.** The real gate — and it looks exactly like
certificate pinning while usually being something duller. Since Android 7 (API 24) an
app does not trust user-installed CAs unless its `network_security_config.xml` opts in.
Chrome does trust them, and even suspends its own pinning for user-added roots, which is
what makes the app look uniquely stubborn.

Distinguishing that from real pinning takes a minute and saves an afternoon:

- **Ignored user CA / real pinning** both show up as a TLS handshake failure in
  mitmproxy: `Client TLS handshake failed … certificate unknown`.
- Look in the APK. Real pinning leaves fingerprints — literal `sha256/…` pin strings,
  a `CertificatePinner` being configured, or a `network_security_config.xml` with
  `<pin-set>`. If there are none of those and no network security config at all, you're
  looking at the plain default, not a defence.

In my case: no pin literals, no network security config. Just the default. That means an
emulator with the certificate in the **system** store will work — which is where this
ends up, but not before the free part.

### Step 2: do the static analysis first, it costs nothing

Decompiling the APK is free, needs no working interception, and gave me the entire
endpoint surface before I'd captured a single request. You need the APK off your own
device — wired works, or Android 11+ has wireless debugging with a one-time pairing:

```bash
# Phone: Developer options → Wireless debugging → Pair device with pairing code
adb mdns services                          # find the _adb-tls-pairing port
adb pair 192.168.0.154:36639 410962        # ip:pairing-port  pairing-code
adb connect 192.168.0.154:36473            # ip:connect-port (different port!)
```

Both ports are random and different; the pairing one only exists while that dialog is
open. Then pull it — modern apps are **split APKs**, so take every line `pm path` gives
you if you plan to reinstall anywhere:

```bash
adb shell pm list packages | grep -i <vendor>
adb shell dumpsys package <pkg> | grep -E 'versionName|targetSdk'
adb shell pm path <pkg>
adb pull /data/app/~~…/base.apk
adb pull /data/app/~~…/split_config.arm64_v8a.apk
```

Note `targetSdk` while you're there — that's the number behind the user-CA story above.
Then the cheapest possible first look, before any decompiler:

```bash
strings base.apk | grep -oE 'https?://[a-zA-Z0-9._-]+' | sort -u
strings base.apk | grep -E '^api/v[0-9]+/' | sort -u
```

That gave me two base URLs I didn't know existed, a staging host (noted, left alone) and
about forty endpoint paths. Before it I had one hostname. Then decompile properly:

```bash
brew install jadx
jadx -d out --no-res -j 8 base.apk
```

### Step 3: the good part — recovering obfuscated annotations

The app used [Retrofit](https://square.github.io/retrofit/), which is a gift: HTTP calls
are declared as annotated interface methods, so the API surface is *structural* rather
than scattered through call sites:

```java
public interface t68 {
    @bl6("api/v1/search")
    Object b(@j67("q") String str, @j67("page") Integer num, …);
}
```

Every path is right there. But R8 renamed the library's classes too, so `@bl6` and
`@j67` are anyone's guess. `@GET`? `@POST`? All the verb annotations have identical
shapes (`String value() default ""`), so you cannot tell them apart by structure, and
guessing wrong means writing a client that 404s and blaming yourself.

**The trick: the library's own dispatch code still contains the strings.** Retrofit parses
those annotations by branching on their type and passing the HTTP method as a *string
literal* — and string literals survive obfuscation. So grep the decompiled output for the
method names:

```bash
grep -rn '"DELETE"' out/sources | head
```

That lands you in Retrofit's request parser, deobfuscated in one shot:

```java
if (annotation instanceof ln1) {  vs7Var.b("DELETE",  ((ln1) annotation).value(), false);
} else if (annotation instanceof uu3) { vs7Var.b("GET", ((uu3) annotation).value(), false);
} else if (annotation instanceof bl6) { vs7Var.b("POST", ((bl6) annotation).value(), r6);
…
```

`bl6` is `@POST`. Which mattered immediately: the search endpoint is a **POST carrying
query parameters and no body**, and `GET` on that path 404s. I would have guessed GET
every time.

The same file's parameter loop yields `@Path`, `@Query`, `@Header`, `@Body`, `@Part`,
`@Multipart` — checked in a fixed order, and confirmable against the member shapes
(`@Query` has `value` + `encoded`, `@Body` has none).

The transferable part: **obfuscation renames symbols, not strings.** Anywhere a library
turns a type into text — verbs, log messages, exception text, field names — is a decoding
table left in the binary for you. And **the mapping is per build**: re-derive it, never
reuse the table.

With the verbs resolved I wrote a ~120-line script that walked the decompiled interfaces
and emitted a table of every endpoint: verb, path, parameter names and kinds, response
type. 83 endpoints.

### Step 4: the accidental jackpot — check for generated models

Then I noticed the response types lived in a package called
`…network.node_api.swagger.models`.

**Swagger.** Their models were generated from an OpenAPI spec with openapi-generator, and
the generator's output ships inside the app: 123 data classes, each carrying the wire
names as annotations, with the parameter names and types intact.

```java
public final BasePlanDto copy(@Json(name = "id") String id,
                              @Json(name = "featured") boolean featured, …)
```

That's a schema. Every field's JSON name, its type, and — because Kotlin boxes nullable
primitives — its optionality: `double` is required, `Double` is not. I generated an
OpenAPI document straight out of it: 45 paths, 123 schemas.

Which brings me back to rule zero. Their actual `swagger.json` is *on the server*, and it
answers `401` with `WWW-Authenticate: Basic realm="Restricted"`. I could see it was there.
I did not touch it — and the point is that I never needed to, because the generated models
in the app I already had were the same information, obtained from a file on my own device.

If you're doing this on an app that uses code generation (very common), look for a
`models` or `dto` package before you write a single schema by hand.

One caveat: R8 sometimes swaps a string constant for an *unrelated* SDK's constant
holding the same value. I found fields annotated
`@Json(name = SDKConstants.PARAM_DEBUG_MESSAGE_TIMESTAMP)` — a Facebook constant in a
class with nothing to do with Facebook. It resolves to `"timestamp"`, correctly, but only
grepping its declaration proved that.

### Step 5: an emulator with the CA in the system store

The one thing static analysis can't give you is the **auth handshake** — the password
only travels at login, and the token afterwards sits in storage I can't read without
root. So: one captured login. Patching the APK to trust user CAs works but costs you the
real install; an emulator lets you put the certificate in the **system** store and leave
the phone alone. Four setup choices are load-bearing:

```bash
sdkmanager --install "system-images;android-33;google_apis;arm64-v8a"
avdmanager create avd -n mitm -k "system-images;android-33;google_apis;arm64-v8a" -d pixel_6
emulator -avd mitm -writable-system -no-boot-anim -gpu swiftshader_indirect
```

- **`google_apis`, not `google_apis_playstore`.** Play Store images are production-signed
  and `adb root` is refused. You lose the Play Store, so you sideload the APK you already
  pulled — which you have, splits and all.
- **API 33 or lower.** Android 14 moved the CA store into an APEX mount
  (`/apex/com.android.conscrypt/cacerts`) and the simple push below stops being enough.
  Anything ≤33 takes the easy path. Check the app's `minSdk` first; mine was 26.
- **`-writable-system`**, or the remount won't stick.
- **Software rendering** was my fix when the emulator died right after boot with
  `Netsim Wifi … is gone` — the networking subsystem fell over with host GPU. It survived
  fine with `swiftshader_indirect`.

Then install the certificate under the hash name Android looks it up by. This is the bit
people get wrong: the filename is not arbitrary, it's the old-style subject hash:

```bash
H=$(openssl x509 -inform PEM -subject_hash_old -in ~/.mitmproxy/mitmproxy-ca-cert.pem | head -1)
cp ~/.mitmproxy/mitmproxy-ca-cert.pem "$H.0"
adb root && adb remount
adb push "$H.0" /system/etc/security/cacerts/
adb shell chmod 644 /system/etc/security/cacerts/"$H.0"
adb install-multiple base.apk split_config.arm64_v8a.apk
adb shell settings put global http_proxy 10.0.2.2:8080   # 10.0.2.2 = your host
```

Both the certificate and the proxy setting survived reboots of my AVD, which was a
pleasant surprise.

One deliberate choice: I typed the password by hand. `adb shell input text` would have
put it into process arguments and logcat — strictly worse than a keyboard. The moment the
app logged in, the capture filled up.

### Step 6: the auth shape, and reading a redacted header

The login turned out to be almost quaint. HTTP Basic, with the email and password,
against an endpoint returning a long-lived key. Every subsequent request sends Basic
again — with that key in place of the password.

The lovely part is that I knew the shape before I saw a single secret value, from the
lengths my own redaction had left behind:

- login request: `Basic <redacted len=50>`. `Basic ` is 6, leaving 44 base64 characters
  = 33 bytes. `my-email@example.com:my-password` is 33 bytes. It's `email:password`.
- every later request: `Basic <redacted len=102>` → 96 base64 characters = 72 bytes
  = 22-byte email + `:` + a 49-character key. It's `email:token`, and the token is the
  48-character string the login response returned.

That's why you log the length. It let me write the client, and confirm the design, without
the secret ever being in the log I was reading.

Practical notes for the client, all of which are just good manners:

- Cache the long-lived key (mode `0600`, created with `os.open(..., 0o600)` rather than
  chmod'ed afterwards — otherwise it exists world-readable for a moment).
- On a `401`, re-mint it **exactly once**. A 401 means the key expired, not that the
  password is wrong; unbounded retries would be a loop hammering someone's login endpoint.
- Send the app's own `User-Agent`. Not disguise — the opposite. It's honest about which
  client this is, and it avoids being served a degraded response meant for something else.

### Step 7: the empty `200`, in detail

The app talks to **two** APIs: a modern JSON one and an older XML one on a different
host. I wired my client to the modern one — better shapes, cleaner paths, and an endpoint
that looks exactly like "give me a day's entries". It returned `200` with every array
empty, and so did the same request made by the app itself, which is what stopped me
blaming my client.

The modern endpoint carries only the app's *newer* record types. The ordinary ones — the
overwhelming majority — still live in the legacy XML API. **A `200` with an empty body is
not a verified read.**

### Step 8: agree with the app to the last digit

Three fixes stood between my numbers and the app's, each individually plausible and
quietly wrong:

**Their unit conversion, not the textbook one.** Their own data gives one item as
1817.1 kJ / 434.01 kcal — a ratio of 4.1867, not the 4.184 in every reference. Using the
correct-looking constant put every figure ~0.07% out: invisible per row, enough to make
the day's total disagree with the app.

**Per-100 values, not absolute ones.** Each record carries nutrients against a basis
(100) plus the amount actually consumed. Read the block as absolute and a 20 g portion
reports as 100 g — a fivefold overstatement that still looks like a plausible number.

**Timezones, applied twice.** My request asked for UTC, and the server returns timestamps
pre-shifted so that reading them *as UTC* yields local wall-clock. `datetime.fromtimestamp()`
then adds the machine's offset a second time, and every entry read two hours late in
summer. Which looks like a clock, not a bug — I only caught it because I had the app's own
screenshot next to my output showing `09:41` where mine said `11:41`.

The test that caught all three was embarrassingly low-tech: put the app's screen next to
your client's output and compare the totals, the macros and the timestamps. Mine now reads
`708 kcal · 26.5 g F · 65 g C · 47.2 g P` against the app's `708 · 27 · 65 · 47`.

### The order I'd do it in next time

1. Pull the APK, `strings` it, then `jadx` it — hosts, paths and the HTTP layer, for free.
2. Recover obfuscated annotation names from the *library's own* dispatch code, and look
   for generated models before hand-writing a single schema.
3. Check for real pinning (`sha256/` literals, `CertificatePinner`, `<pin-set>`) to know
   whether interception is even the cheap path.
4. Only then capture traffic, and only for what static analysis can't tell you: the auth
   handshake and the exact body of a write.
5. Verify every read against a number the app displays — then verify a write by making
   one, reading it back, and deleting it.

Write something harmless when you test writes, and delete it. It's a real account with
real history, and debris you leave behind is debris you'll later mistake for data.
