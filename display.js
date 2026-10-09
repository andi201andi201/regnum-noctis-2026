import { TEAMS, totalsFromGames, formatTime } from "./data.js?v=hunt-3";
import { getStore } from "./store.js?v=hunt-3";
import { huntFinds, huntProgress } from "./hunt-data.js?v=hunt-3";

const $ = selector => document.querySelector(selector);
const store = await getStore();
$("#displayConnection").textContent = store.demo ? "Lokaler Demomodus" : "Live verbunden";
store.subscribe(render);

function render(state) {
  const totals = totalsFromGames(state.games);
  const ranking = [...TEAMS].sort((a, b) => totals[b.id] - totals[a.id] || a.name.localeCompare(b.name));
  $("#displayLeaderboard").innerHTML = ranking.map((team, index) => `<li class="${index === 0 ? "leader" : ""}" style="--team:${team.color};--glow:${team.glow}"><span class="display-rank">${index + 1}</span><img src="${team.logo}" alt=""><div><strong>${team.name}</strong><small>${team.title}</small></div>${index === 0 ? "<b class=display-crown>♛</b>" : ""}<em>${totals[team.id]}<small>Punkte</small></em></li>`).join("");
  const hunt = state.settings.hunt || {}, total = Number(hunt.targetCount || 10);
  $("#displayHuntStatus").textContent = hunt.active ? "Die Jagd läuft" : hunt.roundId ? "Jagd beendet" : "Noch nicht gestartet";
  $("#displayHuntProgress").innerHTML = TEAMS.map(team => { const count = hunt.roundId ? huntProgress(state.games, hunt.roundId, team.id).size : 0; return `<div style="--team:${team.color}"><header><span>${team.marker} ${team.name}</span><strong>${count} / ${total}</strong></header><i><b style="width:${total ? count / total * 100 : 0}%"></b></i></div>`; }).join("");
  const latest = huntFinds(state.games, hunt.roundId).sort((a, b) => b.createdAt - a.createdAt)[0];
  $("#displayLastFind").classList.toggle("hidden", !latest);
  if (latest) { const team = TEAMS.find(item => item.id === latest.teamId); $("#displayLastFind").innerHTML = `<span>Letzter Fund · ${formatTime(latest.createdAt)}</span><strong>Gegenstand ${latest.targetNumber} gefunden</strong><small>von ${escapeHtml(latest.playerName)} · ${team?.marker || ""} ${team?.name || latest.teamId}</small>`; }
  $("#displayUpdated").textContent = state.settings.updatedAt ? `Stand ${formatTime(state.settings.updatedAt)}` : "";
}

function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = String(value); return div.innerHTML; }
