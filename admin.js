import { TEAMS, sortedGames, formatTime, BALLON_GAME, GAME_STATUSES, buildBallonGame, hasGameResult } from "./data.js?v=ballon-1";
import { getStore } from "./store.js?v=ballon-1";
import { HUNT_DURATION_MINUTES } from "./hunt-data.js";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let currentState = null, editingId = null, oracleQuestions = {}, oracleQuestionsUnsubscribe = null;
const ADMIN_PASS_HASH = "a80ff0faa95c643a50fbb4252140f964cf050b07a179843c9baa7a2783559da4";
let ballonDirty = false, ballonSignature = null;

$("#ballonRankInputs").innerHTML = TEAMS.map((_, index) => `<label><span>Platz ${index + 1} <small>+${5 - index} Punkte</small></span><select id="ballon-rank-${index}" required><option value="">Reich wählen …</option>${TEAMS.map(team => `<option value="${team.id}">${team.name}</option>`).join("")}</select></label>`).join("");
$("#ballonForm").addEventListener("change", () => { ballonDirty = true; updateBallonForm(); });
$("#startBallon").addEventListener("click", () => saveBallonStatus("running"));
$("#resetBallon").addEventListener("click", () => {
  if (currentState.games[BALLON_GAME.id]?.status === "completed" && !confirm("Ballon Game zurücksetzen? Die Rangfolge und Punkte dieses Spiels werden entfernt.")) return;
  saveBallonStatus("not-started");
});
$("#enterBallonResult").addEventListener("click", () => openBallonResult());
$("#cancelBallonEdit").addEventListener("click", () => { ballonDirty = false; renderBallonAdmin(currentState, true); });
$("#ballonForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("#saveBallon");
  button.disabled = true;
  $("#ballonSaveMessage").textContent = "";
  try {
    const ranking = TEAMS.map((_, index) => $(`#ballon-rank-${index}`).value);
    const game = buildBallonGame($("#ballonStatus").value, ranking, currentState.games[BALLON_GAME.id]);
    await store.saveGame(game, BALLON_GAME.id);
    ballonDirty = false;
    renderBallonAdmin({ games: { ...currentState.games, [BALLON_GAME.id]: game } }, true);
    toast(game.status === "completed" ? "Ballon Game ausgewertet · Punkte aktualisiert" : "Spielstatus gespeichert");
  } catch (error) { $("#ballonSaveMessage").textContent = error.message; }
  finally { button.disabled = false; }
});

$("#scoreInputs").innerHTML = TEAMS.map(team => `<label class="score-field" style="--team:${team.color}"><span><i></i>${team.name}</span><input id="score-${team.id}" type="number" inputmode="numeric" value="0" step="1" required></label>`).join("");
if (store.demo) setAccess(sessionStorage.getItem("regnum-admin-unlocked") === "true");
else {
  $("#firebaseEmailField").classList.remove("hidden");
  $("#email").required = true;
  store.auth.observe(user => setAccess(!!user));
}
store.subscribe(state => { currentState = state; renderAdmin(state); });

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#loginError").textContent = "";
  try {
    if (store.demo) {
      if (await sha256($("#password").value) !== ADMIN_PASS_HASH) throw new Error("wrong-password");
      sessionStorage.setItem("regnum-admin-unlocked", "true");
      setAccess(true);
      $("#password").value = "";
    } else await store.auth.login($("#email").value, $("#password").value);
  } catch (error) {
    $("#loginError").textContent = error.message === "wrong-password" ? "Passwort ist falsch." : humanAuthError(error.code);
  }
});
$("#logoutBtn").addEventListener("click", async () => {
  if (store.demo) {
    sessionStorage.removeItem("regnum-admin-unlocked");
    setAccess(false);
  } else await store.auth.logout();
});

