# HS Portal — extension (M0 + M1)

A clean, **zero-build, load-unpacked** MV3 Chrome extension — the Milestone M0/M1 fork of
Redaily (see [`../PLAN.md`](../PLAN.md) §12). Engine logic is **reimplemented** from
Redaily's deobfuscated bundle (selectors + action sequences), **not** the minified blob.
No cloud, no phone-home, our own extension identity.

## What works

**M0 — manual actions.** Open a Xiaohongshu note, open the popup → **Manual actions**, and
drive one action end-to-end: **like · collect · follow · scroll · dwell · comment (types
only, never submits)**. Every action runs through the humanized primitives (jittered
timing, full mouse-event sequence).

**M1 — governed session runner.** Press **▶ Run session** to run a `Plan` (lib/plan.js)
as a governed loop:
- The loop lives in the content script; the **governor** lives in the background and is
  queried before *every* action (caps + risk + stop) — see `lib/governor.js`.
- **Caps are enforced** (per-hour / per-day from config); crossing a cap stops that action
  with a visible reason. The popup shows live counters vs caps.
- **Risk-backoff**: a DOM-level captcha/slider/verify signal pauses *all* actions with
  exponential backoff (30 s → 15 min cap).
- **Dry-run** (default): logs each intended action — dispatches nothing — but still runs
  the governor, so you can watch the caps engage. Untick **dry-run** for live.
- **Kill switch**: ■ Stop halts immediately.

> Dry-run **intentionally increments the real counters** so you can see the governor work.
> Use **↺ reset counters** to clear them between tests.

**All three 养号 modes** are wired (pick in the popup's **Plan** editor → mode):
- **discovery** — searches `seeds[0]` as a keyword, then browses results: open note → act → close → next.
- **comment_section** — navigates each `seeds` note URL → gathers commenters → `matchTarget` filter → like/reply/gather each.
- **profile** — navigates each `seeds` profile URL → reads user → filter (gender/followers/IP) → follow.

The **Plan editor** in the popup configures mode, seeds, action mix + counts, target filter, and
pacing — and is exactly the shape the AI planner will emit later.

The `shield/webprofile` DNR rules (block + header normalization) are lifted from Redaily
and load as a static ruleset.

## Load it in Chrome

1. Go to `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Open a note on `https://www.xiaohongshu.com/` (click any post so `#noteContainer` is present).
5. Click the **HS Portal** toolbar icon → the popup shows the note state → press an action.

> After loading the extension, **reload any already-open XHS tab once** so the content
> script injects.

## Layout

```
extension/
  manifest.json            MV3, our own ID (no Redaily key/update_url), XHS-scoped hosts
  rules/shield.json        DNR: block + header-spoof on as.xiaohongshu.com shield endpoint
  src/
    lib/human.js           humanized primitives (jittered delay, simulateClick, scroll, typeText)
    lib/plan.js            Plan schema (brain↔spine contract): modes, filters, actionMix, matchTarget
    lib/governor.js        frequency governor + risk-backoff (pure logic; node-testable)
    content/engine.js      XHS selectors + action executors + session runner + message bridge
    background.js          orchestrator: local config + Plan + governor; popup→content routing (NO cloud)
  popup/                   vanilla dashboard: session runner + live governor (Redaily's React UI dropped)
```

## Deliberate limits (by design, this milestone)

- **Targeting is not wired into the loop yet** — the runner acts on the open note / feed
  in order; the `gather` → filter → queue pipeline (Plan `targetFilter`/`seeds`) is next.
- **Comments are typed, not submitted** — no-burn safety (PLAN §13); AI comment source stubbed.
- **Risk detection is DOM-level only** — network 461/empty-response detection (webRequest) is a Tier-1 refinement.
- **MV3 SW lifetime** — fine while a session runs (the runner pings the SW each action); a
  persistent-keepalive/alarms tick is a later hardening.

## Migration notes

- Engine selectors are valid as of Redaily v3.3.2; if XHS changes its DOM, edit
  `SEL` in `src/content/engine.js` (a config-update, not a re-ship — PLAN §1).
- This zero-build setup is the M0 stepping stone; the Plasmo/React/TS stack (PLAN §5)
  is introduced at M2 when the GUI gets real. `human.js` / `engine.js` port as-is.
