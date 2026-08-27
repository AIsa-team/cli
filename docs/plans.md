# Resource plans (preview)

A **plan** is a pre-flight **resource manifest and credit quote**. An upstream
agent adds items — each bound to a `capability@version` and a typed scope —
then the CLI checks the manifest and prices it locally.

This release is a **local preview**. Quotes are computed by a local engine from
verified public pricing rules and stamped `authority=local_preview`. They are
**not** a server-side quote, they **do not** reserve credits, and they **must
not** be treated as a spend lock. Re-quote before you spend; the number on
screen is an explanation of the current manifest, not a hold.

Similarweb capabilities are **charged only on success**. A failed call does not
consume the quoted credits.

Plans live at `~/.aisa/plans/<plan_id>.json`. Set `AISA_PLAN_DIR` to store them
somewhere else.

## Plan is data, not a program

A plan has no conditionals, no loops, and no dataflow. It does not branch, it
does not iterate, and one item cannot read another item's result.

Anything that looks like control flow belongs to the **agent**, across multiple
CLI invocations:

- A loop is "add / check / quote / run / `item-replace`" repeated, not a
  construct inside the plan.
- A dependency on an upstream result is a **placeholder** (capability + a
  spend ceiling). After the result arrives, `item-replace` writes a concrete
  scope. Until then the item is not executable.
- `--after` and `--on-dep-failure` record ordering and a skip/proceed hint.
  They do not execute anything and they do not pass values between items.

If you need `if`, `for`, or a pipeline, keep that logic in the agent. The plan
only stores what you intend to buy.

## Cost models

Every registry entry is in one of four states. The state decides what `quote`
can say about an item.

| Model | What `estimate` and `max` mean | Example |
|-------|--------------------------------|---------|
| `exact_formula` | `estimate == max`. A closed formula over the scope. | Traffic & Engagement: `1 × metrics × countries × monthly buckets` |
| `bounded_response` | Billed per response row, with a provider hard cap. `max = rate × cap`. | Referrals: 3 credits/row, cap 20 rows → max 60 |
| `fixed` | A constant price, independent of scope beyond the required fields. | Demographics: 8 credits |
| `unknown` | Pricing is not verified. `estimate` is empty. `--max-credits` on the item is the **only** spend ceiling. | `web_search.tavily@1` (`catalog_only`) |

`unknown` without `--max-credits` is a gap (`unverified_pricing`). `check`
fails and `quote` is blocked (exit 3). Do not guess a number; set the ceiling
explicitly.

Each quoted item carries an explainable **basis**: the formula, the inputs
plugged into it, the public source, and the date that source was verified.
Totals are the sum of item `estimate` values (skipping empty ones) and the sum
of item `max` values.

## Placeholders

Use `--placeholder` when the concrete scope is not known yet — typically
because it depends on another call's result.

A placeholder stores:

- the capability (what you will buy)
- `--max-credits` (the only spend ceiling until the item is materialised)
- optional `--after`, `--phase`, `--note`

It does **not** store a typed scope you can execute. `check` reports
`needs_upstream_result` for every placeholder. `quote` can still produce a
preview: the placeholder contributes its `--max-credits` to `max` and leaves
`estimate` empty.

When the upstream result is in hand, materialise the item:

```bash
aisa plan item-replace pln_3f8a1c2b itm_c3d4e5f6 \
  --scope domain=acme.com --scope country=us
```

The capability stays the same; the scope becomes concrete. Any existing quote
turns **stale** (the manifest hash changed).

## Exit codes

Agents should branch on these. Do not parse English sentences to decide
whether a quote is usable.

| Code | When | Typical next step |
|------|------|-------------------|
| `0` | Success | Proceed, or run `quote` / `show` |
| `2` | Quote exceeds the plan budget (`over_budget`) | Raise the budget, drop items, or narrow scope |
| `3` | Validation failed, or quote was blocked (`invalid` / gaps) | Read the gaps; add missing scope, set `--max-credits`, or `item-replace` |
| `1` | Any other error (unknown plan, bad flags, I/O, …) | Fix the invocation |

`check` exits `3` when the manifest has gaps. `quote` exits `3` when it cannot
produce a quote (invalid manifest or an `unknown` item without a ceiling) and
`2` when a quote was produced but the totals exceed a `hard` budget. An
`advisory` budget never triggers exit `2`; it is reported, not enforced.