document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", async () => { await store.setMode(button.dataset.mode); toast(`Modus auf „${button.textContent}“ gesetzt`); }));
$("#startTeamHunt").addEventListener("click", async () => {
  if (!confirm("Nachtjagd jetzt für alle Reiche starten? Die Zeit läuft sofort.")) return;
  await store.startHunt(HUNT_DURATION_MINUTES);
  toast("Nachtjagd gestartet");
});
$("#stopTeamHunt").addEventListener("click", async () => {
  if (!confirm("Nachtjagd wirklich vorzeitig beenden?")) return;
  await store.stopHunt();
  toast("Nachtjagd beendet");
});
$("#oracleAdminForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("#oracleQuestionId").value || null;
  await store.saveOracleQuestion({ question: $("#oracleAdminQuestion").value.trim(), answer: Number($("#oracleAdminAnswer").value), unit: $("#oracleAdminUnit").value.trim(), minutes: Number($("#oracleAdminMinutes").value), maxPoints: Number($("#oracleAdminPoints").value) }, id);
  resetOracleEditor();
  toast(id ? "Frage aktualisiert" : "Frage vorbereitet");
});
$("#cancelOracleEdit").addEventListener("click", resetOracleEditor);
$("#oracleQuestionList").addEventListener("click", async event => {
  const button = event.target.closest("button[data-oracle-action]"); if (!button) return;
  const question = oracleQuestions[button.dataset.id]; if (!question) return;
  if (button.dataset.oracleAction === "start") {
    if (!confirm(`Orakel „${question.question}“ jetzt starten? Die Zeit läuft sofort.`)) return;
    await store.startOracle(question); toast("Orakel gestartet");
  }
  if (button.dataset.oracleAction === "edit") loadOracleEditor(button.dataset.id, question);
  if (button.dataset.oracleAction === "delete" && confirm("Diese vorbereitete Frage wirklich löschen?")) { await store.deleteOracleQuestion(button.dataset.id); toast("Frage gelöscht"); }
});
$("#finishOracle").addEventListener("click", async () => {
  if (!confirm("Orakel beenden und Punkte nach Nähe verteilen?")) return;
  await store.finishOracle(currentState);
  toast("Orakel ausgewertet");
});
$("#hideOracle").addEventListener("click", async () => { await store.hideOracle(); toast("Orakel ausgeblendet"); });

$("#resultForm").addEventListener("submit", async event => {
  event.preventDefault();
  const existing = editingId ? currentState.games[editingId] : null;
  const game = { name: $("#gameName").value.trim(), round: $("#roundName").value.trim(), resultText: $("#resultText").value.trim(), points: Object.fromEntries(TEAMS.map(team => [team.id, Number($(`#score-${team.id}`).value) || 0])), createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() };
  try { await store.saveGame(game, editingId); toast(editingId ? "Resultat korrigiert" : "Resultat gespeichert"); resetForm(); } catch (error) { $("#saveMessage").textContent = `Fehler: ${error.message}`; }
});
$("#cancelEdit").addEventListener("click", resetForm);

$("#adminResults").addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const { action, id } = button.dataset;
  if (action === "edit") loadEdit(id);
  if (action === "delete" && confirm("Dieses Resultat wirklich löschen? Die Rangliste wird sofort neu berechnet.")) { await store.deleteGame(id); toast("Resultat gelöscht"); if (editingId === id) resetForm(); }
});

