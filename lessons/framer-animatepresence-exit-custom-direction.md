---
id: lsn_framer_animatepresence_exit_custom_direction
title: "Fix AnimatePresence exits that animate in a stale direction — drive variants from `custom`"
type: debugging_lesson
tier: community
lesson_class: architecture
context:
  tools: []
  languages: [typescript, javascript]
  platforms: [web]
  tags: [framer-motion, animatepresence, react, animation, exit-animation]
summary: "An exiting AnimatePresence child resolves its `exit` variant against the props it had on its last render as a PRESENT child, not the current render. For direction-dependent enter/exit (staggered sweeps, carousels, flip-text) the exit then runs with a stale direction and fights the incoming element ('from both sides'). Fix: make the variant a function of `custom` and pass `custom` to AnimatePresence — it forwards its own `custom` to exiting children."
problem: |
  A per-letter flip whose stagger direction alternates each swap. Direction is
  baked into the variant at render time:

  ```tsx
  const container = (dir: 1 | -1): Variants => ({
    from: {},
    enter: { transition: { staggerChildren: 0.05, staggerDirection: dir } },
    exit:  { transition: { staggerChildren: 0.05, staggerDirection: dir } },
  });

  <AnimatePresence>
    <motion.span key={word} variants={container(dir)}
      initial="from" animate="enter" exit="exit">
      {letters}
    </motion.span>
  </AnimatePresence>
  ```

  When `word` changes, the OLD span is now exiting — but it keeps the
  `container(prevDir)` it was rendered with. So its `exit` staggers in
  `prevDir` while the new span enters in `dir`. With alternating direction the
  two sweep opposite ways → the letters look like they animate "from both
  sides" at once.
solution: |
  Make the variants FUNCTIONS of `custom`, and pass the live value to BOTH the
  element and `<AnimatePresence>`. AnimatePresence forwards ITS `custom` to
  exiting children, so the exit resolves against the current direction:

  ```tsx
  const container: Variants = {
    from: {},
    enter: (dir: 1 | -1) => ({
      transition: { staggerChildren: 0.05, staggerDirection: dir },
    }),
    exit: (dir: 1 | -1) => ({
      transition: { staggerChildren: 0.05, staggerDirection: dir },
    }),
  };

  <AnimatePresence custom={dir}>
    <motion.span key={word} custom={dir} variants={container}
      initial="from" animate="enter" exit="exit">
      {letters}
    </motion.span>
  </AnimatePresence>
  ```

  Now both the exiting and entering copy stagger in the same `dir` → a clean
  single-direction sweep.
gotchas:
  - "AnimatePresence forwards ONLY its own `custom` to exiting children; the child's own `custom` is frozen at its last present render. Set `custom` on BOTH `<AnimatePresence custom={x}>` AND the live `<motion.* custom={x}>`."
  - "Only matters when something that affects the EXIT changes between renders — slide/stagger direction, exit offset. A static exit (identical every time) needs no `custom`."
  - "Symptom triage: if the ENTER looks right but the EXIT looks backwards or 'from both ends', suspect a stale variant, not a timing/easing bug."
last_validated_at: "2026-06-03"
---

## When this bites

Any directional enter/exit where the direction is state and can change between
swaps: a carousel that slides left or right depending on nav direction, a
stagger that alternates L→R / R→L, a flip-text that reverses on hover-out.
The enter always looks correct (it's the current child, current props); the
exit is the one that goes stale.

## Why the exit is stale

When a keyed child leaves the tree, React would normally unmount it. framer-
motion's `AnimatePresence` keeps it mounted to play `exit`, but it renders the
*last committed* element — with the props/variants it had while present. Your
new `dir` lives on the NEW child, not the exiting one. The one prop
AnimatePresence injects fresh into exiting children is its own `custom`, which
is why the variant-as-function-of-custom pattern is the fix.

## When this does NOT apply

If your exit is identical every time — no direction, offset, or other input
that changes between renders — the baked-in variant is correct and `custom`
buys nothing. Likewise if you don't use an `exit` variant at all (e.g.
`mode="popLayout"` purely for layout shifts).

## Verification

Trigger a swap in each direction and watch a single letter/item at the seam:
outgoing and incoming should travel the same way. If you remove `custom`, the
exit reverts to the previous direction — a quick way to confirm the cause.
