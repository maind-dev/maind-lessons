---
id: lsn_log_rotation_before_mitigation_test
title: Rotate logs before mitigation deploys — otherwise pre- and post-mitigation aggregates merge silently
type: workflow_best_practice
tier: community
lesson_class: general
summary: Before deploying a mitigation (prompt-edit, config-bump, schema-tweak) against a running production-loop (dry-run scheduler, polling worker, continuous-validation agent), archive the existing log with a mitigation-name suffix and wipe relevant state-caches. Without rotation, aggregator scripts merge pre- and post-mitigation data into a single mean, destroying causal attribution. Log rotation is structural data hygiene, not optional polish.
context:
  tools:
    - claude-code
    - cursor
    - windsurf
    - copilot
  languages: []
  platforms: []
  tags:
    - agent-workflow
    - production-loops
    - mitigation-testing
    - data-hygiene
    - causal-attribution
    - log-management
last_validated_at: "2026-05-29"
---

## The failure mode

An agent recommends a mitigation (prompt-edit, config-bump, new examples, schema-tweak) to a system that runs continuously in production: a dry-run scheduler, a polling worker, a research-discovery loop, a continuous-validation agent. The user deploys the change, then runs the same aggregator script that was used pre-mitigation:

```bash
python3 /tmp/aggregate.py
```

The aggregator reads the entire log file from beginning to end. If the file accumulated thousands of lines under the OLD code before the mitigation was deployed, the aggregate is now a weighted mean of pre- and post-mitigation behavior. The "no_candidate dropped from 100% to 73%" finding is uninterpretable: it could mean the mitigation made every post-deploy decision 0% no_candidate (huge effect, diluted by pre-deploy 100% baseline), or the mitigation barely shifted post-deploy to 90% no_candidate (small effect, with pre-deploy 100% dragging the average up). Without rotation, the two scenarios produce indistinguishable aggregates.

## Why this is structural, not polish

Aggregators are usually one-shot scripts: `grep | sort | uniq -c` pipelines or short Python collators that don't know about deploy timestamps. Asking the aggregator to "filter by timestamp >= mitigation-deploy-time" adds complexity to every diagnostic call, requires the user to remember the deploy time, and breaks if the log lines don't include parseable timestamps.

Rotating the log file is a one-line operation that solves the problem at the source: post-mitigation data lives in a fresh file, pre-mitigation data is preserved at a clearly-labeled path, and every aggregator call against the current log is automatically scoped to post-mitigation only.

The same principle applies to relevant state caches: if the mitigation invalidates cached decisions (prompt-version-keyed scout caches, schema-version-keyed query caches, etc.), wipe the cache as part of the deploy step. Otherwise the first N post-deploy iterations show cached-old-behavior, contaminating the post-mitigation sample.

## The pattern

Before deploying any mitigation against a running loop, run the rotation sequence as one atomic block — log archive, code pull, state wipe, then loop restart:

```bash
# 1. Archive existing log with a mitigation-name suffix (the suffix is critical;
#    "pre-<mitigation>" lets future-you find the right file when comparing).
mv /tmp/run.log /tmp/run.pre-<mitigation>.log
echo "Archived: $(wc -l < /tmp/run.pre-<mitigation>.log) lines"

# 2. Deploy the mitigation (code-pull, config-set, env-export).
cd /workspace && git pull

# 3. Wipe any cache the mitigation invalidates. Skip if mitigation doesn't
#    touch cached state.
rm -rf .state/

# 4. Restart the loop. The first write to /tmp/run.log creates a fresh file.
while true; do
  do-the-work 2>&1 | tee -a /tmp/run.log
  sleep <interval>
done
```

For multi-stage mitigation campaigns (A then measure then B then measure then C), use a chain of suffixes: `run.pre-A.log` then `run.pre-B.log` then `run.pre-C.log` then `run.log` (current). Each diff is then between two consecutive archives, never between blended ones.

For pre-vs-post comparison, the aggregator takes a path argument:

```bash
python3 aggregate.py --log /tmp/run.pre-A.log > /tmp/pre-A.summary
python3 aggregate.py --log /tmp/run.log > /tmp/post-A.summary
diff /tmp/pre-A.summary /tmp/post-A.summary
```

## When this does not apply

- **Stateless one-shot mitigations**: if the system does not have a running loop (one-shot CLI run, single user request, batch job), there is no accumulating log to contaminate — just run the mitigation and observe its single output.
- **Append-only audit logs**: some systems require contiguous logs for compliance (audit trails, billing, immutable event sourcing). Rotate via copy + truncate to a separate analytic file, not by moving the source-of-truth audit log.
- **Cache-coupled prompts that auto-invalidate**: if the mitigation changes a prompt-version constant that is keyed into the cache (e.g., SCOUT_PROMPT_VERSION embedded in cache-keys), the cache automatically misses on old keys — explicit wipe is redundant. But the LOG still needs rotation; cache-auto-invalidation does not fix the log-blending problem.
- **Production traffic where loss of in-flight data is unacceptable**: graceful drain the running loop first (let in-flight requests complete, stop new ones), then rotate. Do not rotate while writes are mid-line.

## Detection in retrospective

If you see an aggregate output where the dominant skip_reason or rejection_reason proportions barely changed between two supposedly different mitigation states, OR if the count for any stage is suspiciously close to a multiple of the pre-mitigation count (suggesting added rather than replaced data), the log was not rotated and the aggregate is blended. Re-do the comparison with explicit rotation or with a timestamp-filtered aggregator.

A second symptom: aggregator reports a cache-hit skip-reason category with non-zero count immediately after a mitigation that should have invalidated all caches. Cache-state was not wiped, post-mitigation iterations are still serving stale cached decisions.

## Cross-references and generalisability

Quick discovery of related vetted conventions:

```
search_lessons({
  query: "production loop mitigation log data hygiene",
  tools: ["claude-code"],
  tier: "all"
})
```

Related curated conventions:

- [[lsn_agent_recommended_commands_prompt_free]] — agent-side discipline on the input side of remote-shell interactions.
- [[lsn_shell_output_sentinel_markers]] — agent-side discipline on the output side. Together with this convention, they form the trio for hygienic agent-user-loop interactions: prompt-free input, marked output, rotated logs.
- [[lsn_surface_silent_errors_first]] — broader theme: silent failures (blended aggregates, stale caches) are worse than loud ones because they look like valid signals.

Generalisability: this applies to any agent recommending a mitigation against any continuously-running production-loop (dry-run scheduler, polling worker, continuous-validation agent, log-tailing alert pipeline). The mechanism is universal to "aggregator-reads-entire-file" semantics, not specific to any one tool, OS, or shell.
