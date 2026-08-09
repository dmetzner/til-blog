---
title: "Reverse engineering a mobile app's private API"
description: "A full walkthrough of reading an app's own API off your phone — proxy and CA trust, why apps ignore your certificate, adb over WiFi, jadx, recovering obfuscated annotations, an emulator with a system-store CA, and the verification step that stops you shipping a lie."
pubDate: 2026-08-09
tags: ["android", "apis", "reverse-engineering", "mobile", "til"]
draft: false
---

There's an app I use for tracking. The app is good. Its website is not — slow, awkward,
and missing half of what the app does. I wanted my own small web client and, eventually,
my dashboard to show the numbers without me opening my phone.

The app has no public API and no documentation. But the app is *clearly* talking to
something, and that something answers every question I wanted answered. So I spent a
morning reading what my own phone sends.

This post is the whole path, in the order I actually walked it, including the parts that
went wrong. Nothing here is specific to that app — you can follow it against any Android
app you have an account with, and I'll flag the iOS differences as they come up.

## Rule zero: decide what you're doing before you start

This is interop, and I want to keep it that way. The rules I set myself, all of which
turned out to matter later:

- **My account, my device, my traffic.** I'm reading what my own client sends on my own
  behalf. I never touch anyone else's data, and I never test against endpoints that
  belong to other users.
- **Read, don't hammer.** My client makes roughly the requests the app makes. No
  crawling, no bulk export of their database, no retry storms. If their app asks once
  per day view, so do I.
- **Their protected things stay protected.** I'll come back to this, but I found their
  API documentation sitting behind HTTP basic auth. That password is theirs. I didn't
  go near it, and I didn't need to.
- **Their client keys never get published.** An app ships credentials that identify *the
  app*. Extracting them so my own client can talk to the server is one thing; committing
  them to a public repo, or shipping them inside a public web app, is a different act
  with a different answer. Mine live in a gitignored file, read from disk at runtime.

Write these down before you start, because at 2pm you will be tired and a shortcut will
look reasonable.

## Step 1: point the phone at a proxy

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

Two details in there cost me time.

`flow.content` versus `flow.raw_content`: every response I cared about was gzipped, and
`raw_content` gives you the compressed bytes. My first capture logged
`<binary 147 bytes>` for the single most important response in the whole exercise.

And **redact by header name, but keep the scheme**. My first version replaced the whole
`Authorization` value with `<redacted>` — correct instinct, except the scheme is the
entire shape of the auth. `Basic` and `Bearer` mean completely different things, and I
had to re-run a capture to learn which one I was looking at. Log
`Basic <redacted len=102>`: the word, and the length. You'll see in a moment why the
length alone is worth having.

Then on the phone: WiFi → your network → **Proxy: Manual**, your laptop's LAN IP, port
8080. Browse to `http://mitm.it` and install the CA certificate it offers.

## The first two things that look broken and aren't

**"No internet connection."** Android's captive-portal probe (a request to
`connectivitycheck.gstatic.com/generate_204`) is made below the app layer and **ignores
the WiFi proxy**, so it fails while every app works fine. The proof is that the host
never appears in your capture at all.

That's cosmetic. What isn't cosmetic: Android decides WiFi has no internet and may
quietly move apps to **mobile data**, which bypasses your proxy entirely. You get an
empty capture, no error, and no clue. **Turn mobile data off** while capturing. (If you
have adb access, `adb shell settings put global captive_portal_mode 0` silences the probe.)

**Chrome works, the app doesn't.** This one is the real gate, and it's worth
understanding precisely, because it looks exactly like certificate pinning and usually
isn't.

Since Android 7 (API 24), an app does not trust user-installed CAs unless its
`network_security_config.xml` opts in. Chrome does trust them — it even suspends its own
pinning for user-added roots, which is why Chrome keeps working and makes the app look
uniquely stubborn. Any app targeting API 24 or above ignores your certificate by default,
and essentially every app in the store targets far above that now.

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

## Step 2: do the static analysis first, it costs nothing

I jumped to traffic capture because it's the obvious move. It was the wrong order.
Decompiling the APK is free, needs no working interception, and in my case gave me the
entire endpoint surface before I'd captured a single request.

You need the APK off your own device. Wired works; if you'd rather not find a cable,
Android 11+ has wireless debugging, which needs a one-time pairing per host:

```bash
# Phone: Developer options → Wireless debugging → Pair device with pairing code
adb mdns services                          # find the _adb-tls-pairing port
adb pair 192.168.0.154:36639 410962        # ip:pairing-port  pairing-code
adb connect 192.168.0.154:36473            # ip:connect-port (different port!)
```

The two ports are different and both are random. `adb mdns services` lists whichever is
currently advertised — the pairing one only appears while that dialog is open.

Then pull it. Modern apps are **split APKs**, so `pm path` returns several lines and you
want them all if you plan to reinstall anywhere:

```bash
adb shell pm list packages | grep -i <vendor>
adb shell dumpsys package <pkg> | grep -E 'versionName|targetSdk'
adb shell pm path <pkg>
adb pull /data/app/~~…/base.apk
adb pull /data/app/~~…/split_config.arm64_v8a.apk
```

Note `targetSdk` while you're there — that's the number that told you the user-CA story
above.

Now the cheapest possible first look, before any decompiler:

