import { TEAMS } from "./data.js?v=beer-pong-2";
import { getPlayerProfile } from "./player.js";
import { getStore } from "./store.js?v=beer-pong-2";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let currentState = null;

store.subscribe(state => { currentState = state; renderOracle(state); });
window.addEventListener("regnum-player-changed", () => currentState && renderOracle(currentState));
setInterval(() => currentState && renderOracle(currentState), 1000);
$("#oracleAnswerForm").addEventListener("submit", submitAnswer);

function renderOracle(state) {
  const oracle = state.settings.oracle || {};
  const active = oracle.active;
  const running = active && oracle.endsAt > Date.now();
  const visible = active || oracle.revealed;
  $("#oracleCard").classList.toggle("hidden", !visible);
  if (!visible) return;

  $("#oracleQuestion").classList.toggle("hidden", !running);
  $("#oracleWaiting").classList.toggle("hidden", !active || running);
  $("#oracleReveal").classList.toggle("hidden", !oracle.revealed);

  if (running) {
    const remaining = Math.max(0, oracle.endsAt - Date.now());
    $("#oracleTimer").textContent = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;
    $("#oracleQuestionText").textContent = oracle.question;
    $("#oracleUnit").textContent = oracle.unit || "";
    $("#oraclePointsHint").textContent = `Bis zu ${oracle.maxPoints || 5} Punkte.`;
    const profile = getPlayerProfile();
    const answer = state.oracleAnswers?.[oracle.roundId]?.[profile?.teamId];
    $("#oracleAnswerForm").classList.toggle("hidden", !!answer);
    $("#oracleSealed").classList.toggle("hidden", !answer);
    if (answer) $("#oracleOwnAnswer").textContent = `${answer.value}${oracle.unit ? ` ${oracle.unit}` : ""}`;
  } else if (active) $("#oracleTimer").textContent = "Abgelaufen";

  if (oracle.revealed) {
    $("#oracleTimer").textContent = "Aufgelöst";
    $("#oracleSolution").textContent = `${oracle.answer}${oracle.unit ? ` ${oracle.unit}` : ""}`;
    $("#oracleResults").innerHTML = TEAMS.map(team => {
      const result = oracle.results?.[team.id];
      return `<div style="--team:${team.color}"><img src="${team.logo}" alt=""><span><b>${team.name}</b><small>${result ? `${result.value}${oracle.unit ? ` ${oracle.unit}` : ""}` : "Keine Antwort"}</small></span><strong>${result ? `+${result.points}` : "0"}</strong></div>`;
    }).join("");
  }
}

async function submitAnswer(event) {
  event.preventDefault();
  const profile = getPlayerProfile();
  const oracle = currentState.settings.oracle;
  const value = Number($("#oracleAnswer").value.replace?.(",", ".") ?? $("#oracleAnswer").value);
  if (!profile || !Number.isFinite(value) || !oracle.active || oracle.endsAt <= Date.now()) return;
  const result = await store.submitOracleAnswer(oracle.roundId, profile, value);
  if (!result.accepted) {
    $("#oracleOwnAnswer").textContent = `${result.answer}${oracle.unit ? ` ${oracle.unit}` : ""}`;
    $("#oracleAnswerForm").classList.add("hidden");
    $("#oracleSealed").classList.remove("hidden");
  }
}
