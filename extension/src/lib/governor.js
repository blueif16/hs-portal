// governor.js — the frequency governor + risk state (pure logic, node-testable).
//
// This is the "clamp" that Redaily never had (teardown §8: no caps, no backoff).
// The background owns a GovState in storage; the content runner asks `canAct` before
// every action and reports `recordAction` after. Caps come from the local config
// (PLAN §11 Tier 1 / RISK-MODEL §C). Counters are timestamp lists so rolling
// per-hour / per-day windows are exact.

(function () {
  const g = globalThis;
  const NS = (g.__hs = g.__hs || {});
  if (NS.governor) return;

  const HOUR = 3600e3;
  const DAY = 86400e3;
  const ACTIONS = ["like", "collect", "follow", "comment"];

  function createGovState() {
    return {
      session: { running: false, paused: false, startedAt: 0, plan: null, notesVisited: 0, actionsTaken: 0 },
      counters: { like: [], collect: [], follow: [], comment: [] },
      risk: { paused: false, level: 0, until: 0, lastSignal: null },
    };
  }

  const within = (arr, span, now) => (arr || []).filter((ts) => now - ts < span).length;

  function actionStats(state, action, caps, now) {
    const c = (caps && caps[action]) || {};
    return {
      perHour: within(state.counters[action], HOUR, now),
      perDay: within(state.counters[action], DAY, now),
      hourCap: c.perHour == null ? null : c.perHour,
      dayCap: c.perDay == null ? null : c.perDay,
    };
  }

  // canAct — may this action fire right now? Order: session → pause → risk → caps.
  function canAct(state, action, caps, now) {
    if (!state.session.running) return { allow: false, reason: "session not running" };
    if (state.session.paused) return { allow: false, reason: "paused" };
    if (state.risk.paused && now < state.risk.until)
      return { allow: false, reason: "risk backoff " + Math.ceil((state.risk.until - now) / 1000) + "s" };
    const s = actionStats(state, action, caps, now);
    if (s.hourCap != null && s.perHour >= s.hourCap)
      return { allow: false, reason: "hourly cap " + s.perHour + "/" + s.hourCap, stats: s };
    if (s.dayCap != null && s.perDay >= s.dayCap)
      return { allow: false, reason: "daily cap " + s.perDay + "/" + s.dayCap, stats: s };
    return { allow: true, stats: s };
  }

  function recordAction(state, action, now) {
    const list = (state.counters[action] = state.counters[action] || []);
    list.push(now);
    // trim anything older than a day — keeps the arrays bounded
    state.counters[action] = list.filter((ts) => now - ts < DAY);
    state.session.actionsTaken = (state.session.actionsTaken || 0) + 1;
    return state;
  }

  // Exponential backoff: 30s, 60s, 120s, … capped at 15 min.
  function backoffMs(level) {
    return Math.min(30e3 * Math.pow(2, Math.max(0, level - 1)), 15 * 60e3);
  }

  function applyRisk(state, signal, now) {
    state.risk.level = (state.risk.level || 0) + 1;
    state.risk.paused = true;
    state.risk.until = now + backoffMs(state.risk.level);
    state.risk.lastSignal = signal || "risk";
    return state;
  }

  function clearRiskIfElapsed(state, now) {
    if (state.risk.paused && now >= state.risk.until) state.risk.paused = false;
    return state;
  }

  // snapshot — everything the GUI needs to render bars + status, in one object.
  function snapshot(state, caps, now) {
    const actions = {};
    for (const a of ACTIONS) actions[a] = actionStats(state, a, caps, now);
    return { session: state.session, risk: state.risk, actions };
  }

  NS.governor = {
    ACTIONS,
    createGovState,
    canAct,
    recordAction,
    applyRisk,
    clearRiskIfElapsed,
    actionStats,
    snapshot,
    backoffMs,
  };
})();