```bash
strings base.apk | grep -oE 'https?://[a-zA-Z0-9._-]+' | sort -u
strings base.apk | grep -E '^api/v[0-9]+/' | sort -u
```

That one command gave me two base URLs I didn't know existed, a staging host (which I
noted and left alone), and about forty endpoint paths. Before that I had one hostname.

Then decompile properly:

```bash
brew install jadx
jadx -d out --no-res -j 8 base.apk
```

## Step 3: the good part — recovering obfuscated annotations

Here's where it gets interesting, and where the transferable trick lives.

The app used [Retrofit](https://square.github.io/retrofit/), which is a gift: HTTP calls
are declared as annotated interface methods, so the API surface is *structural* rather
than scattered through call sites. You find something like this:

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

The same file's parameter loop gives you `@Path`, `@Query`, `@Header`, `@Body`,
`@Part`, `@Multipart` — Retrofit checks them in a fixed, documented order, so you can map
them off the sequence of `instanceof` checks and confirm each against the member shapes
(`@Query` has `value` + `encoded`, `@Body` has no members).

Two things to take away from this beyond the specific answer:

1. **Obfuscation renames symbols, not strings.** Anywhere a library turns a type into
   text — HTTP verbs, log messages, exception text, JSON field names — is a decoding
   table someone left in the binary for you.
2. **The mapping is per build.** `bl6` means `@POST` in this version and will mean
   something else in the next. Re-derive it; never reuse the table.

With the verbs resolved I wrote a ~120-line script that walked the decompiled interfaces
and emitted a table of every endpoint: verb, path, parameter names and kinds, response
type. 83 endpoints.

## Step 4: the accidental jackpot — check for generated models

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

One honest caveat about generated-model mining: R8 sometimes replaces a string constant
with a reference to an *unrelated* SDK's constant that happens to hold the same value.
I found fields annotated `@Json(name = SDKConstants.PARAM_DEBUG_MESSAGE_TIMESTAMP)` — a
Facebook SDK constant, in a data class that has nothing to do with Facebook. It resolves
to `"timestamp"`, which is correct, but I only believed that after grepping the constant's
declaration. Verify; don't assume the fallback.

## Step 5: an emulator with the CA in the system store

Static analysis gave me every endpoint. What it could not give me was the **auth
handshake**: the password only travels at login, and the token the app stores afterwards
sits in app-private storage I can't read without root.

So: one captured login. Options are to patch the APK to trust user CAs (works, but a
resigned APK means uninstalling the real one and losing local data), or to use an emulator
where you can put the certificate in the **system** store and leave your phone alone. I
took the emulator.

Four choices in the setup are load-bearing:

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

I'll add one thing I did deliberately: I let the emulator sit on the login screen and
typed the password by hand. Automating it with `adb shell input text` would have put my
password into process arguments and logcat — strictly worse than a keyboard.

The moment the app logged in, the capture filled up: 56 requests, the login among them.

## Step 6: the auth shape, and reading a redacted header

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

## Step 7: the trap that made the whole thing worth doing

Here's the finding I'd put at the top if this were a report.

The app talks to **two** APIs: a modern JSON one, and an older XML one on a different
host. Naturally I wired my client to the modern one — better shapes, cleaner paths, and
it has an endpoint that looks exactly like "give me a day's entries".

It returned `200` with every array empty. So did the same request made by the app itself,
which is what stopped me blaming my client. Meanwhile the app's own screen showed a full
day of records.

The modern endpoint carries only the app's *newer* record types. The ordinary ones —
the overwhelming majority — still live in the legacy XML API. A client that reads the
modern-looking endpoint renders a fully populated day as **zero**, with a `200` and no
error anywhere.

That is the worst possible failure mode: absence of data presented as data. If I'd shipped
it to my dashboard I'd have had a tile confidently telling me I'd logged nothing, on days
I'd logged plenty.

The generalisable lesson: **a `200` with an empty body is not a verified read.** Reproduce
a number you can see on the app's own screen before you believe any endpoint means what
its path says.

## Step 8: agree with the app to the last digit

A second client that disagrees with the app is worse than no client, because you now have
two numbers and no way to know which is wrong. Getting mine to match took three fixes,
each of which was individually plausible and quietly wrong:

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

## The order I'd do it in next time

1. Pull the APK and `strings` it. Hosts and paths, in seconds, for free.
2. `jadx` it. Find the HTTP layer (Retrofit interfaces, or OkHttp call sites).
3. Recover any obfuscated annotation names from the *library's own* dispatch code.
4. Look for generated models before hand-writing a single schema.
5. Check for real pinning (`sha256/` literals, `CertificatePinner`, `<pin-set>`) so you
   know whether interception is even the cheap path.
6. Only now capture traffic, and only for what static analysis can't tell you — in
   practice that's the auth handshake and the exact body of a write.
7. Use a rootable emulator with the CA in the system store rather than touching your
   phone's app.
8. Verify every read against a number the app itself displays. Then verify a write by
   making one, reading it back, and deleting it.

That last half-sentence is worth saying out loud: when you test writes, write something
harmless — I used a zero-calorie entry — and delete it afterwards. It's a real account
with real history, and debris you leave in it is debris you'll later mistake for data.

Two mornings of work, and my own client now reads and writes the thing I actually use,
with a generated spec I can hand to anything else that wants it. The app is still the
app. I just stopped being locked out of my own records.
