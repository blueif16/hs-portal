// popup.js — status-only glance. The dashboard now auto-opens as an in-page Shadow-DOM
// overlay on XHS tabs (src/content/panel.js), so the toolbar popup has no "open" button —
// it just reports where you are and whether a session is running (handy from any tab).

const $ = (s) => document.querySelector(s);
const XHS = /(?:^|\.)xiaohongshu\.com|(?:^|\.)rednote\.com/;

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t || null;
}
function isXhs(t) {
  try { return !!(t && t.url && XHS.test(new URL(t.url).hostname)); } catch { return false; }
}
function setStatus(text, kind) {
  const el = $("#status");
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

(async () => {
  // live session line (glance without touching the page)
  chrome.runtime.sendMessage({ type: "hs:session:status" }, (r) => {
    if (chrome.runtime.lastError) return;
    const ss = r && r.ok && r.status && r.status.session;
    const sess = $("#sess");
    if (ss && ss.running) {
      const p = ss.progress || {};
      sess.textContent = `● running · ${ss.mode} · note ${p.note ?? "–"}/${p.total ?? "–"}${ss.dryRun ? " · dry-run" : " · LIVE"}`;
      sess.className = "sess live";
    } else if (ss && ss.actionsTaken) {
      sess.textContent = `idle · last session · ${ss.actionsTaken} actions`;
    } else {
      sess.textContent = "idle";
    }
  });

  const t = await activeTab();
  if (isXhs(t)) setStatus("On Xiaohongshu ✓ — panel is on the page", "ok");
  else setStatus("Open a xiaohongshu.com tab — the panel appears there automatically", "warn");
})();

// Content Studio launcher — works from any tab (popup runs in the extension context).
$("#openPortal").addEventListener("click", () => {
  try { chrome.tabs.create({ url: chrome.runtime.getURL("portal/portal.html") }); } catch (e) {}
});