## Command reference

All commands live under `aisa plan`. Most accept `--json` for automation.
Illustrative output below is representative, not a schema guarantee.

### `aisa plan create`

Create an empty plan. Prints a `pln_` id (eight hex digits).

```bash
aisa plan create
aisa plan create --intent "GTM research for acme.com" \
  --budget-credits 80 --budget-policy advisory
aisa plan create --budget-credits 40 --budget-policy hard --json
```

| Option | Meaning |
|--------|---------|
| `--budget-credits <n>` | Optional credit ceiling |
| `--budget-policy hard\|advisory` | `hard` makes `quote` exit `2` on overflow; `advisory` only annotates |
| `--intent <text>` | Free-text purpose; not executed |
| `--json` | Machine-readable result |

```
Created  pln_3f8a1c2b
Intent   GTM research for acme.com
Budget   80 credits  advisory
```

### `aisa plan list`

List plans in `AISA_PLAN_DIR` (or `~/.aisa/plans`).

```bash
aisa plan list
aisa plan list --json
```

```
pln_3f8a1c2b  3 items  budget 80 advisory  GTM research for acme.com
pln_9aa01e44  1 item   no budget           competitor traffic
```

### `aisa plan show`

Print the plan, its items, and the **freshness** of the last quote (if any).

```bash
aisa plan show pln_3f8a1c2b
aisa plan show pln_3f8a1c2b --json
```

| Freshness | Meaning |
|-----------|---------|
| `fresh` | Quote matches the current manifest and is within the 15-minute TTL |
| `stale` | The plan changed after the quote (manifest hash no longer matches) |
| `expired` | The quote is older than 15 minutes |

Any mutation — add, replace, remove, set-budget — changes the manifest hash
and makes a previous quote `stale`. `quote` writes a new hash and restarts
the TTL.

```
Plan     pln_3f8a1c2b
Intent   GTM research for acme.com
Budget   80 credits  advisory
Items    3
Quote    local_preview  fresh  ttl 12m
Hash     sha256:4f3c8a1b…
```

### `aisa plan discover`

Search the local capability registry (v0). No network request.

```bash
aisa plan discover similarweb
aisa plan discover "referral" --json
```

```
similarweb.referrals@1         bounded_response  3 cr/row  cap 20
similarweb.similar_sites@1     bounded_response  2 cr/row  cap 20
similarweb.website_keywords@1  bounded_response  0.13 cr/row  cap 20
```

### `aisa plan add`

Append an item. Repeat `--scope k=v` for each field.

```bash
aisa plan add pln_3f8a1c2b similarweb.demographics@1 \
  --scope domain=acme.com

aisa plan add pln_3f8a1c2b similarweb.referrals@1 \
  --placeholder --max-credits 60 \
  --after itm_a1b2c3d4 --on-dep-failure skip \
  --phase enrich --note "country from traffic mix"

aisa plan add pln_3f8a1c2b web_search.tavily@1 \
  --max-credits 5 --json
```

| Option | Meaning |
|--------|---------|
| `--scope k=v` | Typed scope field (repeatable) |
| `--placeholder` | Capability + ceiling only; not executable until `item-replace` |
| `--max-credits <n>` | Item-level spend ceiling. **Required** for `unknown` pricing and expected on placeholders |
| `--after <ids>` | Predecessor item ids (ordering hint, not dataflow) |
| `--on-dep-failure skip\|proceed` | What the agent should do if a predecessor fails |
| `--phase <p>` | Optional label for grouping in the agent |
| `--note <text>` | Free-text annotation |
| `--json` | Machine-readable result |

```
Added  itm_b2c3d4e5  similarweb.demographics@1
Scope  domain=acme.com
```

### `aisa plan item-replace`

Materialise a placeholder with a concrete scope. The capability does not
change.

```bash
aisa plan item-replace pln_3f8a1c2b itm_c3d4e5f6 \
  --scope domain=acme.com --scope country=us

aisa plan item-replace pln_3f8a1c2b itm_c3d4e5f6 \
  --scope domain=acme.com --scope country=us \
  --max-credits 60 --phase enrich --note "US is 41% of visits" --json
```

