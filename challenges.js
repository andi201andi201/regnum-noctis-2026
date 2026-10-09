import { TEAMS } from "./data.js?v=beer-pong-1";
import { getStore } from "./store.js?v=beer-pong-1";
import { GAME_CHALLENGES, GAME_CHALLENGE_ROTATIONS, stationById, challengeTimerRemaining } from "./challenges-data.js?v=beer-pong-1";
import { getPlayerProfile } from "./player.js";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let game = null;

store.subscribe(state => { game = state.games?.[GAME_CHALLENGES.id] || null; render(); });
window.addEventListener("regnum-player-changed", render);
setInterval(updateTimer, 250);

function render() {
  const visible = game?.status === "running";
  $("#gameChallengesCard").classList.toggle("hidden", !visible);
  if (!visible) return;
  const round = Number(game.currentRound || 1), teamId = getPlayerProfile()?.teamId, station = stationById(GAME_CHALLENGE_ROTATIONS[`round-${round}`]?.[teamId]);
  const phaseLabels = { ready: "Bereit", running: "Läuft", paused: "Pausiert", results: "Resultate werden erfasst", published: "Runde veröffentlicht" };
  $("#gameChallengesStatus").textContent = phaseLabels[game.phase] || "Läuft";
  $("#challengePublicRound").textContent = `Runde ${round} von ${GAME_CHALLENGES.roundCount}`;
  const team = TEAMS.find(item => item.id === teamId);
  $("#challengeOwnStation").innerHTML = station ? `<span>Euer Reich: ${team?.marker || ""} ${escapeHtml(team?.name || "")}</span><h3>${station.icon} ${escapeHtml(station.name)}</h3><p>${escapeHtml(station.instruction)}</p>` : "";
  updateTimer();
  const publicRound = game.publicRounds?.[`round-${round}`] || latestPublishedRound(game);
  $("#challengePublishedRound").classList.toggle("hidden", !publicRound || game.phase !== "published");
  if (publicRound && game.phase === "published") $("#challengePublishedRound").innerHTML = `<p class="eyebrow">Runde ${publicRound.round} veröffentlicht</p><div>${TEAMS.map(team => { const result = publicRound.teams?.[team.id]; return `<span style="--team:${team.color}"><b>${team.marker} ${team.name}</b><em>${result?.stationId === "estimate" ? "Schätzungen abgegeben" : `${formatNumber(result?.value)} ${escapeHtml(result?.unit || "")}`}</em></span>`; }).join("")}</div>`;
  $("#challengeEstimateReveal").classList.toggle("hidden", !game.estimateRevealed);
  if (game.estimateRevealed) $("#challengeEstimateReveal").innerHTML = `<p class="eyebrow">Schätz-Challenge aufgelöst</p>${Object.values(game.publicEstimate?.questions || {}).map(question => `<article><strong>${escapeHtml(question.text)}</strong><span>Richtig: ${formatNumber(question.correctValue)} ${escapeHtml(question.unit || "")}</span><small>${TEAMS.map(team => `${team.marker} ${formatNumber(question.estimates?.[team.id])}`).join(" · ")}</small></article>`).join("")}`;
}

function updateTimer() {
  if (!game || game.status !== "running") return;
  const remaining = challengeTimerRemaining(game.timer), seconds = Math.ceil(remaining / 1000);
  $("#challengePublicTimer").textContent = remaining <= 0 && game.timer?.status === "running" ? "WECHSEL" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function latestPublishedRound(value) {
  return Object.values(value.publicRounds || {}).sort((a, b) => Number(b.round) - Number(a.round))[0] || null;
}

function formatNumber(value) { return Number(value || 0).toLocaleString("de-CH", { maximumFractionDigits: 2 }); }
function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = String(value); return div.innerHTML; }
