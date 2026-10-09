import { TEAMS, NOVITIUS_GAME } from "./data.js?v=hunt-3";
import { getStore } from "./store.js?v=hunt-3";
import { getPlayerProfile } from "./player.js";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let currentState = null;
let playerState = { participantId: null, participant: null, answers: {} };
let playerUnsubscribe = null;
let subscriptionToken = 0;
let draftKey = null;
let draftDirty = false;

store.subscribe(state => {
  currentState = state;
  render();
});
subscribePlayer();
window.addEventListener("regnum-player-changed", () => {
  draftDirty = false;
  subscribePlayer();
});

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

$("#novitiusAnswer").addEventListener("input", () => { draftDirty = true; });
$("#novitiusAnswerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const game = currentState?.games?.[NOVITIUS_GAME.id];
  const profile = getPlayerProfile();
  if (!profile || !playerState.participant || !game?.answersOpen) return;
  const input = $("#novitiusAnswer");
  const value = game.currentQuestionData?.type === "time" ? input.value : Number(input.value);
  if (value === "" || (game.currentQuestionData?.type !== "time" && !Number.isFinite(value))) return;
  const button = $("#saveNovitiusAnswer");
  button.disabled = true;
  $("#novitiusMessage").textContent = "";
  try {
    await store.submitNovitiusAnswer(game.currentQuestion, profile, value);
    draftDirty = false;
  } catch (error) {
    $("#novitiusMessage").textContent = error.message === "novitius-answers-closed" ? "Die Antworten wurden inzwischen geschlossen." : error.message === "novitius-not-registered" ? "Du bist für dieses Quiz nicht angemeldet." : `Speichern fehlgeschlagen: ${error.message}`;
  } finally { button.disabled = false; }
});

async function subscribePlayer() {
  playerUnsubscribe?.();
  playerUnsubscribe = null;
  playerState = { participantId: null, participant: null, answers: {} };
  const token = ++subscriptionToken;
  const stop = await store.subscribeNovitiusPlayer(value => {
    if (token !== subscriptionToken) return;
    playerState = value || playerState;
    if (!draftDirty) render();
  });
  if (token !== subscriptionToken) stop?.();
  else playerUnsubscribe = stop;
}

function render() {
  const game = currentState?.games?.[NOVITIUS_GAME.id];
  const running = game?.status === "running";
  $("#novitiusCard").classList.toggle("hidden", !running);
  if (!running) return;

  const number = Number(game.currentQuestion || 0);
  const key = `question-${number}`;
  const question = game.currentQuestionData;
  const ownAnswer = playerState.answers?.[key];
  const reveal = game.publicReveals?.[key];
  const registered = !!playerState.participant;
  const registrationPhase = number === 0;

  $("#novitiusRegistration").classList.toggle("hidden", !registrationPhase || !game.registrationOpen || registered);
  $("#novitiusRegistered").classList.toggle("hidden", !registrationPhase || !registered);
  $("#novitiusSpectator").classList.toggle("hidden", registrationPhase ? !!game.registrationOpen || registered : registered);
  $("#novitiusQuestionView").classList.toggle("hidden", !number || !question);
  $("#novitiusReveal").classList.toggle("hidden", !reveal);
  $("#novitiusPublicStatus").textContent = registrationPhase ? (game.registrationOpen ? "Anmeldung offen" : "Anmeldung geschlossen") : reveal ? "Aufgelöst" : game.answersOpen ? "Antworten offen" : "Antworten geschlossen";

  if (!number || !question) return;
  $("#novitiusQuestionBadge").textContent = `Frage ${number} von ${NOVITIUS_GAME.questionCount}`;
  $("#novitiusQuestionText").textContent = question.text;
  const canAnswer = registered && game.answersOpen && !reveal;
  $("#novitiusAnswerForm").classList.toggle("hidden", !canAnswer);
  $("#novitiusSaved").classList.toggle("hidden", !ownAnswer || !canAnswer);
  $("#novitiusClosed").classList.toggle("hidden", !!reveal || !!game.answersOpen);
  $("#novitiusSpectator").classList.toggle("hidden", registered);

  const input = $("#novitiusAnswer");
  input.type = question.type === "time" ? "time" : "number";
  input.step = question.type === "time" ? "60" : "any";
  input.inputMode = question.type === "time" ? "numeric" : "decimal";
  $("#novitiusUnit").textContent = question.unit || "";
  if (draftKey !== key || !draftDirty) {
    draftKey = key;
    input.value = ownAnswer?.value ?? "";
  }
  $("#saveNovitiusAnswer").textContent = ownAnswer ? "Antwort aktualisieren" : "Antwort speichern";

  if (reveal) renderReveal(reveal);
}

function renderReveal(reveal) {
  $("#novitiusSolution").textContent = `Simons Antwort: ${formatValue(reveal.correctValue, reveal.unit)}`;
  const own = reveal.scores?.[playerState.participantId];
  $("#novitiusOwnResult").classList.toggle("hidden", !own);
  if (own) $("#novitiusOwnResult").innerHTML = `<span>Deine Antwort</span><strong>${own.value === null ? "Keine Antwort" : escapeHtml(formatValue(own.value, reveal.unit))}</strong><b>${Number(own.points || 0)} / 5 Punkte</b>`;
  $("#novitiusTopTen").innerHTML = (reveal.topTen || []).map(item => {
    const team = TEAMS.find(entry => entry.id === item.teamId);
    return `<li style="--team:${team?.color || "#888"}"><span>${item.place}.</span><div><strong>${escapeHtml(item.playerName)}</strong><small>${team?.marker || ""} ${escapeHtml(team?.name || item.teamId)}</small></div><b>${escapeHtml(formatValue(item.value, reveal.unit))}</b><em>${Number(item.points || 0)} P</em></li>`;
  }).join("") || '<li class="novitius-empty">Noch keine Antworten.</li>';
}

function formatValue(value, unit = "") {
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}
