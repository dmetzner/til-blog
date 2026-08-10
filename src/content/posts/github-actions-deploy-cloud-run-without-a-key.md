---
title: "CI can deploy to Cloud Run without a key — and one missing line trusts all of GitHub"
description: "How Workload Identity Federation replaces a service-account key in GitHub Actions, which three IAM grants a deploy actually needs, and the two flags that quietly decide whether your service survives the deploy."
pubDate: 2026-08-10
tags: ["cloud-run", "security", "tooling", "til"]
draft: false
---

For a while I shipped a small internal tool by typing `gcloud run deploy` in a
terminal. It worked, and it had one flaw that only shows up later: nobody could
answer "which revision is live?" A fix could be merged, reviewed, green in CI, and
still sitting on nobody's laptop.

The usual next step is a service-account key in GitHub secrets. I've done that at work.
A JSON key is a password with no expiry that you paste into a third party, and it grants
exactly as much six months from now as it does today. Nothing about the deploy needs a
long-lived secret. It needs *proof that this repository is asking*.

That proof is what **Workload Identity Federation** does, and the mechanism is
simpler than the setup pages make it look.

## What actually happens per run

GitHub runs an OIDC provider. Give a job `id-token: write` and it can ask GitHub for
a short-lived JWT describing itself — issuer `https://token.actions.githubusercontent.com`,
plus claims like `repository`, `ref`, `workflow` and `environment`. Google's Security
Token Service accepts that JWT, checks the issuer's signature, and hands back a Google
credential.

You wire it up in two halves. A **pool** is the trust boundary; a **provider** inside it
says which external issuer is accepted and how its claims map onto attributes you can
assert on:

```bash
gcloud iam workload-identity-pools providers create-oidc github \
    --location=global --workload-identity-pool=github \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='my-org/my-repo'"
```

Two lines are doing very different jobs there. The mapping makes claims *available*.
The condition decides who gets in at all.

## Skip the condition and you have trusted all of GitHub

This is the part I want to be loud about, because the failure is silent. The issuer
you configured is not *your* GitHub — it's GitHub. Every public repository on the
platform gets tokens signed by the same issuer, with the same key. If your provider
accepts anything from that issuer, then any repo anybody creates can mint a token your
pool will exchange.

GitHub's own documentation is blunt about it: you *must* define at least one condition,
or untrusted repositories can access your cloud resources. Google's action docs say the
same thing from the other side — always add an attribute condition, and pin permissions
per repository with `attribute.repository/${REPO}`.

So the grant that finishes the setup is a `principalSet`, not a user:

```bash
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
    --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/my-org/my-repo"
```

Read it as a sentence: *whatever comes through this pool carrying that repository
attribute may act as this service account.* Belt and braces — the condition keeps
strangers out of the pool, the `principalSet` keeps the right strangers away from the
wrong identity.

There's also **direct** federation, where the pool holds permissions on resources with no
service account in the middle — fewer moving parts, and a credential capped at ten
minutes instead of an hour. It needs each resource's IAM to accept a principalSet, which
not every API does, so a purpose-made deploy account still has the fewest surprises.

## Three grants, and the one everybody forgets

A deploy is a smaller job than it feels like. Mine holds exactly three permissions:

- `artifactregistry.writer` on one repository — push an image
- `run.developer` on one service — roll a revision
- `iam.serviceAccountUser` on the *runtime* service account — deploy something that
  runs as that identity

The third is the one that produces a baffling error. Cloud Run's docs list it plainly:
deploying a service that runs as a service account requires Service Account User on
that identity. Without it you get a permission failure that reads like your deploy
account lacks Cloud Run access, and you go add roles in the wrong place. The deploy
identity cannot read the database and cannot touch the auth layer — it can build,
push, and roll one service.

I also skipped `gcloud run deploy --source .` in CI. It's a lovely command locally: it
uploads your source, has Cloud Build build it, stages it in a bucket. In CI it means
granting storage and build permissions for work the pipeline already does — CI builds
the image anyway. Building in the job and deploying `--image` kept the permission set at
three lines and made the deploy step a revision roll:

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

Neither `WIF_PROVIDER` nor `DEPLOY_SA` is a secret. They're repo *variables* — a path
and an email, useless without a token GitHub will only mint for that repository.

## The flag that would have locked everyone out

Look at the last line again. `--update-env-vars` adds or changes variables. Its
neighbour `--set-env-vars` is documented as destructive: it deletes previously set
variables that aren't in the new list.

My service sits behind Google's Identity-Aware Proxy, and the app verifies the signed
IAP assertion against an audience it reads from an environment variable. It fails closed
when that variable is missing — which is the right way round, and also means one wrong
flag in CI turns "deploy" into "nobody in the company can log in", on every push,
forever. Same story for the flags that aren't there: no `--iap`, no service account, no
scaling. Whatever is already on the service carries forward, and restating the security
boundary in a workflow file gives it a second source of truth that will drift.

Deploy configuration is a shared mutable object. Prefer the verbs that patch it.

## When I wouldn't bother

If you deploy by hand twice a year, this is more machinery than a key. And federation
is per-repository trust by design: at twenty repos you need a real scheme — an
org-scoped condition plus per-repo service accounts — or you'll end up with one
identity that can deploy everything, which is the key problem again with extra steps.

The honest annoyance is that none of it can be tested locally. The first proof is a
real push to `main`, and the error messages point at the wrong layer: a missing
`id-token: write` looks like a broken provider, a missing `serviceAccountUser` looks
like a missing Cloud Run role. Budget one confusing run.

What I'd keep as the rule of thumb: **if CI can deploy, the credential should be minted
per run and scoped to one repo, one service, one registry.** The thing a key really costs
you isn't rotation — it's that you can never watch it being used. Federation is the same
deploy with that removed, and the line most likely to fail silently is the condition, not
the token.

## Follow-up resources

- [Configuring OpenID Connect in Google Cloud](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-google-cloud-platform) — GitHub's own setup, including "you must define at least one condition".
- [google-github-actions/auth](https://github.com/google-github-actions/auth) — direct vs. service-account federation, token lifetimes, and the attribute-condition warning.
- [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation) — pools, providers, attribute mapping and the `principalSet` syntax.
- [Deploying to Cloud Run](https://docs.cloud.google.com/run/docs/deploying) — the exact roles a deploy needs, including Service Account User on the service identity.
- [Cloud Run environment variables](https://docs.cloud.google.com/run/docs/configuring/services/environment-variables) — `--set-env-vars` is destructive; `--update-env-vars` isn't.
- [Identity-Aware Proxy for Cloud Run](https://docs.cloud.google.com/iap/docs/enabling-cloud-run) — what the audience value is and why the app should verify it.
