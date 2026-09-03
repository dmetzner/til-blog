---
title: "One missing line, and all of GitHub can deploy to your project"
description: "Passwordless CI needs two scopes: the identity provider names the repository, and IAM limits who may impersonate the deploy account."
pubDate: 2026-08-10
tags: ["cloud-run", "security", "tooling", "til"]
draft: false
---

For a while I shipped a small internal tool by typing a deploy command in a
terminal. It worked, and it had the flaw that only shows up later: nobody could
answer "which version is live?" A fix could be written, reviewed, tested, green —
and still sitting on nobody's laptop.

The usual next step is to paste a password into GitHub so the pipeline can deploy
for you. I've done that at work. It's a password with no expiry, held by a third
party, that grants exactly as much in six months as it does today. And nothing
about a deploy actually needs a long-lived secret. What it needs is **proof that
this repository is asking**.

That proof exists, and the setup pages make it look harder than it is. Each run,
the pipeline asks GitHub to vouch for itself, GitHub hands over a short-lived note
saying which repository and which branch is running, and my cloud project trades
that note for a credential good for the next hour. Nothing is stored anywhere. If
somebody steals the note, it's already expired.

The thing you tell your project to trust is **GitHub** — not *your* GitHub. Every public
repository on the platform gets its notes signed by the same authority. So if you
say "accept notes from GitHub" and stop there, any repository anybody creates
this afternoon can present one and your project will accept it. You have to also
say *and it must be my repository*, and that's one line of configuration with
nothing to warn you when it's missing. GitHub's own docs are blunt about it: you
must define at least one condition, or untrusted repositories can reach your
cloud resources.

The permissions surprised me by how few there are. A deploy needs to push a
package, roll out a new version of one service, and — the one everybody forgets —
permission to hand that service the identity it runs under. That third one
produces an error that reads like a completely different problem, so you go and
add powers in the wrong place. The deploy identity can't read the database and
can't touch the login layer. It builds, pushes, and rolls one service.

Then the flag that would have locked everyone out. There are two ways to set the
service's configuration: one *adds* what you list, the other *replaces
everything* and deletes what you didn't mention. One word apart. My service sits
behind a company login and refuses to serve if it can't verify who it should
trust — which is the correct way round, and also means the wrong flag turns
"deploy" into "nobody at the company can log in", on every push, forever. Same
goes for settings you leave out entirely: whatever is already on the service
carries forward, and restating the security boundary in a pipeline file just
gives it a second source of truth that will drift.

Deploy configuration is shared, mutable state. Prefer the verbs that patch it.

## When I wouldn't bother

If you deploy by hand twice a year, this is more machinery than a password. And
this kind of trust is per-repository by design: at twenty repositories you need a
real scheme, or you'll end up with a single identity that can deploy everything —
which is the password problem again with extra steps.

The honest annoyance is that none of it can be tested locally. The first proof is
a real push, and the error messages point at the wrong layer in both of the ways
you'll get it wrong. Budget one confusing run.

What a stored password really costs you isn't rotation — it's that you can never
watch it being used.

## The setup, in commands

A *pool* is the trust boundary; a *provider* inside it names the external issuer
and maps its claims. The mapping makes claims available; the **condition** decides
who gets in at all:

```bash
gcloud iam workload-identity-pools providers create-oidc github \
    --location=global --workload-identity-pool=github \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='my-org/my-repo'"
```

The grant that finishes it is a `principalSet`, not a user — *whatever comes
through this pool carrying that repository attribute may act as this service
account*:

```bash
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
    --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/my-org/my-repo"
```

Belt and braces: the condition keeps strangers out of the pool, the `principalSet`
keeps the right strangers away from the wrong identity. There's also **direct**
federation with no service account in the middle — fewer moving parts, credential
capped at ten minutes instead of an hour — but it needs every resource's IAM to
accept a principalSet, which not every API does.

The three grants, in full:

- `artifactregistry.writer` on one repository — push an image
- `run.developer` on one service — roll a revision
- `iam.serviceAccountUser` on the **runtime** service account — deploy something
  that runs as that identity

The workflow. `id-token: write` is what lets the job request the note at all — its
absence looks like a broken provider:

```yaml
permissions:
  contents: read
  id-token: write   # without this, auth fails in a way that looks like a bad provider
env:
  PROJECT: my-project
  REGION: europe-west1
  SERVICE: my-service
steps:
  - uses: actions/checkout@v6
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: ${{ vars.WIF_PROVIDER }}
      service_account: ${{ vars.DEPLOY_SA }}
  - uses: google-github-actions/setup-gcloud@v2
  - run: |
      IMAGE="$REGION-docker.pkg.dev/$PROJECT/apps/$SERVICE:$GITHUB_SHA"
      gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
      docker build -t "$IMAGE" . && docker push "$IMAGE"
      gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" \
        --update-env-vars "BUILD_SHA=$GITHUB_SHA"
```

Neither `WIF_PROVIDER` nor `DEPLOY_SA` is a secret — they're repo *variables*, a
path and an email, useless without a token GitHub will only mint for that
repository. I also skipped `--source .` in CI: it's lovely locally, but it means
granting storage and build permissions for work the pipeline already does.

And the destructive pair, by name: `--update-env-vars` adds or changes;
`--set-env-vars` **deletes** what isn't in the new list.

## Follow-up resources

- [Configuring OpenID Connect in Google Cloud](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-google-cloud-platform) — GitHub's own setup, including "you must define at least one condition".
- [google-github-actions/auth](https://github.com/google-github-actions/auth) — direct vs. service-account federation, token lifetimes, and the attribute-condition warning.
- [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation) — pools, providers, attribute mapping and the `principalSet` syntax.
- [Deploying to Cloud Run](https://docs.cloud.google.com/run/docs/deploying) — the exact roles a deploy needs, including Service Account User on the service identity.
- [Cloud Run environment variables](https://docs.cloud.google.com/run/docs/configuring/services/environment-variables) — `--set-env-vars` is destructive; `--update-env-vars` isn't.
- [Identity-Aware Proxy for Cloud Run](https://docs.cloud.google.com/iap/docs/enabling-cloud-run) — what the audience value is and why the app should verify it.
