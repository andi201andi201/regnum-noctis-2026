import { getStore } from "./store.js?v=hunt-3";
import { getPlayerProfile } from "./player.js";
import { huntProgress } from "./hunt-data.js?v=hunt-3";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let state = null;

store.subscribe(value => { state = value; render(); });
window.addEventListener("regnum-player-changed", render);

function render() {
  const hunt = state?.settings?.hunt || {};
  const profile = getPlayerProfile();
  const visible = !!hunt.roundId && !!profile?.teamId;
  $("#huntSummaryCard").classList.toggle("hidden", !visible);
  if (!visible) return;
  const count = huntProgress(state.games, hunt.roundId, profile.teamId).size;
  const total = Number(hunt.targetCount || Object.keys(hunt.targets || {}).length || 10);
  $("#huntSummaryCount").textContent = `${count} / ${total}`;
  $("#huntSummaryStatus").textContent = hunt.active ? "Die Jagd läuft · jederzeit mitmachen" : "Beendet · euer Fortschritt bleibt sichtbar";
  $("#openHuntPage").textContent = hunt.active ? "Nachtjagd öffnen" : "Fortschritt ansehen";
}