function renderAdmin(state) {
  renderBallonAdmin(state);
  const mode = state.settings.mode || "live";
  document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  $("#modeHelp").textContent = { live: "Rangliste und Resultate sind für alle sichtbar.", frozen: "Publikum sieht keine Punkte – Admin bleibt bedienbar.", final: "Die Siegeransicht wird öffentlich angezeigt." }[mode];
  const hunt = state.settings.hunt || {};
  const huntRunning = hunt.active && hunt.endsAt > Date.now();
  $("#startTeamHunt").classList.toggle("hidden", huntRunning);
  $("#stopTeamHunt").classList.toggle("hidden", !huntRunning);
  $("#huntAdminStatus").textContent = huntRunning ? `Aktiv bis ${formatTime(hunt.endsAt)} · Runde ${hunt.roundId}` : "Nicht aktiv. Beim Start beginnt der Countdown sofort.";
  const oracle = state.settings.oracle || {};
  const oracleBusy = oracle.active || oracle.revealed;
  $("#oracleAdminForm").classList.toggle("hidden", oracleBusy);
  $("#oracleQuestionList").classList.toggle("hidden", oracleBusy);
  $("#oracleQuestionsEmpty").classList.toggle("hidden", oracleBusy || Object.keys(oracleQuestions).length > 0);
  $("#oracleAdminRunning").classList.toggle("hidden", !oracle.active);
  $("#oracleAdminRevealed").classList.toggle("hidden", !oracle.revealed);
  if (oracle.active) {
    const answerCount = Object.keys(state.oracleAnswers?.[oracle.roundId] || {}).length;
    $("#oracleAdminStatus").textContent = `${answerCount} von 5 Reichen haben geantwortet · Ende ${formatTime(oracle.endsAt)}`;
  }
  const games = sortedGames(state.games).filter(hasGameResult);
  $("#adminResults").innerHTML = games.map(game => `<article class="admin-result"><div><span>${formatTime(game.createdAt, true)}</span><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml(game.round || game.resultText || "")}</small></div><div class="admin-actions"><button data-action="edit" data-id="${game.id}">Bearbeiten</button><button class="danger" data-action="delete" data-id="${game.id}">Löschen</button></div></article>`).join("");
  $("#adminEmpty").classList.toggle("hidden", games.length > 0);
}

function renderBallonAdmin(state, force = false) {
  const game = state?.games?.[BALLON_GAME.id];
  const status = game?.status || "not-started";
  const signature = JSON.stringify(game || null);
  $("#ballonAdminStatus").textContent = GAME_STATUSES[status];
  $("#startBallon").classList.toggle("hidden", status !== "not-started");
  $("#resetBallon").classList.toggle("hidden", status === "not-started");
  $("#enterBallonResult").textContent = status === "completed" ? "Resultat korrigieren" : "Resultat eintragen";
  if (!force && (ballonDirty || signature === ballonSignature)) return;
  ballonSignature = signature;
  $("#ballonStatus").value = "completed";
  $("#ballonForm").classList.add("hidden");
  TEAMS.forEach((_, index) => { $(`#ballon-rank-${index}`).value = game?.ranking?.[index] || ""; });
  $("#ballonSaveMessage").textContent = "";
  updateBallonForm();
}

function openBallonResult() {
  $("#ballonForm").classList.remove("hidden");
  ballonDirty = true;
  updateBallonForm();
  $("#ballon-rank-0").focus();
}

async function saveBallonStatus(status) {
  const controls = [$("#startBallon"), $("#resetBallon"), $("#enterBallonResult")];
  controls.forEach(button => { button.disabled = true; });
  try {
    const game = buildBallonGame(status, [], currentState.games[BALLON_GAME.id]);
    await store.saveGame(game, BALLON_GAME.id);
    ballonDirty = false;
    renderBallonAdmin({ games: { ...currentState.games, [BALLON_GAME.id]: game } }, true);
    toast(status === "running" ? "Ballon Game läuft" : "Ballon Game zurückgesetzt");
  } catch (error) { toast(`Speichern fehlgeschlagen: ${error.message}`); }
  finally { controls.forEach(button => { button.disabled = false; }); }
}

function updateBallonForm() {
  const completed = $("#ballonStatus").value === "completed";
  $("#ballonPlacements").disabled = !completed;
  $("#saveBallon").textContent = completed ? "Resultat speichern · Punkte vergeben" : "Status speichern";
  const chosen = TEAMS.map((_, index) => $(`#ballon-rank-${index}`).value).filter(Boolean);
  const duplicate = new Set(chosen).size !== chosen.length;
  $("#ballonSaveMessage").textContent = completed && duplicate ? "Jedes Reich darf nur einmal vorkommen." : "";
  TEAMS.forEach((_, index) => $(`#ballon-rank-${index}`).setCustomValidity(completed && duplicate ? "Jedes Reich darf nur einmal vorkommen." : ""));
}

