import { TEAMS, NOVITIUS_GAME, scoreNovitiusAnswer } from "./data.js?v=beer-pong-1";
import { getStore } from "./store.js?v=beer-pong-1";
import { getPlayerProfile } from "./player.js";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let currentState = null;
let playerState = { participantId: null, participant: null, answers: {} };
let playerUnsubscribe = null;
let subscriptionToken = 0;

store.subscribe(state => { currentState = state; render(); });
subscribePlayer();
window.addEventListener("regnum-player-changed", subscribePlayer);

$("#joinNovitius").addEventListener("click", async () => {
  const profile = getPlayerProfile();
  if (!profile) return;
  const button = $("#joinNovitius");
  button.disabled = true;
  $("#novitiusMessage").textContent = "";
  try { await store.claimNovitiusParticipant(profile); }
  catch (error) { $("#novitiusMessage").textContent = error.message === "novitius-registration-closed" ? "Die Anmeldung wurde inzwischen geschlossen." : `Anmeldung fehlgeschlagen: ${error.message}`; }
  finally { button.disabled = false; }
});

$("#novitiusAnswerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const game = currentState?.games?.[NOVITIUS_GAME.id], profile = getPlayerProfile();
  const key = `question-${game?.currentQuestion || 0}`;
  if (!profile || !playerState.participant || !game?.answersOpen || playerState.answers?.[key]) return;
  const input = $("#novitiusAnswer");
  const value = game.currentQuestionData?.type === "time" ? input.value : Number(input.value);
  if (value === "" || (game.currentQuestionData?.type !== "time" && (!Number.isFinite(value) || !Number.isInteger(value)))) {
    $("#novitiusMessage").textContent = "Bitte eine gültige ganze Zahl eingeben.";
    return;
  }
  const button = $("#saveNovitiusAnswer");
  button.disabled = true;
  $("#novitiusMessage").textContent = "";
  try { await store.submitNovitiusAnswer(game.currentQuestion, profile, value); input.value = ""; }
  catch (error) {
    const messages = { "novitius-answers-closed": "Die Antworten wurden inzwischen geschlossen.", "novitius-not-registered": "Du bist für dieses Quiz nicht angemeldet.", "novitius-answer-exists": "Deine Antwort wurde bereits gespeichert und ist endgültig." };
    $("#novitiusMessage").textContent = messages[error.message] || `Speichern fehlgeschlagen: ${error.message}`;
  } finally { button.disabled = false; }
});

async function subscribePlayer() {
  playerUnsubscribe?.();
  playerState = { participantId: null, participant: null, answers: {} };
  const token = ++subscriptionToken;
  const stop = await store.subscribeNovitiusPlayer(value => { if (token === subscriptionToken) { playerState = value || playerState; render(); } });
  if (token !== subscriptionToken) stop?.(); else playerUnsubscribe = stop;
}

function render() {
  const game = currentState?.games?.[NOVITIUS_GAME.id];
  const visible = game?.status === "running";
  $("#novitiusCard").classList.toggle("hidden", !visible);
  if (!visible) return;

  const number = Number(game.currentQuestion || 0), key = `question-${number}`, question = game.currentQuestionData;
  const ownAnswer = playerState.answers?.[key], reveal = game.publicReveals?.[key], registered = !!playerState.participant;
  const questionState = game.questionStates?.[key] || "locked", registrationPhase = number === 0;

  $("#novitiusRegistration").classList.toggle("hidden", !registrationPhase || !game.registrationOpen || registered);
  $("#novitiusRegistered").classList.toggle("hidden", !registrationPhase || !registered);
  $("#novitiusSpectator").classList.toggle("hidden", registrationPhase ? !!game.registrationOpen || registered : registered);
  $("#novitiusQuestionView").classList.toggle("hidden", !number || !question || questionState === "locked");
  $("#novitiusReveal").classList.toggle("hidden", !reveal);
  $("#novitiusPublicStatus").textContent = registrationPhase ? (game.registrationOpen ? "Anmeldung offen" : "Warte auf Frage 1") : questionState === "revealed" ? "Aufgelöst" : questionState === "open" ? "Frage offen" : "Antworten geschlossen";
  if (!number || !question) return;

  $("#novitiusQuestionBadge").textContent = `Frage ${number} von ${NOVITIUS_GAME.questionCount}`;
  $("#novitiusQuestionText").textContent = question.text;
  const canAnswer = registered && questionState === "open" && !ownAnswer;
  $("#novitiusAnswerForm").classList.toggle("hidden", !canAnswer);
  $("#novitiusSaved").classList.toggle("hidden", !ownAnswer || !!reveal);
  $("#novitiusClosed").classList.toggle("hidden", !!reveal || questionState !== "closed" || !!ownAnswer);
  $("#novitiusSpectator").classList.toggle("hidden", registered);
  if (ownAnswer) $("#novitiusSavedValue").textContent = `${formatValue(ownAnswer.value, question.unit)} · endgültig gespeichert`;

  const input = $("#novitiusAnswer");
  input.type = question.type === "time" ? "time" : "number";
  input.step = question.type === "time" ? "60" : "1";
  input.min = question.type === "time" ? "" : "0";
  input.inputMode = question.type === "time" ? "numeric" : "numeric";
  $("#novitiusUnit").textContent = question.unit || "";
  if (reveal) renderReveal(reveal, ownAnswer);
}

function renderReveal(reveal, ownAnswer) {
  $("#novitiusSolution").textContent = `Richtige Antwort: ${formatValue(reveal.correctValue, reveal.unit)}`;
  const ownScore = ownAnswer ? scoreNovitiusAnswer(reveal, ownAnswer.value) : { points: 0 };
  $("#novitiusOwnResult").classList.remove("hidden");
  $("#novitiusOwnResult").innerHTML = `<span>Deine Antwort</span><strong>${ownAnswer ? escapeHtml(formatValue(ownAnswer.value, reveal.unit)) : "Keine Antwort"}</strong><b>+${ownScore.points} Punkte</b>`;
  const team = TEAMS.find(entry => entry.id === playerState.participant?.teamId);
  const roundScore = Number(reveal.teamRoundScores?.[team?.id] || 0);
  $("#novitiusTeamRound").innerHTML = team ? `<span>Dein Reich</span><strong>${team.marker} ${team.name} – ${roundScore.toFixed(2)} / 3.00</strong>` : "";
  $("#novitiusGameRanking").innerHTML = (reveal.ranking || []).map((teamId, index) => {
    const item = TEAMS.find(entry => entry.id === teamId), total = Number(reveal.teamTotals?.[teamId] || 0);
    return `<li style="--team:${item?.color || "#888"}"><span>${index + 1}.</span><div><strong>${item?.marker || ""} ${escapeHtml(item?.name || teamId)}</strong></div><em>${total.toFixed(2)}</em></li>`;
  }).join("");
}

function formatValue(value, unit = "") {
  const formatted = typeof value === "number" ? new Intl.NumberFormat("de-CH", { maximumFractionDigits: 2 }).format(value) : String(value);
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = String(value); return div.innerHTML; }
