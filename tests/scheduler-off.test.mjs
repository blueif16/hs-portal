// Guards the scheduler kill switch: with auto-run OFF, an armed plan must never get an alarm
// and a (stale) plan alarm firing must never start a run / spawn a window.
// Loads the real background.js into a vm with an in-memory fake `chrome`.
// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "../extension/src");
const PLAN_ID = "plan_discovery_test_1";

function makeChrome(store) {
  const alarms = new Map();
  const windowsCreated = [];
  const listener = () => ({ addListener() {}, removeListener() {}, hasListener: () => false });
  // Any API we don't model explicitly is an async no-op (keeps background.js's top level loading).
  const stub = () =>
    new Proxy(async () => undefined, {
      get: (t, k) => (k === "then" ? undefined : k.startsWith && k.startsWith("on") ? listener() : stub()),
    });
  const pick = (keys) => {
    if (keys == null) return { ...store };
    if (typeof keys === "string") keys = [keys];
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]));
    return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in store ? store[k] : d]));
  };
  const chrome = {
    storage: {
      local: {
        get: async (k) => structuredClone(pick(k)),
        set: async (o) => void Object.assign(store, structuredClone(o)),
        remove: async (k) => void [].concat(k).forEach((x) => delete store[x]),
      },
      onChanged: listener(),
    },
    alarms: {
      create: async (name, info) => void alarms.set(name, { name, scheduledTime: info.when }),
      clear: async (name) => alarms.delete(name),
      get: async (name) => alarms.get(name),
      getAll: async () => [...alarms.values()],
      onAlarm: listener(),
    },
    windows: {
      create: async (opts) => (windowsCreated.push(opts), { id: 1, tabs: [{ id: 2 }] }),
      onRemoved: listener(),
    },
  };
  return { chrome: new Proxy(chrome, { get: (t, k) => (k in t ? t[k] : stub()) }), alarms, windowsCreated };
}

function loadBackground() {
  const store = {
    hs_plans: [
      {
        id: PLAN_ID,
        name: "test",
        mode: "discovery",
        dryRun: true,
        lastRunAt: 0,
        seeds: [],
        actionMix: { like: { enabled: true, count: 1 } },
        pacing: { notesPerSession: 1 },
        schedule: { enabled: true, timeOfDay: "09:30", weekdays: [] },
      },
    ],
    hs_active_plan_id: PLAN_ID,
  };
  const fake = makeChrome(store);
  const ctx = vm.createContext({
    chrome: fake.chrome,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, Blob, TextEncoder, TextDecoder, crypto, structuredClone, btoa, atob,
    fetch: async () => { throw new Error("no network in tests"); },
  });
  ctx.self = ctx;
  ctx.importScripts = (...files) => {
    for (const f of files) {
      const p = path.join(SRC, f);
      if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: p });
    }
  };
  vm.runInContext(fs.readFileSync(path.join(SRC, "background.js"), "utf8"), ctx, { filename: "background.js" });
  return { ctx, store, ...fake };
}

const planAlarms = (alarms) => [...alarms.keys()].filter((n) => n.startsWith("hs_plan_"));

test("an armed plan gets no alarm when auto-run is off", async () => {
  const { ctx, alarms } = loadBackground();
  await ctx.syncSchedules();
  assert.deepEqual(planAlarms(alarms), []);
});

test("a stale plan alarm firing starts no run and opens no window", async () => {
  const { ctx, store, alarms, windowsCreated } = loadBackground();
  await ctx.onPlanAlarm({ name: "hs_plan_" + PLAN_ID });
  await new Promise((r) => setTimeout(r, 50)); // let any fire-and-forget run kick off
  assert.equal(store.hs_plans.find((p) => p.id === PLAN_ID).lastRunAt, 0, "plan was stamped as run");
  assert.equal(windowsCreated.length, 0, "an automation window was spawned");
  assert.deepEqual(planAlarms(alarms), [], "the alarm was re-armed");
});
