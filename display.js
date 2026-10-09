import { TEAMS, totalsFromGames, formatTime, NOVITIUS_GAME } from "./data.js?v=challenges-2";
import { getStore } from "./store.js?v=challenges-2";
import { huntFinds, huntProgress } from "./hunt-data.js?v=challenges-2";
import { GAME_CHALLENGES, GAME_CHALLENGE_ROTATIONS, stationById, challengeTimerRemaining } from "./challenges-data.js?v=challenges-2";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let currentState = null;
$("#displayConnection").textContent = store.demo ? "Lokaler Demomodus" : "Live verbunden";
store.subscribe(render);

function render(state) {
  currentState = state;
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
  renderChallenges(state);
  $("#displayUpdated").textContent = state.settings.updatedAt ? `Stand ${formatTime(state.settings.updatedAt)}` : "";
}

function renderChallenges(state) {
  const game = state.games?.[GAME_CHALLENGES.id], visible = game?.status === "running";
  document.body.classList.toggle("challenges-active", visible);
  $("#displayChallenges").classList.toggle("hidden", !visible);
  if (!visible) return;
  const round = Number(game.currentRound || 1), publicRound = game.publicRounds?.[`round-${round}`];
  $("#displayChallengeRound").textContent = `Runde ${round} / ${GAME_CHALLENGES.roundCount}`;
  updateChallengeTimer();
  if (game.phase === "published" && publicRound) {
    $("#displayChallengeContent").innerHTML = `<p class="display-change-call">RUNDE ${round} – RESULTATE</p><div class="display-challenge-results">${TEAMS.map(team => { const result = publicRound.teams?.[team.id]; return `<article style="--team:${team.color}"><b>${team.marker} ${team.name}</b><span>${result.stationId === "estimate" ? "Schätzungen abgegeben" : `${Number(result.value).toLocaleString("de-CH")} ${escapeHtml(result.unit || "")}`}</span></article>`; }).join("")}</div>`;
    return;
  }
  $("#displayChallengeContent").innerHTML = `<p class="display-change-call ${challengeTimerRemaining(game.timer) <= 0 && game.timer?.status === "running" ? "is-change" : "hidden"}">WECHSEL!</p><div class="display-challenge-rotation">${TEAMS.map(team => { const station = stationById(GAME_CHALLENGE_ROTATIONS[`round-${round}`][team.id]); return `<article style="--team:${team.color}"><b>${team.marker} ${team.name}</b><span>${station.icon} ${escapeHtml(station.name)}</span></article>`; }).join("")}</div>`;
}

function updateChallengeTimer() {
  const game = currentState?.games?.[GAME_CHALLENGES.id]; if (!game || game.status !== "running") return;
  const remaining = challengeTimerRemaining(game.timer), seconds = Math.ceil(remaining / 1000), expired = remaining <= 0 && game.timer?.status === "running";
  $("#displayChallengeTimer").textContent = expired ? "WECHSEL" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const changeCall = $("#displayChallengeContent .display-change-call");
  if (changeCall && game.phase !== "published") changeCall.classList.toggle("hidden", !expired);
}
setInterval(updateChallengeTimer, 250);

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
