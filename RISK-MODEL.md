# XHS Risk Model — Signals · Red Lines · Limits

> **Purpose:** the single source of truth for (A) what XHS uses to detect/flag automation, (B) what we must never do, and (C) the numeric limits. This file drives **both** the governor logic and the GUI config schema (every limit in §C becomes an adjustable bar/cap in the dashboard).
> **Target:** mainland Xiaohongshu (xiaohongshu.com), real-browser extension.
> **Date:** 2026-06-06
> **Sources & confidence:** `T` = observed in the Redaily teardown (code); `R` = web research (practitioner/repos); `B` = 养号 blog (vendor/community heuristic — treat as conservative default, *not* proven spec).
> **Sequenced after:** [`PLAN.md`](./PLAN.md).

---

## A. Threatening signals (what flags you) — detect, mitigate, surface

| # | Signal | How it manifests | Our mitigation | Surface in GUI |
|---|---|---|---|---|
| A1 | **`shield/webprofile` telemetry** (the risk gate) `T,R` | XHS collects fingerprint/behavior at `as.xiaohongshu.com/api/sec/v1/shield/webprofile` | **Block** it via DNR + normalize UA/`sec-ch-ua` headers (inherited from Redaily) | `shield blocked ✓` indicator |
| A2 | **Session incoherence** `R` | `a1` ⇄ `web_session` ⇄ `gid` ⇄ `webId` ⇄ UA/screen must all agree | Use real login; never hand-edit cookies | Session-health check |
| A3 | **IP region mismatch (异地风控)** `R,B` | mainland account driven from a US/foreign IP, or IP that hops continents/provinces | Dedicated **CN static-residential** IP, fixed per account, city matched | Current IP + region + "matches account?" |
| A4 | **Datacenter / shared IP** `R,B` | non-residential ASN, or IP reused across accounts | Residential/4G only; one IP per account | IP type / purity flag |
| A5 | **IPv6 / WebRTC leak** `R` | real IPv6 `/64` logged to `log.xiaohongshu.com`; WebRTC exposes real IP behind proxy | Disable IPv6 + WebRTC at browser/OS level | Leak self-test (pass/fail) |
| A6 | **Timezone / language mismatch** `R,B` | IP says Shanghai, TZ says US, lang says EN | TZ + language match the IP region | Consistency check row |
| A7 | **`isTrusted:false` events** `T` | content-script synthetic clicks aren't user-trusted | Phase-2: `chrome.debugger` CDP input → `isTrusted:true` for high-risk actions | Input mode (synthetic / trusted) |
| A8 | **Fixed / periodic timing** `T` | identical 2000ms cadence, zero variance | Jitter every delay (`Math.random`) | Shows live randomized intervals |
| A9 | **秒赞秒退 (like-and-bounce)** `B` | engaging in <10s, no dwell | Min per-note dwell ≥10s (养号 10–30s) | Dwell setting + enforcement |
| A10 | **High frequency** `R,B` | >50 req/min; rapid same-endpoint hits; over-cap actions | Frequency governor (§C) | Behavior bars vs caps |
| A11 | **24/7 operation** `B` | no rest, runs around the clock | Working-hours window; 8–10h/day | Schedule + golden-hours toggles |
| A12 | **Device/IP/fingerprint sharing** `B,R` | multiple accounts, one environment | One-account-one-environment | Per-account env binding |
| A13 | **AI-template comments** `R,B` | generic "好美/666"/copy-paste/LLM-template phrasing | Persona voice + anti-AI-text gate | Comment-quality indicator |
| A14 | **Publish without slider (`x-c-risk`)** `R` | v8.42 requires a slider session to publish | Separate publish path: human-confirm or 打码 | Publish gate (engagement engine never publishes) |
| A15 | **Active block responses** `R` | 461 / sign-error / empty response / 限流 / captcha appears | Detect → pause → exponential backoff → health drop | Risk feed + auto-pause banner |
| A16 | **DOM-change breakage** `T` | hardcoded selectors return null ("元素为空…") | Resilient + hot-updatable selectors | "DOM changed" alert |

---

## B. Red lines — things we must NEVER do