function renderOracleQuestions() {
  const entries = Object.entries(oracleQuestions).sort(([, a], [, b]) => (a.updatedAt || 0) - (b.updatedAt || 0));
  $("#oracleQuestionCount").textContent = `${entries.length} / 10 Fragen`;
  $("#oracleQuestionList").innerHTML = entries.map(([id, item], index) => `<article class="oracle-question-item"><div class="oracle-question-number">${index + 1}</div><div><strong>${escapeHtml(item.question)}</strong><small>Lösung: ${item.answer}${item.unit ? ` ${escapeHtml(item.unit)}` : ""} · ${item.minutes || 3} Min. · max. ${item.maxPoints || 5} Punkte</small></div><div class="admin-actions"><button data-oracle-action="start" data-id="${id}">Start</button><button data-oracle-action="edit" data-id="${id}">Bearbeiten</button><button class="danger" data-oracle-action="delete" data-id="${id}">Löschen</button></div></article>`).join("");
  const busy = currentState?.settings?.oracle?.active || currentState?.settings?.oracle?.revealed;
  $("#oracleQuestionsEmpty").classList.toggle("hidden", busy || entries.length > 0);
}

function loadOracleEditor(id, question) { $("#oracleQuestionId").value = id; $("#oracleAdminQuestion").value = question.question || ""; $("#oracleAdminAnswer").value = question.answer; $("#oracleAdminUnit").value = question.unit || ""; $("#oracleAdminMinutes").value = question.minutes || 3; $("#oracleAdminPoints").value = question.maxPoints || 5; $("#saveOracleQuestion").textContent = "Änderungen speichern"; $("#cancelOracleEdit").classList.remove("hidden"); $("#oracleAdminForm").scrollIntoView({ behavior: "smooth", block: "start" }); }
function resetOracleEditor() { $("#oracleAdminForm").reset(); $("#oracleQuestionId").value = ""; $("#oracleAdminMinutes").value = 3; $("#oracleAdminPoints").value = 5; $("#saveOracleQuestion").textContent = "Frage speichern"; $("#cancelOracleEdit").classList.add("hidden"); }

function loadEdit(id) { if (id === BALLON_GAME.id) { ballonDirty = false; renderBallonAdmin(currentState, true); openBallonResult(); $("#ballonAdminPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; } const game = currentState.games[id]; if (!game) return; editingId = id; $("#formTitle").textContent = "Resultat korrigieren"; $("#cancelEdit").classList.remove("hidden"); $("#gameName").value = game.name || ""; $("#roundName").value = game.round || ""; $("#resultText").value = game.resultText || ""; TEAMS.forEach(team => $(`#score-${team.id}`).value = Number(game.points?.[team.id] || 0)); $("#resultForm").scrollIntoView({ behavior: "smooth", block: "start" }); }
function resetForm() { editingId = null; $("#resultForm").reset(); TEAMS.forEach(team => $(`#score-${team.id}`).value = 0); $("#formTitle").textContent = "Spielresultat erfassen"; $("#cancelEdit").classList.add("hidden"); $("#saveMessage").textContent = ""; }
function toast(message) { $("#toast").textContent = message; $("#toast").classList.add("show"); setTimeout(() => $("#toast").classList.remove("show"), 2200); }
function setAccess(granted) {
  $("#loginPanel").classList.toggle("hidden", granted); $("#adminContent").classList.toggle("hidden", !granted); $("#logoutBtn").classList.toggle("hidden", !granted);
  if (granted && !oracleQuestionsUnsubscribe) oracleQuestionsUnsubscribe = store.subscribeOracleQuestions(questions => { oracleQuestions = questions; renderOracleQuestions(); });
  if (!granted && oracleQuestionsUnsubscribe) { oracleQuestionsUnsubscribe(); oracleQuestionsUnsubscribe = null; oracleQuestions = {}; }
}
async function sha256(value) { const bytes = new TextEncoder().encode(value); const hash = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
function humanAuthError(code) { return ({ "auth/invalid-credential": "E-Mail oder Passwort ist falsch.", "auth/too-many-requests": "Zu viele Versuche. Bitte kurz warten.", "auth/network-request-failed": "Keine Verbindung. Bitte Internet prüfen." })[code] || "Login fehlgeschlagen."; }
function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }
