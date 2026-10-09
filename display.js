import { TEAMS, totalsFromGames, formatTime, NOVITIUS_GAME } from "./data.js?v=novitius-2";
import { getStore } from "./store.js?v=novitius-2";
import { huntFinds, huntProgress } from "./hunt-data.js?v=novitius-2";

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
  renderNovitius(state);
  $("#displayUpdated").textContent = state.settings.updatedAt ? `Stand ${formatTime(state.settings.updatedAt)}` : "";
}

function renderNovitius(state) {
  const game = state.games?.[NOVITIUS_GAME.id], visible = game?.status === "running" && Number(game.currentQuestion || 0) > 0;
  $("#displayNovitius").classList.toggle("hidden", !visible);
  if (!visible) return;
  const number = Number(game.currentQuestion), key = `question-${number}`, question = game.currentQuestionData, reveal = game.publicReveals?.[key];
  const submissions = Object.keys(state.novitiusSubmissions?.[key] || {}).length;
  const eligible = Object.values(game.teamSizes || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  if (!reveal) {
    $("#displayNovitiusContent").innerHTML = `<span>Frage ${number} / ${NOVITIUS_GAME.questionCount}</span><strong>${escapeHtml(question?.text || "Warte auf die nächste Frage …")}</strong><em>Antworten: ${submissions} / ${eligible} abgegeben</em>`;
    return;
  }
  $("#displayNovitiusContent").innerHTML = `<span>Frage ${number} aufgelöst</span><strong>Richtige Antwort: ${escapeHtml(formatNovitiusValue(reveal.correctValue, reveal.unit))}</strong><ol>${(reveal.ranking || []).map((id, index) => { const team = TEAMS.find(item => item.id === id); return `<li><b>${index + 1}. ${team?.marker || ""} ${team?.name || id}</b><em>${Number(reveal.teamTotals?.[id] || 0).toFixed(2)}</em></li>`; }).join("")}</ol>`;
}

function formatNovitiusValue(value, unit = "") { const formatted = typeof value === "number" ? new Intl.NumberFormat("de-CH").format(value) : String(value); return `${formatted}${unit ? ` ${unit}` : ""}`; }

function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = String(value); return div.innerHTML; }