Hard "never" list (enforced as constraints or loud warnings). Sources in brackets.

- ❌ **Run >1 account per device / IP / fingerprint** — 一机一卡一号. The #1 linkage vector. `B,R`
- ❌ **秒赞秒退** — engage with a note in <10s. `B`
- ❌ **Fixed / periodic timing** — no automation rhythm without jitter. `T`
- ❌ **24/7 / no rest** — must mimic a human's daily rhythm. `B`
- ❌ **Exceed the frequency caps** in §C. `B,R`
- ❌ **Keep acting after a risk signal** (A15) — must back off, not hammer. `R`
- ❌ **Hop IPs / cross-province / datacenter IP / mismatched timezone.** `R,B`
- ❌ **Publish ads / 引流 / 敏感词 during 养号 or on a new account.** `B`
- ❌ **Auto-publish on the engagement engine** — publishing is a separate, higher-ceremony path. `R`
- ❌ **AI-template-y comments** — no "好美/666", no copy-paste, no obvious LLM phrasing. `R,B`
- ❌ **Irregular usage** (三天打鱼两天晒网) — consistency is itself a weight signal. `B`
- ❌ **Phone the session home** to any third party (Redaily's `yanghao.app` mistake). `T`
- ❌ **Fake the fingerprint** of the operating browser — the real environment is the asset; only *isolate* across accounts, don't *forge*. `T,R`
- ❌ **Ship over-broad permissions or obfuscated code** — `https://*/*`, etc. → Web Store rejection + user distrust. `T`

---

## C. Limits — caps & thresholds (the GUI config schema)

Each row becomes an adjustable bar/cap in the dashboard. Defaults below; **all heuristic — tune by observation.** `Conservative` = new/養号 account; `Standard` = aged account; `Hard` = don't exceed regardless.

| Metric | Conservative | Standard | Hard ceiling | Window | Src |
|---|---|---|---|---|---|
| Likes (点赞) | ≤20 | ≤30 | — | per hour | `B` |
| Follows (关注) | ≤30 | ≤50 | — | per day | `B` |
| Comments (评论) | ≤10 | ≤10 | — | per hour | `B` |
| Comments (评论) | ≤10 | ≤20 | — | per day | `B` |
| DMs (私信) | ≤15 | ≤20 | — | per day | `B` |
| Collects (收藏) | 2–3 | 3–5 | — | per day (养号 baseline) | `B` |
| Action interval | 3–8 (jittered) | 3–8 | ≥ ~30s never-burst | minutes | `B` |
| Comment interval | 5–15 | 5–15 | — | minutes | `B` |
| Per-note dwell | 10–30 | ≥10 | ≥10 (never <10) | seconds | `B` |
| Daily browsing | 1–2h, split 3–5 sessions | 1–2h | — | per day | `B` |
| Operating window | 8–10 | 8–10 | <24 (never 24/7) | hours/day | `B` |
| Golden hours | 07–09 / 12–13 / 20–22 | same | — | local time | `B` |
| Requests | — | — | **<50/min**, ≤100 reads/IP/day | — | `R` |
| Publish (later) | — | — | ≤~40/day, ≥2min spacing | per day | `R` |

**养号 ramp (account-warming schedule):** cycle 7–15 days; **first 3 days most critical**; days 1–3 = low-frequency browse + a few genuine likes/comments, no publishing. `B`

**Targeting weight reference** (single-note score → prioritize high-value actions): 关注 +8 · 分享 +4 · 评论 +4 · 点赞 +1 · 收藏 +1 · 举报 −. Collects/follows/comments are worth more than likes. `B`

---

## D. Governor behavior spec (how A–C combine in the GUI)

- **Bar fills toward cap** → on crossing, **stop that specific action**, turn the bar red, show the reason. (Other actions continue.)
- **Risk signal (A15) detected** → **pause the account**, log to the risk feed, drop the health score, apply exponential backoff before resume.
- **Leak / consistency check fails (A3–A6)** → warn before starting; block start if IP region ≠ account region.
- **Transparency over automation:** prefer visible caps + manual control over hidden auto-behavior. The user should always see *what* and *why*. Minimal opaque intervention.
