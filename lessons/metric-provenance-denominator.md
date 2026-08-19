---
id: lsn_metric_provenance_denominator
title: Diagnose a coverage metric that cannot show non-use — the degenerate cross-tab test
type: debugging_lesson
tier: community
tags:
  - telemetry
  - metrics
  - provenance
  - verification
  - data-pipeline
context:
  tools:
    - claude-code
    - cursor
    - windsurf
  languages:
    - sql
  platforms:
    - postgres
summary: When two producers write the same telemetry column under different derivation rules, an aggregate over the mixed population measures neither — and the giveaway is a perfectly degenerate cross-tabulation between that column and the one it was derived from. Detect it by cross-tabulating before trusting the metric; fix it with a declared provenance column, then filter the metric rather than switching its denominator wholesale.
---

## The failure mode

You have a telemetry table and a metric over it — a coverage rate, an adoption
share, a connection rate. The metric has a **denominator** with a stated
meaning: "sessions where the service was reachable", "installs that could have
used the feature", "requests eligible for the fast path".

Two different producers write rows into that table. They agree on the column
names. They do **not** agree on how one of those columns is derived:

- **Producer A** has direct evidence. It *is* the connection, so it can write
  `reachable = true` for a session that reached the service and never used it.
- **Producer B** only reads an artifact after the fact — a transcript, a log, an
  export. It cannot see reachability, so it infers: *"reachable if I can see at
  least one call."*

Both write the same column. The metric aggregates across both. And on
producer B's rows the denominator has silently collapsed into the numerator's
population: `reachable` is, by construction, the same set as "used the feature
at least once". A share computed over those rows **cannot show non-use** — the
exact thing the metric exists to reveal.

Nothing errors. The number renders. It is simply a narrower quantity wearing a
wider name.

## The detection: a perfectly degenerate cross-tab

The tell is cheap to compute and hard to argue with. Cross-tabulate the
suspect column against the column it might be derived from:

```sql
select reachable, (calls = 0) as no_calls, count(*)
  from telemetry
 group by 1, 2 order by 3 desc;
```

Healthy data fills the off-diagonal — there exist rows that were reachable and
made no call. What we found instead:

```
 53  unknown        | no calls      <- the whole population sits on
 44  reachable      | had calls     <- exactly two cells
  2  null           | null
  1  not_reachable  | no calls
```

**Zero** reachable-and-idle rows. **Zero** unknown-and-active rows. Two fields
that are perfectly collinear are not two measurements — one is a restatement of
the other, and any metric that needs them to differ is blind.

Then confirm the mechanism in code rather than inferring it from the
correlation. One line was enough:

```ts
if (Object.keys(toolCalls).length > 0) row.reachable = "connected";
```

### Do not stop at "structurally unmeasurable"

That first conclusion — *the metric can never work* — was too strong, and
checking it changed the fix entirely. Producer A's path had a second, richer
rule that **could** express the missing state:

```ts
if (freshPresenceSnapshot) return "connected";   // reachable, zero calls: expressible
if (sawCall)               return "connected";
if (presenceWasUsable)     return "not_connected"; // only here is silence informative
return "unknown";
```

So the design was sound; the *sample* was not. The distinguishing evidence sat
in the timestamps: **94 of 100 rows carried `updated_at` inside a single hour**
while their `created_at` spread over five days — the signature of a batch
import, not of live traffic. One producer had written 94 % of the table.

The difference matters: "unmeasurable" means redesign, "wrong sample" means
wait and label. Cheap check, opposite plans.

## The fix, in the order that survives contact

**1. Add a declared provenance column, do not derive it.** The rows are
byte-identical apart from this fact; the server cannot recover it. This is the
same declared-not-derived argument as
[[lsn_infra_provenance_declared_not_derived]], with one difference worth
naming: there, provenance is a display hint whose blast radius is deliberately
nil. Here it is a **precondition for the metric's validity** — so the default
must be the value that gets *excluded*:

```sql
ingest_source text check (ingest_source in ('live','import','unknown'))
-- absent/unknown -> counted OUT of reach metrics.
-- A producer that forgets the field costs itself visibility, never data quality.
-- The opposite default would silently re-create the contamination.
```

Protect the **pair**, not just the label, on upsert. The subtle bug: guarding
`ingest_source` while letting a later import overwrite the derived column
leaves a row claiming live provenance for an inferred verdict — precisely the
lie the column exists to prevent.

```sql
reachable = case when s.ingest_source = 'live'
                  and excluded.ingest_source is distinct from 'live'
                 then s.reachable else excluded.reachable end,
ingest_source = case when s.ingest_source = 'live' then 'live'
                     else excluded.ingest_source end
```

**2. Do NOT switch the denominator wholesale.** The obvious fix — restrict the
metric to trustworthy rows — empties the dashboard for as long as it takes the
new producer to accumulate data (here: weeks). A metric that reads 0/0 on the
day you fix it gets switched off, not repaired.

Ship it as a **flag** (`reach_grade_only`, default off) plus a **provenance
breakdown in the payload**. The honest denominator is then one switch away the
moment the data supports it, and an analysis can use it today without blanking
the shared view.

**3. Show the caveat only when it changes the reading.** A qualifier that is
always on is not read. Gate it on a threshold, and keep it to the number:

> `94 of 100 sessions cannot show non-use`

A clean installation has none of these rows and should see nothing at all —
otherwise every user pays, in attention, for one operator's import artifact.

## When this does not apply

- **One producer.** No mixed population, no distinction to record. Add the
  column when a second writer appears, not before.
- **The producers genuinely agree.** If both derive the column by the same rule,
  the aggregate is fine — but write the rule down in both places, because this
  failure is created by *divergence over time*, not by having two writers.
- **The mixed rows are a negligible share.** Provenance is still worth
  recording; the caveat is not worth showing (see the threshold above).
- **Metrics that do not depend on the diverging column.** The imported rows here
  stayed fully valid for volume, friction and momentum. Provenance marks *which
  questions* a row can answer — it is not a quality verdict, and deleting those
  rows would have been the wrong move.

## Verification and related practice

```sql
-- 1. The cross-tab must have off-diagonal mass:
select reachable, (calls = 0) as idle, count(*) from telemetry group by 1,2;

-- 2. The ledger is a claim; the schema is the truth. Check the state directly:
select p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'your_metric_fn';
-- exactly one signature: a changed argument list creates a SECOND function,
-- not a replacement, and both then answer.
```

Retrieval:

```
search_lessons({ query: "metric denominator collinear provenance two producers telemetry", tags: ["metrics", "provenance"] })
```

Neighbouring vetted conventions:

- [[lsn_infra_provenance_declared_not_derived]] — declared-not-derived
  provenance for *display*, where the blast radius is deliberately nil. This
  entry is the case where the same mechanism is load-bearing for a **metric's
  validity**, which flips the safe default.
- [[lsn_measure_before_build_refuted_salvage]] — the construct-validity family:
  an instrument whose headline claims more than it measures.