| Option | Meaning |
|--------|---------|
| `--scope k=v` | Concrete scope (repeatable) |
| `--max-credits <n>` | Optional new ceiling |
| `--phase <p>` | Optional phase label |
| `--note <text>` | Optional annotation |
| `--json` | Machine-readable result |

The last quote becomes `stale`.

### `aisa plan item-remove`

Drop an item from the plan.

```bash
aisa plan item-remove pln_3f8a1c2b itm_b2c3d4e5
```

### `aisa plan set-budget`

Set or replace the plan budget.

```bash
aisa plan set-budget pln_3f8a1c2b 80
aisa plan set-budget pln_3f8a1c2b 20 --policy hard
```

`--policy` is `hard` or `advisory` (same meaning as `create --budget-policy`).
Changing the budget updates the manifest hash, so a previous quote is `stale`.
A subsequent `quote` against a `hard` budget that the totals exceed exits `2`.

### `aisa plan check`

Deterministic local validation. Reports gaps; does not price.

```bash
aisa plan check pln_3f8a1c2b
aisa plan check pln_3f8a1c2b --json
```

| Gap | Meaning |
|-----|---------|
| `missing_required` | A required scope field is absent (e.g. no `domain`) |
| `needs_upstream_result` | The item is still a placeholder |
| `unverified_pricing` | `unknown` cost model and no item-level `--max-credits` |

Exit `0` when the manifest is complete. Exit `3` when any gap is present.

```
Plan  pln_3f8a1c2b  invalid

Gaps
  itm_c3d4e5f6  needs_upstream_result
    similarweb.referrals@1 is a placeholder; replace it after the
    upstream result is known.
```

### `aisa plan quote`

Price the current manifest. Each item gets an `estimate` and a `max`, plus a
basis (formula, inputs, source, verified date). The quote carries a SHA-256
**manifest hash** — any later edit makes it `stale` — and a **15-minute TTL**,
after which `show` reports `expired`.

```bash
aisa plan quote pln_3f8a1c2b
aisa plan quote pln_3f8a1c2b --json
```

```
Quote    local_preview  fresh
Hash     sha256:4f3c8a1b…    ttl 15m
Budget   80 credits  advisory

itm_a1b2c3d4  similarweb.traffic_engagement@1
              estimate 18   max 18
              1 × 3 metrics × 1 country × 6 months
              source aisa.one/api/similarweb  verified 2026-08-27

itm_b2c3d4e5  similarweb.demographics@1
              estimate 8    max 8
              fixed 8 credits
              source aisa.one/api/similarweb  verified 2026-08-27

itm_c3d4e5f6  similarweb.referrals@1  (placeholder)
              estimate —    max 60
              ceiling --max-credits 60

Totals   estimate 26   max 86
```

`--json` includes `authority: "local_preview"` on the quote. Treat that field
as a reminder: this number was not issued by the billing service.

Exit `0` when the quote is usable. Exit `2` on `over_budget` (`hard` policy).
Exit `3` when gaps block pricing.

### `aisa plan delete`

Delete the plan file.

```bash
aisa plan delete pln_3f8a1c2b
```

## Capability registry v0

