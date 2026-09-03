---
title: "On a small tip, the 5% isn't the fee that hurts"
description: "On a $3 tip, the fixed card fee matters more than the platform's advertised 5% cut."
pubDate: 2026-07-28
tags: ["payments", "web", "til"]
draft: false
---

I added a *buy me a coffee* button to [Verso](https://verso.metzner.uk), my
little book-scanning side project. Before wiring it up I wanted to know the
obvious thing: of a €3 coffee, how much actually lands in my account? I assumed
the answer was "minus 5%". It isn't.

## The fee that hides behind the headline

Buy Me a Coffee's marketing is a clean **5% platform fee**. What their own
[help docs](https://help.buymeacoffee.com/en/articles/8105744-how-to-calculate-charges-on-your-payment)
spell out is that the fees *stack*: 5% platform **+** Stripe's 2.9% + \$0.30 **+**
a 0.5% payout fee, plus surcharges (+1% international, +0.5% on subscriptions).

Run a \$5 coffee through that:

```
platform  5%            $0.25
stripe    2.9% + $0.30  $0.445   // the $0.30 is fixed, per transaction
payout    0.5%          $0.025
                        ------
keep                    ~$4.28   (≈86%)
```

Now the same stack on a \$3 coffee → you keep ~\$2.45, about **82%**. On a \$50
membership → ~91%. Same fee structure, wildly different efficiency. The 5% is
constant; the thing moving the number is Stripe's fixed **\$0.30**, which is a
10% tax on a \$3 tip and a rounding error on \$50.

## So skip the platform and go direct?

Direct Stripe from Austria is
[1.5% + €0.25](https://stripe.com/pricing) on a standard EEA card (BMC bills in
dollars, my Stripe settles in euros — mind the currency, but the shape is the
same), so a €3 coffee nets ~€2.70 (≈90%) — you drop the 5% platform cut, the
0.5% payout fee, the surcharges *and* the card rate falls from 2.9% to 1.5%.
Real money over time. But you still pay the **fixed €0.25**, because
that fee isn't the platform's, it's the card network's, and nobody makes it
disappear.

Which is the actual lesson: the percentage cuts are the part you can shop around,
and the fixed per-transaction fee is just the cost of moving small money — it
dominates a small tip whoever you route through.

So: if you already have a site and want to keep the extra ~8 points a small
coffee loses to the stack (the platform's own cut *plus* the lower card rate), a
Stripe [Payment Link](https://stripe.com/payments/payment-links) is a button you
can host yourself. If you want a hosted page, discovery, and zero setup, BMC's stack
is a fair price for not building any of that. Either way: gently nudge people
toward one bigger coffee instead of three small ones.

## Follow-up resources

- [Buy Me a Coffee — how charges are calculated](https://help.buymeacoffee.com/en/articles/8105744-how-to-calculate-charges-on-your-payment)
- [Stripe pricing](https://stripe.com/pricing)
- [Stripe Payment Links](https://stripe.com/payments/payment-links)
