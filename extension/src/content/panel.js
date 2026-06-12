// panel.js — the in-page dashboard. A Shadow-DOM overlay injected on XHS pages so the UI
// is CONTAINER-LESS (floating bento tiles over the page) — something a toolbar popup can't
// be (Chrome forces the popup's white box). Runs as a content script; talks to the
// background over the SAME hs:* message contract the popup used, so the orchestrator,
// governor and plan store are unchanged.
//
// Layout: a bento of independent tiles. DEFAULT (home) shows only what matters at a glance —
//   ① live status (connection + running session)   ② current plan + Run controls.
// Everything heavy (plan editor, log, manual ops, settings) is one tap away behind nav
// buttons and never shown by default. The toolbar popup is now just a launcher that sends
// `hs:panel:toggle` here.
//
// Style isolation: Shadow DOM + a constructable stylesheet (no <style>/<link>, so the page's
// CSP can't block it; the page's CSS can't leak in). DOM is built in JS (no web-accessible
// HTML needed). Engine.js ignores anything but `hs:action`, so our `hs:panel:*` is ours alone.

(function () {
  if (window.__hsPanelLoaded) return; // content scripts can re-run; build once
  window.__hsPanelLoaded = true;

  // ---- styles (shadow-scoped; mirrors the popup theme, re-flowed as a bento) ----
  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .panel, .fab {
    --fg:#1a1a1a; --muted:#777; --line:#e6e6e6; --red:#ff2442; --ok:#1a9d52;
    --warn:#c47d00; --card:#fff; --radius:14px;
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: var(--fg);
  }
  /* the panel itself has NO background/border — tiles float over the page (bento) */
  .panel {
    position: fixed; top: 14px; right: 14px; width: 372px;
    max-height: calc(100vh - 28px); pointer-events: auto;
    display: flex; flex-direction: column; gap: 10px;
  }
  .panel[hidden] { display: none; }
  .scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 2px; }
  .scroll::-webkit-scrollbar { width: 8px; }
  .scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,.18); border-radius: 4px; }

  /* every tile is its own card */
  .tile {
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 13px 14px; box-shadow: 0 4px 16px rgba(0,0,0,.13);
  }
  .tile.flat { padding: 0; overflow: hidden; }

  /* title bar tile (now also carries the live status text, right-aligned) */
  .bar { display: flex; align-items: center; gap: 8px; }
  .bar h1 { font-size: 14px; margin: 0; font-weight: 800; flex: none; letter-spacing: -.01em; }
  .bar .tag { font-size: 9px; font-weight: 700; color:#fff; background: var(--red); padding: 1px 6px; border-radius: 10px; }
  .bar .ico {
    border: none; background: transparent; color: var(--muted); cursor: pointer;
    width: 26px; height: 26px; border-radius: 8px; font-size: 16px; line-height: 1; padding: 0;
  }
  .bar .ico:hover { background: #f0f0f1; color: var(--fg); }
  #statusLine { flex: 1; min-width: 0; text-align: right; font-size: 11px; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #statusLine.ok { color: var(--ok); } #statusLine.err { color: var(--red); } #statusLine.warn { color: var(--warn); }

  /* ---- HOME tiles ---- */
  .tl-head { display:flex; align-items:center; gap:7px; margin-bottom:9px; }
  .tl-head .k { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; font-weight:700; flex:1; }
  .risk { margin-top:10px; padding:7px 10px; border-radius:9px; background:#fff3f4; color:var(--red);
    font-size:12px; border:1px solid #ffd6da; }
  .risk[hidden]{ display:none; }

  /* ① EXECUTOR · header (icon-picker + plan name + connection tag) */
  .exec-head { display:flex; align-items:center; gap:9px; margin-bottom:11px; }
  .picker-ico {
    flex:none; width:30px; height:30px; border-radius:9px; border:1px solid var(--line);
    background:#f7f7f8; color:var(--fg); font-size:14px; line-height:1; padding:0; cursor:pointer;
    display:flex; align-items:center; justify-content:center;
  }
  .picker-ico:hover { border-color:var(--red); color:var(--red); }
  .exec-title { flex:1; min-width:0; font-size:14px; font-weight:800; letter-spacing:-.01em;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .conn-tag { flex:none; font-size:10px; font-weight:700; padding:3px 9px; border-radius:20px;
    background:#f0f0f1; color:var(--muted); white-space:nowrap; }
  .conn-tag.ok { background:rgba(26,157,82,.12); color:var(--ok); }
  .conn-tag.err { background:rgba(255,36,66,.10); color:var(--red); }

  /* custom plan-picker popover (revealed by the icon) */
  .picker-pop { margin:-4px 0 11px; border:1px solid var(--line); border-radius:11px; background:#fff;
    box-shadow:0 8px 22px rgba(0,0,0,.14); overflow:hidden; max-height:248px; overflow-y:auto; }
  .picker-pop[hidden] { display:none; }
  .pp-item { display:flex; align-items:center; gap:8px; padding:9px 12px; cursor:pointer; font-size:12px; }
  .pp-item:hover { background:#f7f7f8; }
  .pp-item.on { background:#fff3f4; }
  .pp-item .pp-name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pp-item .pp-mode { margin-left:auto; flex:none; font-size:9px; font-weight:700; text-transform:uppercase;
    letter-spacing:.04em; color:var(--muted); }
  .pp-empty { padding:11px 12px; font-size:12px; color:var(--muted); }
  .pp-foot { border-top:1px solid var(--line); padding:9px 12px; font-size:11px; font-weight:700;
    color:var(--red); cursor:pointer; }
  .pp-foot:hover { background:#fff3f4; }

  /* account traction tile */
  #acctTile .tl-head { margin-bottom:8px; }
  #acctTile .ico { width:24px; height:24px; font-size:14px; }
  .acct { display:grid; gap:8px; }
  .acct-empty { font-size:12px; color:var(--muted); }
  .acct-name { font-size:12px; font-weight:700; }
  .acct-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .acct-stat { background:#f7f7f8; border:1px solid var(--line); border-radius:10px; padding:9px 11px; }
  .acct-stat .l { font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .acct-stat .n { font-size:19px; font-weight:800; font-variant-numeric:tabular-nums; letter-spacing:-.02em; line-height:1.15; }
  .acct-stat .d { font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; }
  .acct-stat .d.up { color:var(--ok); } .acct-stat .d.down { color:var(--red); } .acct-stat .d.flat { color:var(--muted); }
  .acct-meta { font-size:10px; color:var(--muted); }

  /* ② self-feeding pipeline — the autopilot heartbeat (discover → harvest → visit) */
  #pipeTile .tl-head { margin-bottom:9px; }
  .phase { flex:none; font-size:10px; font-weight:700; padding:2px 8px; border-radius:20px;
    background:#f0f0f1; color:var(--muted); white-space:nowrap; }
  .phase.early { background:#fff3f4; color:var(--red); } .phase.mid { background:#fff8ec; color:#8a6400; }
  .phase.active { background:rgba(26,157,82,.12); color:var(--ok); }
  .pipe-flow { display:grid; grid-template-columns:1fr auto 1fr auto 1fr; align-items:center; gap:4px; }
  .pf { text-align:center; }
  .pf-n { font-size:20px; font-weight:800; font-variant-numeric:tabular-nums; letter-spacing:-.02em; line-height:1.1; }
  .pf-l { font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; margin-top:2px; }
  .pf.hot .pf-n { color:var(--red); }
  .pf-arrow { color:var(--line); font-size:14px; }
  .pipe-sub { font-size:11px; color:var(--muted); margin-top:9px; }
  .pipe-next { display:flex; align-items:center; gap:6px; margin-top:9px; padding-top:9px;
    border-top:1px solid #f5f5f5; font-size:11px; }
  .pipe-next .slot { font-weight:700; color:var(--fg); }
  .pipe-next .when { color:var(--muted); margin-left:auto; font-variant-numeric:tabular-nums; }
  .pipe-empty { font-size:12px; color:var(--muted); }

  /* ② action budget — stacked bars: spent-today + this-run, against the cap */
  #budgetTile[hidden]{ display:none; }
  .seg { display:inline-flex; background:#f0f0f1; border-radius:8px; padding:2px; gap:2px; }
  .seg button { border:none; background:transparent; color:var(--muted); font-size:10px; font-weight:700;
    padding:3px 11px; border-radius:6px; cursor:pointer; line-height:1.4; }
  .seg button:hover { color:var(--fg); }
  .seg button.on { background:#fff; color:var(--fg); box-shadow:0 1px 3px rgba(0,0,0,.12); }
  .gov { display:grid; gap:2px; }
  .gov-row { display:grid; grid-template-columns:20px 1fr auto; align-items:center; column-gap:11px; padding:6px 0; }
  .gov-row + .gov-row { border-top:1px solid #f5f5f5; }
  .g-ico { display:flex; align-items:center; justify-content:center; color:var(--muted); }
  .g-bar { display:flex; height:8px; border-radius:5px; background:var(--line); overflow:hidden; }
  .g-bar i { display:block; height:100%; transition:width .3s ease; }
  .seg-spent { background:#f3a3ad; }            /* already spent (this hour / today) */
  .seg-run { background:var(--red); }            /* what THIS run will still add */
  .g-num { font-size:11px; color:#555; font-variant-numeric:tabular-nums; min-width:52px; text-align:right; }
  .g-num b { color:var(--red); font-weight:800; }
  .g-num .cap { color:var(--muted); }
  .gov-row.capped .g-num { color:var(--red); font-weight:700; }

  /* keyword chips (discovery seeds = the real search keywords) */
  .kw-wrap { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:11px; }
  .kw { font-size:11px; font-weight:600; padding:3px 9px; border-radius:20px;
    background:#f2f3f5; color:#333; border:1px solid #eaebed; }
  .kw.muted { background:transparent; color:var(--muted); border-color:transparent; padding-left:0; }

  /* est-time ⇄ live progress bar */
  .exec-time { margin-bottom:11px; }
  .et-idle { display:flex; align-items:center; gap:7px; font-size:12px; color:#444; font-variant-numeric:tabular-nums; }
  .et-ico { font-size:13px; }
  .et-idle[hidden], .et-run[hidden] { display:none; }
  .prog { height:8px; border-radius:5px; background:var(--line); overflow:hidden; }
  .prog i { display:block; height:100%; width:0%; border-radius:5px;
    background:linear-gradient(90deg,#ff5870,var(--red)); transition:width .4s ease; }
  .prog-lbl { font-size:10px; color:var(--muted); margin-top:5px; font-variant-numeric:tabular-nums; }

  /* will-do action chips (tasteful icon + quantity, no prose) */
  .willdo { display:flex; flex-wrap:wrap; gap:7px; }
  .wd { display:flex; align-items:center; gap:5px; padding:4px 10px 4px 9px; border-radius:20px;
    background:#f7f7f8; border:1px solid var(--line); }
  .wd-i { display:inline-flex; align-items:center; color:#555; }
  .wd-n { font-size:12px; font-weight:800; font-variant-numeric:tabular-nums; }
  .wd-none { font-size:12px; color:var(--muted); }

  .dry { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); margin:11px 0 9px; cursor:pointer; user-select:none; }
  .dry input { margin:0; accent-color:var(--red); }
  .run-row { display:grid; grid-template-columns:2fr 1fr; gap:9px; }

  /* nav buttons (disclosure to the heavy stuff) */
  .nav { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .nav button { display:flex; align-items:center; gap:8px; text-align:left; }
  .nav .ic, #openPortal .ic { color:#6b6b6f; }
  #openPortal { display:flex; align-items:center; justify-content:center; gap:8px; }

  /* ---- buttons ---- */
  button {
    appearance:none; border:1px solid var(--line); background:#fff; color:var(--fg);
    padding:9px 12px; border-radius:9px; font:inherit; font-size:13px; cursor:pointer;
  }
  button:hover { border-color:var(--red); }
  button:active { transform:translateY(1px); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  button.primary { background:var(--red); color:#fff; border-color:var(--red); font-weight:700; }
  button.primary:disabled { background:#f3a3ad; border-color:#f3a3ad; }
  button.danger { color:var(--red); border-color:var(--red); font-weight:700; }
  button.ghost { border-color:transparent; color:var(--muted); }
  button.ghost:hover { border-color:var(--line); color:var(--fg); }
  button.tiny { font-size:11px; padding:6px 10px; }
  button.wide { width:100%; }

  /* ---- form fields (shared, used in sub-views) ---- */
  .fld { display:block; margin-bottom:11px; }
  .fld-k { display:block; font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
  select, input.num, input.txt, textarea, .ai-gen input {
    width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:9px;
    font:inherit; font-size:13px; background:#fff; color:var(--fg);
  }
  select:focus, input:focus, textarea:focus { outline:none; border-color:var(--red); }
  textarea { resize:vertical; }
  input.num { font-variant-numeric:tabular-nums; }
  .op-row { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .mode-fld select { font-weight:700; }
  .grp-k { font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin:8px 0 6px; font-weight:700; }
  .mix { display:grid; gap:8px; margin-bottom:10px; }
  .mix-row { display:grid; grid-template-columns:1fr 76px; gap:8px; align-items:center; }
  .ck { font-size:13px; cursor:pointer; user-select:none; display:flex; align-items:center; gap:7px; }
  .ck input { margin:0; width:auto; accent-color:var(--red); }
  .ck.sub { font-size:12px; color:var(--muted); }
  .picker-row { display:grid; grid-template-columns:1fr auto; gap:8px; margin-bottom:10px; }
  .picker-row select { font-weight:700; }
  .ai-gen { display:grid; grid-template-columns:1fr auto; gap:8px; margin-bottom:12px; }
  .ai-gen button { white-space:nowrap; font-weight:700; }
  .sub-panel { border-top:1px solid #f1f1f1; margin:10px 0; }
  .sub-panel > summary { font-size:10px; color:var(--muted); cursor:pointer; padding:9px 0 6px;
    text-transform:uppercase; letter-spacing:.04em; list-style:none; }
  .sub-panel > summary::-webkit-details-marker { display:none; }
  .sub-panel > summary::before { content:"▸ "; }
  .sub-panel[open] > summary::before { content:"▾ "; }

  /* schedule (错峰) — surfaced ONLY as a tag; the AI owns the times, never the operator */
  .kw.sched { background:#fff8ec; color:#8a6400; border-color:#f0e2c0; }
  .pp-sched { flex:none; font-size:10px; margin-left:6px; }
  .camp { display:flex; align-items:center; gap:9px; margin:-4px 0 12px; padding:9px 11px;
    border:1px solid #ffd6da; background:#fff8f8; border-radius:11px; }
  .camp[hidden] { display:none; }
  .camp-txt { flex:1; min-width:0; font-size:12px; }
  .camp-txt b { font-weight:800; }

  /* sub-view scaffold */
  .view[hidden] { display:none; }
  .view-head { display:flex; align-items:center; gap:9px; margin-bottom:11px; }
  .view-head .back { width:28px; height:28px; padding:0; font-size:15px; border-radius:8px; }
  .view-head h2 { font-size:14px; margin:0; font-weight:800; flex:1; }
  .hint { font-size:11px; color:var(--muted); margin:0 0 11px; }

  /* manual state strip */
  .state { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; background:#f7f7f8;
    border:1px solid var(--line); border-radius:9px; padding:10px; margin-bottom:11px; }
  .state .k { display:block; font-size:9px; color:var(--muted); text-transform:uppercase; }
  .state .v { font-weight:700; }
  .actions { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:9px; }
  .comment { display:flex; gap:8px; } .comment input { flex:1; min-width:0; }

  /* targets (harvested leads) */
  .tg-bar { display:flex; align-items:center; gap:7px; margin-bottom:11px; }
  .tg-bar select { flex:1; min-width:0; }
  .tg-bar button { flex:none; white-space:nowrap; }
  .tg-list { display:flex; flex-direction:column; gap:8px; max-height:420px; overflow-y:auto; padding-right:2px; }
  .tg-list::-webkit-scrollbar { width:8px; }
  .tg-list::-webkit-scrollbar-thumb { background:rgba(0,0,0,.18); border-radius:4px; }
  .tg-empty { font-size:12px; color:var(--muted); padding:6px 2px; }
  .tg-item { border:1px solid var(--line); border-radius:11px; padding:9px 11px; background:#fff; }
  .tg-top { display:flex; align-items:baseline; gap:8px; }
  .tg-name { font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tg-name a { color:var(--fg); text-decoration:none; } .tg-name a:hover { color:var(--red); text-decoration:underline; }
  .tg-uid { font-size:10px; color:var(--muted); font-variant-numeric:tabular-nums; margin-left:auto; flex:none; }
  .tg-content { font-size:12px; color:#444; margin:5px 0 7px; word-break:break-word; }
  .tg-chips { display:flex; flex-wrap:wrap; gap:5px; }
  .tg-chip { font-size:10px; font-weight:600; padding:2px 8px; border-radius:20px; background:#f2f3f5; color:#333; border:1px solid #eaebed; font-variant-numeric:tabular-nums; }
  .tg-chip.grp { background:#fff3f4; color:var(--red); border-color:#ffd6da; }

  /* log */
  .log { margin:0; padding:10px; max-height:340px; overflow:auto; background:#1c1c1e; border:1px solid #2c2c2e;
    border-radius:9px; font:11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color:#d8d8d8;
    white-space:pre-wrap; word-break:break-word; }
  .row-btns { display:flex; gap:8px; margin-top:10px; }

  /* collapsed FAB */
  .fab {
    position: fixed; top: 14px; right: 14px; pointer-events:auto;
    width: 44px; height: 44px; border-radius: 50%; border:none; cursor:pointer;
    background: var(--red); color:#fff; font-weight:800; font-size:13px;
    box-shadow: 0 4px 16px rgba(0,0,0,.28); display:flex; align-items:center; justify-content:center;
  }
  .fab[hidden] { display:none; }
  .fab .fdot { position:absolute; top:7px; right:7px; width:9px; height:9px; border-radius:50%;
    background:transparent; border:2px solid var(--red); }
  .fab.live .fdot { background:#8dffb0; }

  /* inline line-icons (Lucide-style, monochrome, currentColor) — one tasteful set everywhere */
  .ic { width:15px; height:15px; flex:none; display:inline-block; vertical-align:-2px; }
  .ic-heart { color:var(--red); }            /* the one accent — heart stays red */
  `;

  // ---- icon set: one source of truth for both the static template and JS-built chips.
  // Stroke icons take their container's color (currentColor); the heart is filled red.
  const _svg = (inner) => `<svg viewBox="0 0 24 24" class="ic" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const ICON = {
    like: `<svg viewBox="0 0 24 24" class="ic ic-heart" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`,
    collect: _svg(`<path d="M18 21l-6-4.2L6 21V5.5A1.5 1.5 0 0 1 7.5 4h9A1.5 1.5 0 0 1 18 5.5z"/>`),
    follow: _svg(`<path d="M15 21v-1.8a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 4 19.2V21"/><circle cx="9.5" cy="8" r="3.5"/><path d="M19 8v6M22 11h-6"/>`),
    comment: _svg(`<path d="M20.5 11.3a7.7 7.7 0 0 1-10.8 7L4 20l1.7-5.5a7.7 7.7 0 1 1 14.8-3.2z"/>`),
    gather: _svg(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>`),
    plans: _svg(`<rect x="8" y="3" width="8" height="4" rx="1.2"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M9 12.5h6M9 16h4"/>`),
    log: _svg(`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h5"/>`),
    manual: _svg(`<path d="M5 21v-6M5 11V3M12 21v-4M12 13V3M19 21v-9M19 8V3"/><circle cx="5" cy="13" r="2"/><circle cx="12" cy="11" r="2"/><circle cx="19" cy="6" r="2"/>`),
    settings: _svg(`<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>`),
    globe: _svg(`<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.5 4 5.7 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.7-4-9s1.4-6.5 4-9z"/>`),
  };

  // ---- shadow host (full-viewport, click-through; children opt back in) ----
  const host = document.createElement("div");
  host.id = "hs-panel-host";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } catch (e) {
    const st = document.createElement("style"); // fallback for old engines
    st.textContent = CSS;
    root.appendChild(st);
  }

  root.innerHTML = `
    <button class="fab" id="fab" hidden title="Open HS Portal">HS<span class="fdot"></span></button>
    <div class="panel" id="panel" hidden>
      <div class="tile bar">
        <h1>HS Portal <span class="tag">M1</span></h1>
        <span id="statusLine" class="ok">Connecting…</span>
        <button class="ico" id="collapseBtn" title="Collapse">—</button>
      </div>
      <div class="scroll" id="scroll">

        <!-- ===== HOME (default) ===== -->
        <div class="home" id="homeView">
          <!-- ① EXECUTOR · run session (icon-picker + plan name + connection tag) -->
          <div class="tile" id="execTile">
            <div class="exec-head">
              <button class="picker-ico" id="pickerBtn" title="Choose a plan">☰</button>
              <div class="exec-title" id="roTitle">no plan</div>
              <span class="conn-tag" id="connTag" title="content engine connection">…</span>
            </div>
            <div class="picker-pop" id="pickerPop" hidden></div>
            <div class="kw-wrap" id="roSeeds"></div>
            <div class="exec-time" id="timeRow">
              <div class="et-idle" id="etIdle"><span class="et-ico">⏱</span><span id="roTime">–</span></div>
              <div class="et-run" id="etRun" hidden>
                <div class="prog"><i id="progFill"></i></div>
                <div class="prog-lbl" id="progLbl">starting…</div>
              </div>
            </div>
            <div class="willdo" id="roActions"></div>
            <div class="risk" id="risk" hidden></div>
            <label class="dry"><input type="checkbox" id="dryRun" checked /> dry-run · browse + log only</label>
            <div class="run-row">
              <button id="runBtn" class="primary">▶ Run session</button>
              <button id="stopBtn" class="danger" disabled>■ Stop</button>
            </div>
          </div>

          <!-- ② self-feeding pipeline — the autopilot heartbeat (only shown once armed) -->
          <div class="tile" id="pipeTile" hidden>
            <div class="tl-head"><span class="k" style="flex:1">养号 pipeline · auto</span><span id="pipePhase" class="phase" hidden></span></div>
            <div id="pipeBody"></div>
          </div>

          <!-- ③ action budget — spent today/this-hour + this run, against the cap -->
          <div class="tile" id="budgetTile">
            <div class="tl-head"><span class="k">Action budget</span>
              <div class="seg" id="capSwitch">
                <button data-cap="hour">hr</button>
                <button data-cap="day" class="on">day</button>
              </div>
            </div>
            <div class="gov" id="gov">
              <div class="gov-row" data-a="like"><span class="g-ico">${ICON.like}</span><div class="g-bar"><i class="seg-spent" data-spent></i><i class="seg-run" data-run></i></div><span class="g-num" data-num>–</span></div>
              <div class="gov-row" data-a="collect"><span class="g-ico">${ICON.collect}</span><div class="g-bar"><i class="seg-spent" data-spent></i><i class="seg-run" data-run></i></div><span class="g-num" data-num>–</span></div>
              <div class="gov-row" data-a="follow"><span class="g-ico">${ICON.follow}</span><div class="g-bar"><i class="seg-spent" data-spent></i><i class="seg-run" data-run></i></div><span class="g-num" data-num>–</span></div>
              <div class="gov-row" data-a="comment"><span class="g-ico">${ICON.comment}</span><div class="g-bar"><i class="seg-spent" data-spent></i><i class="seg-run" data-run></i></div><span class="g-num" data-num>–</span></div>
            </div>
          </div>

          <!-- ③ account traction (proof the extension is working) -->
          <div class="tile" id="acctTile">
            <div class="tl-head"><span class="k" style="flex:1">Account · traction</span><button class="ico" id="acctRefresh" title="Read account now">↻</button></div>
            <div id="acctBody" class="acct"><span class="acct-empty">No reading yet — a run captures this automatically, or tap ↻.</span></div>
          </div>

          <!-- nav to the heavy stuff -->
          <div class="tile">
            <div class="nav">
              <button data-go="plans">${ICON.plans}<span>Plans &amp; editor</span></button>
              <button data-go="targets">${ICON.gather}<span>Targets · 采集</span></button>
              <button data-go="log">${ICON.log}<span>Activity log</span></button>
              <button data-go="manual">${ICON.manual}<span>Manual ops</span></button>
              <button data-go="settings">${ICON.settings}<span>Settings</span></button>
            </div>
            <button id="openPortal" class="wide" style="margin-top:9px">${ICON.globe}<span>Content Studio · publishing</span></button>
          </div>
        </div>

        <!-- ===== PLANS ===== -->
        <div class="view" id="plansView" hidden>
          <div class="tile" id="planPanel">
            <div class="view-head"><button class="ghost back" data-back>‹</button><h2>Plans &amp; editor</h2></div>
            <div class="picker-row">
              <select id="planPicker" title="Recall a saved plan"><option value="">➕ New plan</option></select>
              <button id="deletePlanBtn" class="ghost" title="Delete this plan" disabled>🗑</button>
            </div>
            <div class="ai-gen">
              <input id="aiSubject" type="text" placeholder="Describe your account in a sentence…" />
              <button id="aiGenBtn" type="button">✨ Generate</button>
            </div>
            <div class="camp" id="campBar" hidden>
              <div class="camp-txt" id="campTxt"></div>
              <button id="campAccept" class="primary tiny">✓ Accept campaign</button>
            </div>
            <label class="fld mode-fld"><span class="fld-k">Mode · 养号 strategy</span>
              <select id="planMode">
                <option value="discovery">discovery — 发现页 (keyword feed)</option>
                <option value="comment_section">comment_section — 评论区</option>
                <option value="profile">profile — 主页 (target profiles)</option>
              </select>
            </label>
            <label class="fld"><span class="fld-k" id="seedsLabel">Keywords (one per line)</span>
              <textarea id="planSeeds" rows="3" placeholder="one per line"></textarea>
            </label>
            <div class="grp-k">Action mix</div>
            <div class="mix">
              <div class="mix-row"><label class="ck"><input type="checkbox" id="actLike" /> Like</label><input type="number" id="actLikeCount" class="num" min="0" /></div>
              <div class="mix-row"><label class="ck"><input type="checkbox" id="actCollect" /> Collect</label><input type="number" id="actCollectCount" class="num" min="0" /></div>
              <div class="mix-row"><label class="ck"><input type="checkbox" id="actFollow" /> Follow</label><input type="number" id="actFollowCount" class="num" min="0" /></div>
              <div class="mix-row"><label class="ck"><input type="checkbox" id="actComment" /> Comment</label><input type="number" id="actCommentCount" class="num" min="0" /></div>
              <label class="ck sub"><input type="checkbox" id="actCommentSubmit" /> submit comment (actually send)</label>
              <textarea id="actCommentText" rows="2" placeholder="canned comments (one per line)"></textarea>
              <label class="ck"><input type="checkbox" id="actGather" /> Gather targets</label>
              <input type="text" id="actGatherGroup" class="txt" placeholder="lead group name (optional)" />
            </div>
            <details class="sub-panel" id="filterPanel">
              <summary>Target filter</summary>
              <label class="fld"><span class="fld-k">Gender</span>
                <select id="fGender"><option value="unlimited">unlimited</option><option value="male">male</option><option value="female">female</option></select>
              </label>
              <div class="fld"><span class="fld-k">Followers</span><div class="op-row">
                <select id="fFollowersOp"><option value="any">any</option><option value="gte">gte</option><option value="lte">lte</option></select>
                <input type="number" id="fFollowersVal" class="num" min="0" /></div></div>
              <div class="fld"><span class="fld-k">Comment likes</span><div class="op-row">
                <select id="fLikesOp"><option value="any">any</option><option value="gte">gte</option><option value="lte">lte</option></select>
                <input type="number" id="fLikesVal" class="num" min="0" /></div></div>
              <div class="fld"><span class="fld-k">Following</span><div class="op-row">
                <select id="fFollowingOp"><option value="any">any</option><option value="gte">gte</option><option value="lte">lte</option></select>
                <input type="number" id="fFollowingVal" class="num" min="0" /></div></div>
              <div class="fld"><span class="fld-k">获赞收藏 (likes+collects)</span><div class="op-row">
                <select id="fLikesTotalOp"><option value="any">any</option><option value="gte">gte</option><option value="lte">lte</option></select>
                <input type="number" id="fLikesTotalVal" class="num" min="0" /></div></div>
              <div class="fld"><span class="fld-k">Content length</span><div class="op-row">
                <select id="fContentLenOp"><option value="any">any</option><option value="gte">gte</option><option value="lte">lte</option></select>
                <input type="number" id="fContentLenVal" class="num" min="0" /></div></div>
              <label class="fld"><span class="fld-k">IP regions</span><input type="text" id="fIpRegions" class="txt" placeholder="comma-separated, e.g. 北京, 上海" /></label>
              <div class="fld"><span class="fld-k">Keywords include</span><div class="op-row">
                <select id="fIncludeOp"><option value="any">any</option><option value="contains">contains</option><option value="equals">equals</option></select>
                <input type="text" id="fIncludeVal" class="txt" placeholder="comma-separated" /></div></div>
              <label class="fld"><span class="fld-k">Keywords exclude</span><input type="text" id="fExcludeVal" class="txt" placeholder="comma-separated" /></label>
            </details>
            <details class="sub-panel" id="pacingPanel">
              <summary>Pacing</summary>
              <label class="fld"><span class="fld-k">Notes per session</span><input type="number" id="pNotes" class="num" min="0" /></label>
              <div class="fld"><span class="fld-k">Between actions (ms)</span><div class="op-row">
                <input type="number" id="pBetweenMin" class="num" min="0" placeholder="min" />
                <input type="number" id="pBetweenMax" class="num" min="0" placeholder="max" /></div></div>
              <div class="fld"><span class="fld-k">Dwell (ms)</span><div class="op-row">
                <input type="number" id="pDwellMin" class="num" min="0" placeholder="min" />
                <input type="number" id="pDwellMax" class="num" min="0" placeholder="max" /></div></div>
            </details>
            <label class="fld"><span class="fld-k">Plan name</span><input id="planName" type="text" class="txt" placeholder="name this plan…" /></label>
            <button id="savePlanBtn" class="primary wide">💾 Save plan</button>
          </div>
        </div>

        <!-- ===== TARGETS ===== -->
        <div class="view" id="targetsView" hidden>
          <div class="tile">
            <div class="view-head"><button class="ghost back" data-back>‹</button><h2>Targets · 采集</h2></div>
            <p class="hint">harvested leads — enable Gather on a comment_section/profile plan and run it</p>
            <div class="tg-bar">
              <select id="targetsGroup" title="Filter by lead group"><option value="">all groups</option></select>
              <button id="targetsRefresh" class="ghost tiny" title="Reload targets">↻</button>
              <button id="targetsExport" class="ghost tiny">⬇ Export CSV</button>
              <button id="targetsClear" class="danger tiny">🗑 Clear</button>
            </div>
            <div id="targetsList" class="tg-list"></div>
          </div>
        </div>

        <!-- ===== LOG ===== -->
        <div class="view" id="logView" hidden>
          <div class="tile">
            <div class="view-head"><button class="ghost back" data-back>‹</button><h2>Activity log</h2></div>
            <p class="hint">also auto-saved to Downloads/hs-portal/</p>
            <pre id="log" class="log" aria-live="polite"></pre>
            <div class="row-btns">
              <button id="resetGov" class="ghost tiny">↺ reset counters</button>
              <button id="exportLogBtn" class="ghost tiny">⬇ export log</button>
            </div>
          </div>
        </div>

        <!-- ===== MANUAL ===== -->
        <div class="view" id="manualView" hidden>
          <div class="tile">
            <div class="view-head"><button class="ghost back" data-back>‹</button><h2>Manual ops</h2></div>
            <p class="hint">fire one op on the open note (quick selector tests)</p>
            <section class="state" id="state">
              <div><span class="k">Note</span><span class="v" id="noteId">—</span></div>
              <div><span class="k">Liked</span><span class="v" id="liked">—</span></div>
              <div><span class="k">Collected</span><span class="v" id="collected">—</span></div>
            </section>
            <section class="actions">
              <button data-action="like">👍 Like</button>
              <button data-action="collect">⭐ Collect</button>
              <button data-action="follow">➕ Follow</button>
              <button data-action="scroll" data-args='{"steps":5}'>🖱 Scroll</button>
              <button data-action="dwell">⏱ Dwell</button>
              <button id="refresh" class="ghost">↻ State</button>
            </section>
            <section class="comment">
              <input id="commentText" type="text" placeholder="Comment text (types only, won't send)" />
              <button data-action="comment">💬 Type</button>
            </section>
          </div>
        </div>

        <!-- ===== SETTINGS ===== -->
        <div class="view" id="settingsView" hidden>
          <div class="tile">
            <div class="view-head"><button class="ghost back" data-back>‹</button><h2>Settings</h2></div>
            <p class="hint">AI endpoint · a bundled key (secrets.local.js) overrides these</p>
            <label class="fld"><span class="fld-k">API key</span><input id="aiKey" type="password" class="txt" placeholder="bundled via secrets.local.js" autocomplete="off" /></label>
            <label class="fld"><span class="fld-k">Endpoint</span><input id="aiEndpoint" type="text" class="txt" placeholder="https://api…/v1/chat/completions" /></label>
            <label class="fld"><span class="fld-k">Model</span><input id="aiModel" type="text" class="txt" placeholder="Qwen/Qwen3.5-397B-A17B" /></label>
            <button id="saveSettingsBtn" class="primary wide">💾 Save settings</button>
          </div>
        </div>
      </div>
    </div>`;

  (document.body || document.documentElement).appendChild(host);

  // ---- helpers (scoped to the shadow root) ----
  const $ = (s) => root.querySelector(s);
  const panel = $("#panel");
  const fab = $("#fab");
  const statusEl = $("#statusLine");

  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, res); } catch (e) { res({ ok: false, error: String(e) }); } });
  const emit = (line, level) => send({ type: "hs:event", line, level: level || "info", t: Date.now() });

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind || "";
  }

  function renderLog(events) {
    const logEl = $("#log");
    if (!logEl) return;
    if (!events || !events.length) { logEl.textContent = ""; return; }
    logEl.textContent = events.slice().reverse().map((e) => {
      const ts = new Date(e.t || Date.now()).toLocaleTimeString();
      const lv = e.level && e.level !== "info" ? ` ${e.level}` : "";
      return `[${ts}]${lv} ${e.line}`;
    }).join("\n");
  }

  const ACTION_VERB = {
    starting: "starting", browsing: "browsing", like: "liking", collect: "collecting",
    follow: "following", comment: "commenting", gather: "gathering",
    idle: "idle", done: "done", stopped: "stopped", risk: "risk backoff",
  };

  // capMode — the budget bars show one limit at a time; the switcher flips them all.
  let capMode = "day";
  let lastStatus = null;

  // renderBudget — each action bar is the CAP (day or hour). Segment 1 = already spent in
  // that window (pink); segment 2, appended right after, = what THIS run will still add (red).
  function renderBudget(status) {
    const actions = (status && status.actions) || {};
    const ss = (status && status.session) || {};
    const budget = ss.budget || {};
    const running = !!ss.running; // the "+this run" segment only makes sense while a run is live
    for (const row of root.querySelectorAll(".gov-row")) {
      const a = row.dataset.a;
      const cap = actions[a] || {};
      const b = budget[a] || { used: 0, max: 0 };
      const runLeft = running ? Math.max(0, (b.max || 0) - (b.used || 0)) : 0; // remaining in the current run
      const spent = capMode === "hour" ? (cap.perHour ?? 0) : (cap.perDay ?? 0);
      const limit = capMode === "hour" ? cap.hourCap : cap.dayCap;
      const denom = limit != null && limit > 0 ? limit : Math.max(1, spent + runLeft);
      const spentPct = Math.min(100, (spent / denom) * 100);
      const runPct = Math.min(100 - spentPct, (runLeft / denom) * 100);
      row.querySelector("[data-spent]").style.width = spentPct + "%";
      row.querySelector("[data-run]").style.width = runPct + "%";
      const capTxt = limit != null ? `<span class="cap"> / ${limit}</span>` : "";
      row.querySelector("[data-num]").innerHTML = runLeft > 0
        ? `${spent}<b>+${runLeft}</b>${capTxt}` : `${spent}${capTxt}`;
      row.classList.toggle("capped", limit != null && spent >= limit);
    }
  }

  function renderGov(status) {
    if (!status) return;
    lastStatus = status;
    const ss = status.session || {};
    const running = !!ss.running;
    const risk = status.risk || {};

    renderBudget(status);

    $("#runBtn").disabled = running;
    $("#stopBtn").disabled = !running;
    fab.classList.toggle("live", running);

    // est-time ⇄ live progress bar (the executor's pulse)
    const etIdle = $("#etIdle"), etRun = $("#etRun");
    if (running) {
      const progress = ss.progress || {};
      const note = progress.note != null ? +progress.note : 0;
      const total = progress.total != null ? +progress.total : 0;
      const pct = total > 0 ? Math.min(100, (note / total) * 100) : 6;
      $("#progFill").style.width = pct + "%";
      const verb = ACTION_VERB[ss.currentAction] || ss.currentAction || "running";
      const tag = ss.dryRun ? "dry-run" : "LIVE";
      $("#progLbl").textContent = `${ss.mode || "session"} · note ${note}/${total || "?"} · ${verb} · ${tag}`;
      etIdle.hidden = true; etRun.hidden = false;
    } else {
      etIdle.hidden = false; etRun.hidden = true;
    }

    const riskEl = $("#risk");
    if (risk.paused) {
      const secs = Math.max(0, Math.ceil((risk.until - Date.now()) / 1000));
      riskEl.hidden = false;
      riskEl.textContent = `⚠ risk backoff ${secs}s — ${risk.lastSignal || "signal"}`;
    } else {
      riskEl.hidden = true;
    }
  }

  let prevRunning = false;
  let pollTick = 0;
  async function poll() {
    const r = await send({ type: "hs:session:status" });
    if (r && r.ok) {
      renderGov(r.status);
      renderLog(r.events);
      // A run captures an account snapshot at its end — refresh traction + pipeline then.
      const running = !!(r.status && r.status.session && r.status.session.running);
      if (prevRunning && !running) { refreshAccount(); refreshPipeline(); }
      prevRunning = running;
    }
    // The pipeline (pool counts, next-run) drifts slowly — refresh it every ~4s, and live
    // every tick while a run is draining/filling the pool so the numbers visibly move.
    if (prevRunning || pollTick % 4 === 0) refreshPipeline();
    pollTick++;
  }

  // ---- plan editor (ported from popup.js, scoped to the shadow root) ----
  let loadedPlan = null;
  const SEED_LABELS = {
    discovery: "Keywords (one per line)",
    comment_section: "Note URLs — or leave blank to auto-harvest discovered notes",
    profile: "Profile URLs — or leave blank to auto-visit accumulated leads",
  };
  const lines = (s) => (s || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const csv = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
  function updateSeedsLabel() { $("#seedsLabel").textContent = SEED_LABELS[$("#planMode").value] || SEED_LABELS.discovery; }

  function populatePlanForm(plan) {
    loadedPlan = plan;
    const tf = plan.targetFilter || {}, am = plan.actionMix || {}, pc = plan.pacing || {};
    $("#planMode").value = plan.mode || "discovery";
    $("#planSeeds").value = (plan.seeds || []).join("\n");
    updateSeedsLabel();
    const like = am.like || {}, collect = am.collect || {}, follow = am.follow || {}, comment = am.comment || {}, gather = am.gather || {};
    $("#actLike").checked = !!like.enabled; $("#actLikeCount").value = like.count ?? 0;
    $("#actCollect").checked = !!collect.enabled; $("#actCollectCount").value = collect.count ?? 0;
    $("#actFollow").checked = !!follow.enabled; $("#actFollowCount").value = follow.count ?? 0;
    $("#actComment").checked = !!comment.enabled; $("#actCommentCount").value = comment.count ?? 0;
    $("#actCommentSubmit").checked = !!comment.submit; $("#actCommentText").value = (comment.comments || []).join("\n");
    $("#actGather").checked = !!gather.enabled; $("#actGatherGroup").value = gather.group || "";
    const followers = tf.followers || { op: "any", value: 0 };
    const likes = tf.commentLikeCount || { op: "any", value: 0 };
    const following = tf.following || { op: "any", value: 0 };
    const likesTotal = tf.likes || { op: "any", value: 0 };
    const contentLen = tf.contentLength || { op: "any", value: 0 };
    const inc = tf.keywordsInclude || { op: "any", values: [] };
    $("#fGender").value = tf.gender || "unlimited";
    $("#fFollowersOp").value = followers.op || "any"; $("#fFollowersVal").value = followers.value ?? 0;
    $("#fLikesOp").value = likes.op || "any"; $("#fLikesVal").value = likes.value ?? 0;
    $("#fFollowingOp").value = following.op || "any"; $("#fFollowingVal").value = following.value ?? 0;
    $("#fLikesTotalOp").value = likesTotal.op || "any"; $("#fLikesTotalVal").value = likesTotal.value ?? 0;
    $("#fContentLenOp").value = contentLen.op || "any"; $("#fContentLenVal").value = contentLen.value ?? 0;
    $("#fIpRegions").value = (tf.ipRegions || []).join(", ");
    $("#fIncludeOp").value = inc.op || "any"; $("#fIncludeVal").value = (inc.values || []).join(", ");
    $("#fExcludeVal").value = (tf.keywordsExclude || []).join(", ");
    $("#pNotes").value = pc.notesPerSession ?? 0;
    const between = pc.betweenActionsMs || [0, 0], dwell = pc.dwellMs || [0, 0];
    $("#pBetweenMin").value = between[0] ?? 0; $("#pBetweenMax").value = between[1] ?? 0;
    $("#pDwellMin").value = dwell[0] ?? 0; $("#pDwellMax").value = dwell[1] ?? 0;
    // schedule has NO editor — the AI decides it; it rides along untouched via loadedPlan.
  }

  const numVal = (sel) => { const n = Number($(sel).value); return Number.isFinite(n) ? n : 0; };

  function buildPlanFromForm() {
    const base = loadedPlan || {};
    const baseComment = (base.actionMix && base.actionMix.comment) || {};
    const mode = $("#planMode").value;
    const seeds = lines($("#planSeeds").value);
    // seedSource follows the seeds field: discovery is always keywords; a URL-mode with pasted
    // seeds is manual, an empty one self-feeds (auto). This is what makes "leave it blank to
    // let it auto-source" work — editing the box switches the plan between manual and auto.
    const seedSource = mode === "discovery" ? "keywords" : seeds.length ? "manual" : "auto";
    return {
      ...base,
      name: $("#planName").value.trim() || base.name || "",
      mode,
      seedSource,
      seeds,
      targetFilter: {
        ...(base.targetFilter || {}),
        gender: $("#fGender").value,
        followers: { op: $("#fFollowersOp").value, value: numVal("#fFollowersVal") },
        commentLikeCount: { op: $("#fLikesOp").value, value: numVal("#fLikesVal") },
        following: { op: $("#fFollowingOp").value, value: numVal("#fFollowingVal") },
        likes: { op: $("#fLikesTotalOp").value, value: numVal("#fLikesTotalVal") },
        contentLength: { op: $("#fContentLenOp").value, value: numVal("#fContentLenVal") },
        ipRegions: csv($("#fIpRegions").value),
        keywordsInclude: { op: $("#fIncludeOp").value, values: csv($("#fIncludeVal").value) },
        keywordsExclude: csv($("#fExcludeVal").value),
      },
      actionMix: {
        ...(base.actionMix || {}),
        like: { enabled: $("#actLike").checked, count: numVal("#actLikeCount") },
        collect: { enabled: $("#actCollect").checked, count: numVal("#actCollectCount") },
        follow: { enabled: $("#actFollow").checked, count: numVal("#actFollowCount") },
        comment: { ...baseComment, enabled: $("#actComment").checked, count: numVal("#actCommentCount"), submit: $("#actCommentSubmit").checked, comments: lines($("#actCommentText").value) },
        gather: { enabled: $("#actGather").checked, group: $("#actGatherGroup").value.trim() },
      },
      pacing: {
        ...(base.pacing || {}),
        notesPerSession: numVal("#pNotes"),
        betweenActionsMs: [numVal("#pBetweenMin"), numVal("#pBetweenMax")],
        dwellMs: [numVal("#pDwellMin"), numVal("#pDwellMax")],
      },
      // schedule: intentionally NOT rebuilt here — `...base` passes it through verbatim
      // (the AI authors it; accepting a campaign arms it; no form field touches it).
    };
  }

  // refreshSchedNext — enrich the home schedule TAG's tooltip with the actual next run
  // (the tag itself stays a meaningful word; the timestamp lives only in the hover title).
  async function refreshSchedNext() {
    const chip = $("#roSchedTag");
    if (!chip) return;
    const r = await send({ type: "hs:schedule:list" });
    if (!r || !r.ok || !Array.isArray(r.scheduled)) return;
    const mine = activePlanId ? r.scheduled.find((s) => s.id === activePlanId) : null;
    if (mine && mine.nextRunAt) chip.title = "auto-runs · next " + new Date(mine.nextRunAt).toLocaleString();
  }

  let plansCache = [];
  const NEW_PLAN = {
    mode: "discovery", seeds: [],
    actionMix: {
      like: { enabled: true, count: 10 }, collect: { enabled: false, count: 0 },
      follow: { enabled: false, count: 0 }, comment: { enabled: false, count: 0, submit: false, comments: [] },
      gather: { enabled: false },
    },
    targetFilter: {},
    pacing: { notesPerSession: 10, betweenActionsMs: [3000, 9000], dwellMs: [8000, 20000] },
  };

  function relTime(ts) {
    if (!ts) return null;
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + "s ago";
    const m = Math.round(s / 60); if (m < 60) return m + "m ago";
    const h = Math.round(m / 60); if (h < 24) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }
  // schedTag — the ONLY schedule surface the operator sees: a meaningful slot tag
  // (AI's label, else a daypart word), never the raw "HH:MM". null = not auto-scheduled.
  function schedTag(p) {
    const sc = p && p.schedule;
    if (!sc || !sc.enabled || !sc.timeOfDay) return null;
    const h = +String(sc.timeOfDay).split(":")[0];
    const slot = !Number.isFinite(h) ? ["⏰", "定时"] : h < 5 ? ["🌃", "深夜"] : h < 11 ? ["🌅", "早间"] : h < 17 ? ["☀️", "午间"] : h < 23 ? ["🌙", "晚间"] : ["🌃", "深夜"];
    return { emoji: slot[0], text: (sc.label && sc.label.trim()) || slot[1] };
  }
  function planPickerLabel(p) {
    const name = p.name || "(unnamed)", mode = p.mode || "discovery";
    const tag = schedTag(p);
    let tail = ""; if (p.lastRunAt) tail = " · ran " + relTime(p.lastRunAt); else if (p.savedAt) tail = " · saved";
    return `${name} · ${mode}${tag ? ` · ${tag.emoji}${tag.text}` : ""}${tail}`;
  }
  // fillPicker — populate ONE <select>. The editor picker leads with "➕ New plan"; the
  // home picker is run-only (saved plans; an empty hint when there are none).
  function fillPicker(sel, plans, activeId, newFirst) {
    if (!sel) return;
    sel.innerHTML = "";
    if (newFirst) {
      const fresh = document.createElement("option");
      fresh.value = ""; fresh.textContent = "➕ New plan"; sel.appendChild(fresh);
    } else if (!plans.length) {
      const o = document.createElement("option");
      o.value = ""; o.textContent = "no saved plans — ✨ Generate or create one"; o.disabled = true; sel.appendChild(o);
    }
    for (const p of plans) {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = planPickerLabel(p); sel.appendChild(o);
    }
    const hasActive = activeId && plans.some((p) => p.id === activeId);
    sel.value = hasActive ? activeId : newFirst ? "" : plans[0] ? plans[0].id : "";
  }
  // fillPickerPop — the home executor's icon-popover (replaces the duplicated <select>).
  // Lists saved plans; the active one is highlighted; a footer jumps to the full editor.
  let activePlanId = "";
  function fillPickerPop(plans, activeId) {
    const pop = $("#pickerPop");
    pop.innerHTML = "";
    if (!plans.length) {
      const e = document.createElement("div");
      e.className = "pp-empty"; e.textContent = "No saved plans yet — ✨ Generate or create one.";
      pop.appendChild(e);
    } else {
      for (const p of plans) {
        const it = document.createElement("div");
        it.className = "pp-item" + (p.id === activeId ? " on" : "");
        it.dataset.id = p.id;
        const tag = schedTag(p);
        it.innerHTML = `<span class="pp-name">${escapeHtml(p.name || "(unnamed)")}</span>` +
          `<span class="pp-mode">${escapeHtml(p.mode || "")}</span>` +
          (tag ? `<span class="pp-sched" title="auto-runs · ${escapeHtml(tag.text)}">${tag.emoji}</span>` : "");
        pop.appendChild(it);
      }
    }
    const foot = document.createElement("div");
    foot.className = "pp-foot"; foot.id = "ppManage";
    foot.textContent = "✏ Manage / create plans…";
    pop.appendChild(foot);
  }
  function renderPicker(plans, activeId) {
    plansCache = plans || [];
    activePlanId = activeId && plansCache.some((p) => p.id === activeId)
      ? activeId : (plansCache[0] ? plansCache[0].id : "");
    fillPicker($("#planPicker"), plansCache, activeId, true);
    fillPickerPop(plansCache, activePlanId);
    $("#deletePlanBtn").disabled = !$("#planPicker").value;
  }

  const ACT_VERB = { like: "like", collect: "collect", follow: "follow", comment: "comment" };
  // fmtCount — compact 万 formatting shared by the readout + the account tile.
  const fmtCount = (n) => (n == null ? "–" : n >= 10000 ? Math.round(n / 1000) / 10 + "万" : String(n));
  // estMinutes — a transparent rough estimate of a run's wall-clock (the operator asked for
  // "estimated total time"). Per-note read ≈ browse + dwell; actions add their between-gaps.
  function estMinutes(plan) {
    const pc = plan.pacing || {}, am = plan.actionMix || {};
    const avg = (a) => (Array.isArray(a) && a.length === 2 ? ((+a[0] || 0) + (+a[1] || 0)) / 2 : 0);
    const dwell = avg(pc.dwellMs), between = avg(pc.betweenActionsMs);
    const BROWSE = 12000; // rough per-note read (image clicks / video watch / scroll)
    const notes = +pc.notesPerSession || 0;
    let acts = 0;
    for (const a of ["like", "collect", "follow", "comment"]) { const m = am[a] || {}; if (m.enabled) acts += Math.min(+m.count || 0, notes || +m.count || 0); }
    let ms;
    if (plan.mode === "comment_section") { const s = (plan.seeds || []).length || 1; ms = s * 22000 + acts * (between + (am.comment && am.comment.enabled ? 6000 : 0)); }
    else if (plan.mode === "profile") { const s = (plan.seeds || []).length || 1; ms = notes * (BROWSE + dwell) + acts * between + s * 9000; }
    else { ms = notes * (BROWSE + dwell + between) + acts * between; }
    return Math.max(1, Math.round(ms / 60000));
  }
  function renderReadout() {
    const plan = buildPlanFromForm();
    const am = plan.actionMix || {};
    const name = plan.name || ($("#planName").value.trim()) || "untitled";
    $("#roTitle").textContent = name; // mode is shown in the picker — the name is the title

    // Keywords as tags. For discovery these ARE the search keywords; URL modes show a count tag.
    const seeds = plan.seeds || [];
    const kw = $("#roSeeds");
    kw.innerHTML = "";
    if (plan.mode === "discovery") {
      if (seeds.length) {
        for (const s of seeds) { const el = document.createElement("span"); el.className = "kw"; el.textContent = s; kw.appendChild(el); }
      } else {
        const el = document.createElement("span"); el.className = "kw muted"; el.textContent = "personalized feed (no keywords)"; kw.appendChild(el);
      }
    } else {
      // Auto-sourced plans (no pasted URLs) feed themselves — show WHERE the work comes from
      // and the live pool count, never a broken-looking "no profiles added".
      const isAuto = plan.seedSource === "auto" || !seeds.length;
      const el = document.createElement("span");
      if (isAuto) {
        const pool = pipelineCache && pipelineCache.pool;
        el.className = "kw sched";
        if (plan.mode === "profile") {
          const q = pool ? pool.queued : null;
          el.textContent = `auto · ${q != null ? q : "—"} 线索待访问`;
          el.title = "draws un-visited leads from the accumulated pool";
        } else {
          const h = pipelineCache ? pipelineCache.hotNotes : null;
          el.textContent = `auto · ${h != null ? h : "—"} 笔记可截流`;
          el.title = "harvests the commenters of notes discovery surfaced";
        }
      } else {
        const noun = plan.mode === "profile" ? "profile" : "note";
        el.className = "kw";
        el.textContent = `${seeds.length} ${noun}${seeds.length > 1 ? "s" : ""}`;
      }
      kw.appendChild(el);
    }
    // Auto-schedule tag — the slot label only; the exact next-run time lives in the tooltip.
    const tag = schedTag(plan);
    if (tag) {
      const el = document.createElement("span");
      el.className = "kw sched"; el.id = "roSchedTag";
      el.textContent = `${tag.emoji} ${tag.text}`;
      el.title = "auto-runs";
      kw.appendChild(el);
    }

    // Estimated total time (turns into the live progress bar once a session runs).
    const mins = estMinutes(plan);
    $("#roTime").textContent = mins >= 60 ? `~${Math.floor(mins / 60)}h ${mins % 60}m` : `~${mins} min`;

    // Will-do chips: a tasteful icon + the quantity. No "tap only"/"submit" prose here.
    const wd = $("#roActions");
    wd.innerHTML = "";
    let any = false;
    for (const a of ["like", "collect", "follow", "comment"]) {
      const m = am[a] || {};
      if (!m.enabled) continue;
      any = true;
      const chip = document.createElement("span");
      chip.className = "wd";
      chip.title = ACT_VERB[a];
      chip.innerHTML = `<span class="wd-i">${ICON[a]}</span><span class="wd-n">${m.count || 0}</span>`;
      wd.appendChild(chip);
    }
    if (am.gather && am.gather.enabled) {
      any = true;
      const chip = document.createElement("span");
      chip.className = "wd"; chip.title = "gather targets";
      chip.innerHTML = `<span class="wd-i">${ICON.gather}</span>`;
      wd.appendChild(chip);
    }
    if (!any) { const n = document.createElement("span"); n.className = "wd-none"; n.textContent = "no actions enabled"; wd.appendChild(n); }
  }
  // readoutText — plain-text summary for the LIVE-run confirm dialog (keeps the submit detail
  // that the chips intentionally drop, so a live run still spells out the risk).
  function readoutText() {
    const plan = buildPlanFromForm(), am = plan.actionMix || {};
    const parts = [];
    for (const a of ["like", "collect", "follow", "comment"]) { const m = am[a] || {}; if (m.enabled) parts.push(`${ACT_VERB[a]} ×${m.count || 0}`); }
    if (am.gather && am.gather.enabled) parts.push("gather");
    const cm = am.comment || {};
    const sub = cm.enabled ? (cm.submit ? " · comments SUBMIT" : " · comments type-only") : "";
    return [$("#roTitle").textContent, "Est. " + $("#roTime").textContent, "Will: " + (parts.join(", ") || "nothing") + sub].join("\n");
  }

  // ---- account traction render ----------------------------------------------
  const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const deltaStr = (n) => (n == null ? "" : (n > 0 ? "+" : "") + (Math.abs(n) >= 10000 ? Math.round(n / 1000) / 10 + "万" : n));
  const deltaCls = (n) => (n == null || n === 0 ? "flat" : n > 0 ? "up" : "down");
  // spark — a tiny unicode sparkline of the fans trend.
  const spark = (arr) => {
    if (!arr || arr.length < 2) return "";
    const bars = "▁▂▃▄▅▆▇█", mn = Math.min(...arr), mx = Math.max(...arr), rng = mx - mn || 1;
    return arr.map((v) => bars[Math.round(((v - mn) / rng) * (bars.length - 1))]).join("");
  };
  function renderAccount(view) {
    const body = $("#acctBody");
    if (!body) return;
    if (!view || !view.hasData) {
      body.innerHTML = `<span class="acct-empty">No reading yet — a run captures this automatically, or tap ↻.</span>`;
      return;
    }
    const name = view.nickname ? `<div class="acct-name">${escapeHtml(view.nickname)}</div>` : "";
    const nr = view.newThisRun || {};
    const stat = (label, val, dHtml) =>
      `<div class="acct-stat"><div class="l">${label}</div><div class="n">${val == null ? "—" : fmtCount(val)}</div>${dHtml}</div>`;
    const dRun = (d) => (d == null ? `<div class="d flat">—</div>` : `<div class="d ${deltaCls(d)}">${deltaStr(d)} this run</div>`);
    const fixed = (t) => `<div class="d flat">${t}</div>`;
    const grid = `<div class="acct-grid">
      ${stat("粉丝 fans", view.fans, dRun(nr.fans))}
      ${stat("获赞与收藏", view.interaction, dRun(nr.interaction))}
      ${stat("incoming likes", view.incomingLikes7d, fixed("last 7d"))}
      ${stat("new followers", view.newFollowers7d, fixed("last 7d"))}
    </div>`;
    const sp = spark(view.trend);
    const trend = sp ? `<div class="acct-meta">fans trend ${sp}</div>` : "";
    const meta = `<div class="acct-meta">关注 ${fmtCount(view.follows)} · read ${view.lastReadAt ? relTime(view.lastReadAt) : "—"}</div>`;
    body.innerHTML = name + grid + trend + meta;
  }
  async function refreshAccount() {
    const r = await send({ type: "hs:account:get" });
    if (r && r.ok) renderAccount(r.view);
  }

  // ---- self-feeding pipeline (the autopilot heartbeat) -----------------------
  let pipelineCache = null;
  const MODE_CN = { discovery: "发现页", comment_section: "评论区", profile: "主页" };
  // relFuture — a soft, time-free countdown to the next auto-run ("约3小时后"). Never a clock.
  function relFuture(ts) {
    if (!ts) return "";
    const s = Math.round((ts - Date.now()) / 1000);
    if (s <= 60) return "即将";
    const m = Math.round(s / 60); if (m < 60) return `约${m}分钟后`;
    const h = Math.round(m / 60); if (h < 24) return `约${h}小时后`;
    return `约${Math.round(h / 24)}天后`;
  }
  // nextWillDo — a meaningful one-liner for the next scheduled run, by mode + seed source.
  function nextWillDo(run, pool) {
    const mode = MODE_CN[run.mode] || run.mode;
    if (run.mode === "profile") return `${mode} · 访问约 ${Math.min(6, pool ? pool.queued : 0) || "—"} 位线索`;
    if (run.mode === "comment_section") return `${mode} · 截流评论区`;
    return `${mode} · 关键词种草`;
  }
  function renderPipeline(view) {
    pipelineCache = view || null;
    const tile = $("#pipeTile");
    if (!tile) return;
    const armed = view && view.nextRuns && view.nextRuns.length;
    const pool = (view && view.pool) || { accumulated: 0, queued: 0, visited: 0 };
    const hasAnything = armed || pool.accumulated > 0;
    tile.hidden = !hasAnything; // stay invisible until there's a campaign or a pool to show
    if (!hasAnything) return;

    // warming phase chip
    const ph = $("#pipePhase");
    const w = view && view.warming;
    if (w) {
      ph.hidden = false;
      ph.className = "phase " + (w.key === "active" ? "active" : w.key === "warming" ? "mid" : "early");
      ph.textContent = `${w.label} · ${Math.round((w.scale || 1) * 100)}%`;
      ph.title = "warming phase — caps scaled to the account's size/age";
    } else ph.hidden = true;

    const body = $("#pipeBody");
    const flow = `<div class="pipe-flow">
      <div class="pf"><div class="pf-n">${view.hotNotes || 0}</div><div class="pf-l">discovered</div></div>
      <div class="pf-arrow">→</div>
      <div class="pf"><div class="pf-n">${pool.accumulated || 0}</div><div class="pf-l">leads</div></div>
      <div class="pf-arrow">→</div>
      <div class="pf hot"><div class="pf-n">${pool.queued || 0}</div><div class="pf-l">queued visits</div></div>
    </div>`;
    const sub = `<div class="pipe-sub">${pool.visited || 0} leads visited so far · the loop fills then drains the pool automatically</div>`;
    let next = "";
    if (armed) {
      const r0 = view.nextRuns[0];
      const slot = (r0.label && r0.label.trim()) || MODE_CN[r0.mode] || r0.mode;
      next = `<div class="pipe-next"><span class="slot">next ▸ ${escapeHtml(slot)}</span>` +
        `<span>${escapeHtml(nextWillDo(r0, pool))}</span><span class="when">${escapeHtml(relFuture(r0.nextRunAt))}</span></div>`;
    } else {
      next = `<div class="pipe-next pipe-empty">✨ Generate &amp; accept a campaign to start the autopilot.</div>`;
    }
    body.innerHTML = flow + sub + next;
  }
  async function refreshPipeline() {
    const r = await send({ type: "hs:pipeline:status" });
    if (r && r.ok) renderPipeline(r);
  }

  // ---- targets (harvested leads) ---------------------------------------------
  let targetsCache = []; // last fetched list (rendered filtered by the group select)
  const truncate = (s, n) => { const t = String(s == null ? "" : s); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  // fillTargetsGroups — refresh the filter <select> from the groups[] array, keeping "all".
  function fillTargetsGroups(groups) {
    const sel = $("#targetsGroup");
    const cur = sel.value;
    sel.innerHTML = `<option value="">all groups</option>`;
    for (const g of groups || []) {
      if (!g) continue;
      const o = document.createElement("option");
      o.value = g; o.textContent = g; sel.appendChild(o);
    }
    sel.value = (groups || []).includes(cur) ? cur : "";
  }
  function renderTargets() {
    const list = $("#targetsList");
    const grp = $("#targetsGroup").value;
    const rows = targetsCache.filter((t) => !grp || (t.group || "") === grp);
    if (!rows.length) {
      list.innerHTML = `<div class="tg-empty">No targets gathered yet — enable Gather on a comment_section/profile plan and run it.</div>`;
      return;
    }
    list.innerHTML = rows.map((t) => {
      const nick = escapeHtml(t.nickname || t.userId || "(unknown)");
      const name = t.profileUrl
        ? `<a href="${escapeHtml(t.profileUrl)}" target="_blank" rel="noopener">${nick}</a>` : nick;
      const uid = t.userId ? `<span class="tg-uid">${escapeHtml(t.userId)}</span>` : "";
      const content = t.content ? `<div class="tg-content">${escapeHtml(truncate(t.content, 160))}</div>` : "";
      const chips = [];
      if (t.followers != null) chips.push(`<span class="tg-chip">粉丝 ${fmtCount(+t.followers)}</span>`);
      if (t.likes != null) chips.push(`<span class="tg-chip">获赞收藏 ${fmtCount(+t.likes)}</span>`);
      if (t.ipLocation) chips.push(`<span class="tg-chip">${escapeHtml(t.ipLocation)}</span>`);
      if (t.gender) chips.push(`<span class="tg-chip">${escapeHtml(t.gender)}</span>`);
      if (t.group) chips.push(`<span class="tg-chip grp">${escapeHtml(t.group)}</span>`);
      const chipsHtml = chips.length ? `<div class="tg-chips">${chips.join("")}</div>` : "";
      return `<div class="tg-item"><div class="tg-top"><span class="tg-name">${name}</span>${uid}</div>${content}${chipsHtml}</div>`;
    }).join("");
  }
  async function loadTargets() {
    const r = await send({ type: "hs:targets:list" });
    if (r && r.ok) {
      targetsCache = r.targets || [];
      fillTargetsGroups(r.groups || []);
      renderTargets();
    } else {
      targetsCache = [];
      $("#targetsList").innerHTML = `<div class="tg-empty">${escapeHtml((r && r.error) || "could not read targets")}</div>`;
    }
  }

  // ---- view switching ----
  const VIEWS = { home: "#homeView", plans: "#plansView", targets: "#targetsView", log: "#logView", manual: "#manualView", settings: "#settingsView" };
  function showView(name) {
    for (const [k, sel] of Object.entries(VIEWS)) $(sel).hidden = k !== name;
    $("#scroll").scrollTop = 0;
    if (name === "manual") refreshState();
    if (name === "targets") loadTargets();
  }

  // ---- event wiring ----
  $("#planMode").addEventListener("change", updateSeedsLabel);
  $("#planPanel").addEventListener("input", renderReadout);
  $("#planPanel").addEventListener("change", renderReadout);
  $("#dryRun").addEventListener("change", renderReadout);

  // selectPlan — the single path both pickers use. Loads the plan into the (hidden) editor
  // form — which is what the readout + Run read — persists it as the active plan, and keeps
  // both selects in sync. id "" = a fresh New plan (editor only).
  async function selectPlan(id) {
    if (!id) {
      populatePlanForm(JSON.parse(JSON.stringify(NEW_PLAN)));
      $("#planName").value = "";
    } else {
      const cached = plansCache.find((p) => p.id === id);
      const r = await send({ type: "hs:plans:select", id }); // loads authoritative + persists active
      const plan = (r && r.ok && r.plan) || cached;
      if (plan) { populatePlanForm(plan); $("#planName").value = plan.name || ""; }
    }
    if ($("#planPicker").value !== (id || "")) $("#planPicker").value = id || "";
    if (id) { activePlanId = id; fillPickerPop(plansCache, activePlanId); }
    $("#deletePlanBtn").disabled = !$("#planPicker").value;
    renderReadout();
    refreshSchedNext();
  }
  $("#planPicker").addEventListener("change", () => selectPlan($("#planPicker").value));
  // icon-picker: tap to reveal the popover; pick an item (or jump to the editor) inside it.
  $("#pickerBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#pickerPop").hidden = !$("#pickerPop").hidden; });
  $("#openPortal").addEventListener("click", () => send({ type: "hs:portal:open" }));
  $("#acctRefresh").addEventListener("click", async () => {
    const btn = $("#acctRefresh");
    btn.disabled = true; setStatus("Reading account…");
    const r = await send({ type: "hs:account:refresh" });
    btn.disabled = false;
    if (r && r.ok) { renderAccount(r.view); setStatus("Account updated", "ok"); }
    else setStatus((r && r.error) || "account read failed — open XHS & make sure you're logged in", "err");
  });

  // targets view: filter, refresh, export, clear
  $("#targetsGroup").addEventListener("change", renderTargets);
  $("#targetsRefresh").addEventListener("click", loadTargets);
  $("#targetsExport").addEventListener("click", async () => {
    setStatus("Exporting targets…");
    const r = await send({ type: "hs:targets:export" });
    setStatus(r && r.ok ? `Exported ${r.count} targets → Downloads/` : (r && r.error) || "nothing to export yet", r && r.ok ? "ok" : "warn");
  });
  $("#targetsClear").addEventListener("click", async () => {
    const grp = $("#targetsGroup").value;
    const what = grp ? `group "${grp}"` : "ALL gathered targets";
    if (!window.confirm(`Clear ${what}? This can't be undone.`)) return;
    const r = await send(grp ? { type: "hs:targets:clear", group: grp } : { type: "hs:targets:clear" });
    if (r && r.ok) { setStatus("Targets cleared", "ok"); loadTargets(); }
    else setStatus((r && r.error) || "clear failed", "err");
  });

  $("#deletePlanBtn").addEventListener("click", async () => {
    const id = $("#planPicker").value;
    if (!id || !window.confirm("Delete this saved plan?")) return;
    const r = await send({ type: "hs:plans:delete", id });
    if (r && r.ok) { renderPicker(r.plans, r.activeId); $("#planPicker").dispatchEvent(new Event("change")); setStatus("Plan deleted", "ok"); }
    else setStatus((r && r.error) || "delete failed", "err");
  });

  $("#savePlanBtn").addEventListener("click", async () => {
    setStatus("Saving plan…");
    const r = await send({ type: "hs:plans:save", plan: buildPlanFromForm(), name: $("#planName").value.trim() });
    if (r && r.ok) {
      if (r.plan) populatePlanForm(r.plan);
      $("#planName").value = (r.plan && r.plan.name) || $("#planName").value;
      renderPicker(r.plans, r.activeId); renderReadout(); setStatus("Plan saved", "ok");
      send({ type: "hs:schedule:sync" }).then(refreshSchedNext); // rebuild alarms after a save
    } else setStatus((r && r.error) || "save failed", "err");
  });

  // pendingCampaign — ids of the last generated set, consumed by ONE "Accept campaign"
  // click (arms all of their AI-decided schedules; the operator never touches a time).
  let pendingCampaign = null;
  function showCampaignBar(generated) {
    pendingCampaign = generated.map((g) => g.id);
    const tags = generated.map((g) => {
      const t = schedTag({ schedule: { ...(g.schedule || {}), enabled: true } });
      return `${g.mode}${t ? ` ${t.emoji}${t.text}` : ""}`;
    });
    $("#campTxt").innerHTML = `<b>✨ Campaign ready</b> — ${tags.map(escapeHtml).join(" · ")}<br>Accept to auto-run all 3, staggered (错峰).`;
    $("#campBar").hidden = false;
  }
  $("#aiGenBtn").addEventListener("click", async () => {
    const subject = $("#aiSubject").value.trim();
    if (!subject) return setStatus("Describe your account first", "err");
    setStatus("Generating…");
    const r = await send({ type: "hs:ai:plan", subject });
    if (r && r.ok) {
      populatePlanForm(r.plan); $("#planName").value = (r.plan && r.plan.name) || "";
      renderPicker(r.plans, r.activeId); renderReadout();
      if (r.generated && r.generated.length > 1) { showCampaignBar(r.generated); setStatus("✨ Campaign ready — accept to schedule", "ok"); }
      else setStatus("Plan generated & saved — review & Run", "ok");
    } else setStatus((r && r.error) || "generate failed", "err");
  });
  $("#campAccept").addEventListener("click", async () => {
    if (!pendingCampaign || !pendingCampaign.length) return;
    $("#campAccept").disabled = true;
    const r = await send({ type: "hs:campaign:accept", ids: pendingCampaign });
    $("#campAccept").disabled = false;
    if (r && r.ok) {
      $("#campBar").hidden = true;
      pendingCampaign = null;
      renderPicker(r.plans, r.activeId);
      if (r.activeId) await selectPlan(r.activeId); // reload the armed schedule into the form
      await refreshPipeline(); // the autopilot is now armed — show the pipeline tile
      setStatus(`✓ Campaign armed — ${(r.scheduled || []).length} plans auto-run 错峰`, "ok");
    } else setStatus((r && r.error) || "accept failed", "err");
  });

  $("#saveSettingsBtn").addEventListener("click", async () => {
    setStatus("Saving settings…");
    const g = await send({ type: "hs:getConfig" });
    const config = (g && g.ok && g.config) || {};
    config.ai = { endpoint: $("#aiEndpoint").value, model: $("#aiModel").value, apiKey: $("#aiKey").value };
    const r = await send({ type: "hs:setConfig", config });
    setStatus(r && r.ok ? "Settings saved" : (r && r.error) || "save failed", r && r.ok ? "ok" : "err");
  });

  $("#runBtn").addEventListener("click", async () => {
    const plan = buildPlanFromForm();
    plan.dryRun = $("#dryRun").checked;
    renderReadout();
    if (!plan.dryRun && !window.confirm("Run LIVE — this will perform real actions.\n\n" + readoutText() + "\n\nContinue?")) {
      setStatus("Run cancelled", "warn"); return;
    }
    setStatus("Starting session…");
    const r = await send({ type: "hs:session:start", plan });
    setStatus(r && r.ok ? "Session: " + r.summary : (r && r.error) || "start failed", r && r.ok ? "ok" : "err");
    poll();
  });
  $("#stopBtn").addEventListener("click", async () => { await send({ type: "hs:session:stop" }); setStatus("Stop requested", "warn"); poll(); });
  $("#resetGov").addEventListener("click", async () => { await send({ type: "hs:gov:reset" }); await emit("counters reset", "info"); poll(); });
  $("#exportLogBtn").addEventListener("click", async () => {
    const r = await send({ type: "hs:log:export" });
    setStatus(r && r.ok ? `Log exported (${r.count} lines) → Downloads/hs-portal/` : (r && r.error) || "nothing to export yet", r && r.ok ? "ok" : "warn");
  });

  // manual ops
  async function refreshState() {
    const r = await send({ type: "hs:status" });
    const stateEl = $("#state");
    if (!r || !r.ok) { if (stateEl) stateEl.hidden = true; return; }
    if (stateEl) stateEl.hidden = false;
    $("#noteId").textContent = r.noteId || "— (no note open)";
    $("#liked").textContent = r.liked == null ? "—" : r.liked ? "yes" : "no";
    $("#collected").textContent = r.collected == null ? "—" : r.collected ? "yes" : "no";
  }
  async function runManual(action, args, btn) {
    if (btn) btn.disabled = true;
    setStatus(`Running ${action}…`);
    try {
      const r = await send({ type: "hs:run", action, args });
      const okk = r && r.ok;
      await emit(`manual ${action}: ${okk ? r.detail || "ok" : "FAIL " + ((r && r.error) || "no response")}`, okk ? "ok" : "err");
      setStatus(`${action} ${okk ? "✓" : "failed"}`, okk ? "ok" : "err");
    } finally { if (btn) btn.disabled = false; refreshState(); poll(); }
  }

  // delegated clicks within the shadow root: picker popover, cap switch, nav, back, manual actions
  root.addEventListener("click", (e) => {
    // close the plan popover on any click outside it (the icon button stops its own propagation)
    if (!e.target.closest("#pickerPop")) $("#pickerPop").hidden = true;
    const pi = e.target.closest(".pp-item");
    if (pi) { $("#pickerPop").hidden = true; selectPlan(pi.dataset.id); return; }
    if (e.target.closest("#ppManage")) { $("#pickerPop").hidden = true; showView("plans"); return; }
    const cap = e.target.closest("#capSwitch button[data-cap]");
    if (cap) {
      capMode = cap.dataset.cap;
      for (const b of root.querySelectorAll("#capSwitch button")) b.classList.toggle("on", b === cap);
      if (lastStatus) renderBudget(lastStatus);
      return;
    }
    const go = e.target.closest("button[data-go]");
    if (go) { showView(go.dataset.go); return; }
    if (e.target.closest("button[data-back]")) { showView("home"); return; }
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    let args = btn.dataset.args ? JSON.parse(btn.dataset.args) : {};
    if (action === "comment") {
      const txt = $("#commentText").value.trim();
      if (!txt) return setStatus("Enter comment text first", "err");
      args = { text: txt };
    }
    runManual(action, args, btn);
  });
  $("#refresh").addEventListener("click", refreshState);

  // ---- boot (heavy, once) + polling + open/collapse ----
  let booted = false, pollTimer = null;
  function startPoll() { if (pollTimer) return; poll(); pollTimer = setInterval(poll, 1000); }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  async function boot() {
    if (booted) return;
    booted = true;
    const g = await send({ type: "hs:plans:list" });
    if (g && g.ok) {
      renderPicker(g.plans, g.activeId);
      // Load the resolved active plan (renderPicker picks active, else the first saved plan)
      // into the form — which drives the readout + Run; fall back to a fresh New plan.
      if (activePlanId) await selectPlan(activePlanId);
      else { populatePlanForm(JSON.parse(JSON.stringify(NEW_PLAN))); $("#planName").value = ""; renderReadout(); }
    } else { populatePlanForm(JSON.parse(JSON.stringify(NEW_PLAN))); renderReadout(); }
    const cfg = await send({ type: "hs:getConfig" });
    if (cfg && cfg.ok && cfg.config && cfg.config.ai) {
      const ai = cfg.config.ai;
      $("#aiEndpoint").value = ai.endpoint || ""; $("#aiModel").value = ai.model || ""; $("#aiKey").value = ai.apiKey || "";
    }
    await refreshAccount();
    await refreshPipeline();
    await checkConn();
  }

  async function checkConn() {
    const tab = await send({ type: "hs:status" });
    const tag = $("#connTag");
    if (tab && tab.ok) {
      tag.className = "conn-tag ok";
      tag.textContent = tab.onNote ? "● note open" : "● on XHS";
      tag.title = tab.onNote ? "on XHS · note open" : "on XHS · open a note to act";
      setStatus("connected", "ok");
    } else {
      tag.className = "conn-tag err";
      tag.textContent = "● offline";
      tag.title = "content engine not reachable — reload the XHS tab";
      setStatus("engine not reachable — reload tab", "warn");
    }
  }

  // remember the last open/collapsed choice across page loads (chrome.storage.local)
  const UI_KEY = "hs_ui";
  const getPref = () => new Promise((res) => { try { chrome.storage.local.get(UI_KEY, (c) => res((c && c[UI_KEY]) || {})); } catch { res({}); } });
  const setPref = (p) => { try { chrome.storage.local.set({ [UI_KEY]: p }); } catch {} };

  function openPanel() { panel.hidden = false; fab.hidden = true; showView("home"); boot(); startPoll(); setPref({ collapsed: false }); }
  function collapse() { panel.hidden = true; fab.hidden = false; stopPoll(); setPref({ collapsed: true }); }
  function hideAll() { panel.hidden = true; fab.hidden = true; stopPoll(); }
  function toggle() { if (!panel.hidden) collapse(); else openPanel(); }

  $("#collapseBtn").addEventListener("click", collapse);
  fab.addEventListener("click", openPanel);

  // Optional external toggle (e.g. a toolbar action). engine.js ignores non-"hs:action".
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (!msg || typeof msg.type !== "string" || msg.type.indexOf("hs:panel:") !== 0) return;
    if (msg.type === "hs:panel:toggle") toggle();
    else if (msg.type === "hs:panel:open") openPanel();
    else if (msg.type === "hs:panel:close") hideAll();
    sendResponse({ ok: true, visible: !panel.hidden });
    return;
  });

  // ---- AUTO-SHOW ----------------------------------------------------------
  // The content script is injected on every XHS page (manifest content_scripts
  // match), so the panel presents itself: on load it opens automatically —
  // honoring the last collapse choice — EXCEPT inside the spawned automation
  // window (background flags it via `isAutomationWindow`), where the status pill
  // is the right, unobtrusive surface.
  (async () => {
    const st = await send({ type: "hs:session:status" });
    if (st && st.ok && st.isAutomationWindow) return; // automation window → pill only
    const pref = await getPref();
    if (pref.collapsed) collapse(); else openPanel();
  })();

  console.info("[hs] panel ready");
})();