Pricing below was verified on **2026-08-27** against the public Similarweb
page at [https://aisa.one/api/similarweb](https://aisa.one/api/similarweb).
All Similarweb capabilities are **charged only on success**.

| Capability | Model | Pricing | Scope | Verified |
|------------|-------|---------|-------|----------|
| `similarweb.traffic_engagement@1` | `exact_formula` | 1 credit × metrics × countries × monthly buckets | `domain`, `metrics` (comma-separated), `country` (default `world`), `start` / `end` (`YYYY-MM`), `granularity` (monthly only), `main_domain_only` | 2026-08-27 |
| `similarweb.demographics@1` | `fixed` | 8 credits | `domain` | 2026-08-27 |
| `similarweb.technologies@1` | `fixed` | 10 credits | `domain` | 2026-08-27 |
| `similarweb.referrals@1` | `bounded_response` | 3 credits/row, cap 20 rows | `domain`, `country` | 2026-08-27 |
| `similarweb.similar_sites@1` | `bounded_response` | 2 credits/row, cap 20 rows | `domain` | 2026-08-27 |
| `similarweb.website_keywords@1` | `bounded_response` | 0.13 credits/row, cap 20 rows | `domain` | 2026-08-27 |
| `web_search.tavily@1` | `unknown` | Unverified (`catalog_only`). `--max-credits` is required. | — | — |

`discover` is the runtime view of this table. Registry v0 is the set the
local quote engine knows how to price; it is not the full AIsa catalog.

## Walkthrough: GTM research for a competitor

An agent is sizing acme.com before a launch. Traffic and demographics are
known up front. Referrals need a country that only the traffic call can
choose, so that item starts as a placeholder.

### 1. Create the plan

```bash
aisa plan create --intent "GTM research for acme.com" \
  --budget-credits 80 --budget-policy advisory
# pln_3f8a1c2b
```

### 2. Add three items (one placeholder)

```bash
aisa plan add pln_3f8a1c2b similarweb.traffic_engagement@1 \
  --scope domain=acme.com \
  --scope metrics=visits,page_views,bounce_rate \
  --scope country=world \
  --scope start=2026-01 --scope end=2026-06 \
  --scope granularity=monthly
# itm_a1b2c3d4
# exact: 1 × 3 metrics × 1 country × 6 months = 18 credits

aisa plan add pln_3f8a1c2b similarweb.demographics@1 \
  --scope domain=acme.com
# itm_b2c3d4e5
# fixed: 8 credits

aisa plan add pln_3f8a1c2b similarweb.referrals@1 \
  --placeholder --max-credits 60 \
  --after itm_a1b2c3d4 --on-dep-failure skip \
  --phase enrich --note "country from traffic mix"
# itm_c3d4e5f6
```

The third item cannot run yet. That is expected: the plan stores the
intention and a ceiling, not a country.

### 3. Check — gaps, exit 3

```bash
aisa plan check pln_3f8a1c2b
# exit 3
```

```
Plan  pln_3f8a1c2b  invalid

Gaps
  itm_c3d4e5f6  needs_upstream_result
    similarweb.referrals@1 is a placeholder; replace it after the
    upstream result is known.
```

The first two items are complete. The gap is only the placeholder. The agent
can still quote a ceiling; it cannot treat the plan as executable.

### 4. Quote — ready

```bash
aisa plan quote pln_3f8a1c2b
# exit 0
```

```
Quote    local_preview  fresh
Hash     sha256:4f3c8a1b…    ttl 15m
Budget   80 credits  advisory

itm_a1b2c3d4  estimate 18   max 18   exact_formula
itm_b2c3d4e5  estimate 8    max 8    fixed
itm_c3d4e5f6  estimate —    max 60   placeholder ceiling

Totals   estimate 26   max 86
```

`authority=local_preview`: this is a local explanation, not a reservation.
`max` 86 is above the advisory budget of 80 — annotated, not rejected.

### 5. Tighten the budget — `over_budget`, exit 2

The agent decides the real ceiling is 20 credits and wants the CLI to refuse.

```bash
aisa plan set-budget pln_3f8a1c2b 20 --policy hard
aisa plan quote pln_3f8a1c2b
# exit 2
```

```
Quote    local_preview  fresh
Budget   20 credits  hard
Totals   estimate 26   max 86
over_budget
```

Exit `2` is the signal to raise the budget, drop an item, or narrow scope.
Here the agent raises the budget back so the rest of the research can proceed:

```bash
aisa plan set-budget pln_3f8a1c2b 90 --policy hard
```

### 6. Materialise the placeholder

Traffic comes back: the United States is the country to pull referrals for.

```bash
aisa plan item-replace pln_3f8a1c2b itm_c3d4e5f6 \
  --scope domain=acme.com --scope country=us \
  --note "US is 41% of visits"
```

`check` is now clean (exit 0). The previous quote is `stale` — the manifest
hash changed.

### 7. Quote again

```bash
aisa plan quote pln_3f8a1c2b
# exit 0
```

```
Quote    local_preview  fresh
Budget   90 credits  hard

itm_a1b2c3d4  estimate 18   max 18
              1 × 3 × 1 × 6
itm_b2c3d4e5  estimate 8    max 8
              fixed
itm_c3d4e5f6  estimate 3    max 60
              3 credits/row × up to 20 rows
              source aisa.one/api/similarweb  verified 2026-08-27

Totals   estimate 29   max 86
```

Referrals is now a real `bounded_response` item: `max` is `rate × cap`
(3 × 20). The quote is still a local preview. When the agent later calls
the API, only a successful Similarweb response is charged.
