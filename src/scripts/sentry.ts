import * as Sentry from "@sentry/browser";

// Error tracking → GlitchTip (org metzneruk, project "til"). Public DSN inline
// (safe in the client bundle). Errors only + noise filters to protect the
// free-tier budget. PII is off — no IP/user data attached.
Sentry.init({
  dsn: "https://2de72a82f331452bbd2a304398d9db9e@app.glitchtip.com/26052",
  tracesSampleRate: 0,
  // v11 replaced sendDefaultPii with dataCollection, and its defaults COLLECT (userInfo: true
  // makes the server infer the visitor IP). Turn the PII categories off explicitly.
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false },
  ignoreErrors: [
    "ResizeObserver loop",
    "Non-Error promise rejection captured",
    "AbortError",
    "NetworkError",
    "Failed to fetch",
    "Load failed",
  ],
  denyUrls: [/extension:\/\//, /^chrome:\/\//, /^moz-extension:\/\//, /^safari-extension:\/\//],
  beforeSend(event) {
    const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
    if (frames.length && !frames.some((f) => f.in_app)) return null;
    // anonymize: no user identity, no request headers/cookies leave the browser
    delete event.user;
    delete event.request;
    return event;
  },
});
