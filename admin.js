import { TEAMS, sortedGames, formatTime, BALLON_GAME, SONG_BATTLE, GAME_STATUSES, buildBallonGame, hasGameResult, songBattleScores, songBattleTieGroups, suggestedSongBattleRanking } from "./data.js?v=song-1";
import { getStore } from "./store.js?v=song-1";
import { HUNT_DURATION_MINUTES } from "./hunt-data.js";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let currentState = null, editingId = null, oracleQuestions = {}, oracleQuestionsUnsubscribe = null;
let songAnswers = {}, songAdmin = { evaluations: {}, internalPoints: {} }, songAnswersUnsubscribe = null, songAdminUnsubscribe = null;
let songReviewNumber = 1, songRankingDirty = false, songRankingSignature = null;
const ADMIN_PASS_HASH = "a80ff0faa95c643a50fbb4252140f964cf050b07a179843c9baa7a2783559da4";
let ballonDirty = false, ballonSignature = null;

$("#ballonRankInputs").innerHTML = TEAMS.map((_, index) => `<label><span>Platz ${index + 1} <small>+${5 - index} Punkte</small></span><select id="ballon-rank-${index}" required><option value="">Reich wählen …</option>${TEAMS.map(team => `<option value="${team.id}">${team.name} ${team.marker}</option>`).join("")}</select></label>`).join("");
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

$("#songRoundSelect").innerHTML = Array.from({ length: SONG_BATTLE.songCount }, (_, index) => `<option value="${index + 1}">Song ${index + 1} von ${SONG_BATTLE.songCount}</option>`).join("");
$("#startSongBattle").addEventListener("click", async () => {
  if (!confirm("Song Battle jetzt mit Song 1 starten und Antworten öffnen?")) return;
  await withDisabled($("#startSongBattle"), async () => { await store.startSongBattle(); toast("Song Battle läuft · Song 1 ist offen"); });
});
$("#resetSongBattle").addEventListener("click", async () => {
  if (!confirm("Song Battle vollständig zurücksetzen? Antworten, Bewertungen und Gesamtpunkte dieses Spiels werden entfernt.")) return;
  await withDisabled($("#resetSongBattle"), async () => { await store.resetSongBattle(); songReviewNumber = 1; toast("Song Battle zurückgesetzt"); });
});
$("#activateSongRound").addEventListener("click", () => activateSongRound(Number($("#songRoundSelect").value)));
$("#nextSongRound").addEventListener("click", () => {
  const current = Number(currentState?.games?.[SONG_BATTLE.id]?.currentSong || 1);
  if (current >= SONG_BATTLE.songCount) return;
  activateSongRound(current + 1);
});
$("#songRoundSelect").addEventListener("change", event => {
  songReviewNumber = Number(event.target.value);
  if (currentState?.games?.[SONG_BATTLE.id]?.status === "completed") renderSongBattleAdmin(currentState);
});
$("#openSongAnswers").addEventListener("click", async () => { await store.setSongBattleAnswersOpen(true); toast(`Song ${currentState.games[SONG_BATTLE.id].currentSong}: Antworten offen`); });
$("#closeSongAnswers").addEventListener("click", async () => { await store.setSongBattleAnswersOpen(false); toast(`Song ${currentState.games[SONG_BATTLE.id].currentSong}: Antworten gesperrt`); });
$("#songTeamAnswers").addEventListener("click", async event => {
  const button = event.target.closest("button[data-song-eval]");
  if (!button) return;
  button.disabled = true;
  try {
    await store.saveSongBattleEvaluation(songReviewNumber, button.dataset.team, button.dataset.songEval, button.dataset.value === "true");
  } catch (error) { toast(`Bewertung fehlgeschlagen: ${error.message}`); }
  finally { button.disabled = false; }
});
$("#songFinalRanking").addEventListener("change", () => { songRankingDirty = true; validateSongFinalRanking(); });
$("#finishSongBattle").addEventListener("click", async () => {
  const button = $("#finishSongBattle");
  $("#songFinishMessage").textContent = "";
  try {
    const ranking = TEAMS.map((_, index) => $(`#song-final-${index}`).value);
    if (!validateSongFinalRanking(true)) return;
    button.disabled = true;
    await store.finishSongBattle(ranking);
    songRankingDirty = false;
    toast("Song Battle abgeschlossen · Gesamtpunkte aktualisiert");
  } catch (error) { $("#songFinishMessage").textContent = error.message; }
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
  renderSongBattleAdmin(state);
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

async function activateSongRound(songNumber) {
  const game = currentState?.games?.[SONG_BATTLE.id];
  if (game?.status !== "running") return;
  const wording = songNumber === Number(game.currentSong) ? `Song ${songNumber} erneut öffnen?` : `Song ${songNumber} starten und Antworten öffnen?`;
  if (!confirm(wording)) return;
  await store.setSongBattleRound(songNumber);
  songReviewNumber = songNumber;
  toast(`Song ${songNumber} läuft · Antworten offen`);
}

function renderSongBattleAdmin(state) {
  const game = state?.games?.[SONG_BATTLE.id];
  const status = game?.status || "not-started";
  const running = status === "running";
  const completed = status === "completed";
  if (running) songReviewNumber = Number(game.currentSong) || 1;
  songReviewNumber = Math.min(SONG_BATTLE.songCount, Math.max(1, songReviewNumber));

  $("#songBattleAdminStatus").textContent = GAME_STATUSES[status] || GAME_STATUSES["not-started"];
  $("#startSongBattle").classList.toggle("hidden", status !== "not-started");
  $("#resetSongBattle").classList.toggle("hidden", status === "not-started");
  $("#songBattleControls").classList.toggle("hidden", status === "not-started");
  if (status === "not-started") return;

  $("#songRoundSelect").value = String(songReviewNumber);
  $("#activateSongRound").classList.toggle("hidden", !running);
  $("#nextSongRound").classList.toggle("hidden", !running || Number(game.currentSong) >= SONG_BATTLE.songCount);
  $("#songAnswerControls").classList.toggle("hidden", !running);
  $("#openSongAnswers").classList.toggle("hidden", !running || game.answersOpen);
  $("#closeSongAnswers").classList.toggle("hidden", !running || !game.answersOpen);
  $("#songRoundStatus").textContent = completed
    ? "Abgeschlossen · Antworten und Bewertungen können weiterhin kontrolliert werden. Zum Übernehmen einer Korrektur Resultat erneut speichern."
    : `Aktuell auf den Handys: Song ${game.currentSong} von ${SONG_BATTLE.songCount} · Antworten ${game.answersOpen ? "offen" : "geschlossen"}`;
  $("#songAdminRoundTitle").textContent = `Song ${songReviewNumber} von ${SONG_BATTLE.songCount}`;

  const songKey = `song-${songReviewNumber}`;
  const submissions = TEAMS.filter(team => songAnswers?.[team.id]?.[songKey]).length;
  $("#songSubmissionCount").textContent = `${submissions} / ${TEAMS.length} abgegeben`;
  $("#songTeamAnswers").innerHTML = TEAMS.map(team => {
    const answer = songAnswers?.[team.id]?.[songKey];
    const evaluation = songAdmin.evaluations?.[songKey]?.[team.id] || {};
    return `<article class="song-answer-card ${answer ? "submitted" : "missing"}" style="--team:${team.color}">
      <div class="song-answer-team"><span>${team.marker}</span><div><strong>${team.name.toUpperCase()}</strong><small>${answer ? "✓ abgegeben" : "Noch keine Abgabe"}</small></div></div>
      <div class="song-answer-copy"><span>Titel</span><b>${escapeHtml(answer?.title || "–")}</b></div>
      <div class="song-evaluation">${evaluationButtons(team.id, "title", evaluation.title, !!answer)}</div>
      <div class="song-answer-copy"><span>Interpret</span><b>${escapeHtml(answer?.artist || "–")}</b></div>
      <div class="song-evaluation">${evaluationButtons(team.id, "artist", evaluation.artist, !!answer)}</div>
    </article>`;
  }).join("");

  const readyForFinal = (Number(game.currentSong) === SONG_BATTLE.songCount || completed) && (!game.answersOpen || completed);
  $("#songFinalisation").classList.toggle("hidden", !readyForFinal);
  if (readyForFinal) renderSongFinalisation(game);
}

function evaluationButtons(teamId, field, current, enabled) {
  return `<span>${field === "title" ? "Titel" : "Interpret"}</span><button type="button" data-song-eval="${field}" data-team="${teamId}" data-value="true" class="${current === true ? "correct active" : "correct"}" ${enabled ? "" : "disabled"}>✓</button><button type="button" data-song-eval="${field}" data-team="${teamId}" data-value="false" class="${current === false ? "wrong active" : "wrong"}" ${enabled ? "" : "disabled"}>✗</button>`;
}

function renderSongFinalisation(game) {
  const scores = songBattleScores(songAdmin.evaluations);
  const ties = songBattleTieGroups(scores);
  const incomplete = TEAMS.some(team => Array.from({ length: SONG_BATTLE.songCount }, (_, index) => {
    const key = `song-${index + 1}`;
    const answer = songAnswers?.[team.id]?.[key];
    const evaluation = songAdmin.evaluations?.[key]?.[team.id];
    return answer && (typeof evaluation?.title !== "boolean" || typeof evaluation?.artist !== "boolean");
  }).some(Boolean));
  $("#songTieWarning").classList.toggle("hidden", ties.length === 0);
  $("#songFinalHelp").textContent = incomplete
    ? "Bitte zuerst alle eingegangenen Antworten vollständig mit ✓ oder ✗ bewerten."
    : ties.length ? "Nur bei gleicher interner Punktzahl darf die Reihenfolge durch das Stechen geändert werden." : "Kein Gleichstand: Die Rangfolge ergibt sich automatisch aus den internen Punkten.";
  $("#finishSongBattle").disabled = incomplete;

  const suggested = suggestedSongBattleRanking(scores, game.ranking || []);
  const signature = JSON.stringify({ scores, ranking: game.ranking || [] });
  if (!songRankingDirty || signature !== songRankingSignature) {
    songRankingSignature = signature;
    songRankingDirty = false;
    const tiedIds = new Set(ties.flatMap(group => group.teamIds));
    $("#songFinalRanking").innerHTML = suggested.map((teamId, index) => {
      const score = scores[teamId];
      const selectable = tiedIds.has(teamId);
      const options = suggested.filter(id => scores[id] === score).map(id => {
        const team = TEAMS.find(item => item.id === id);
        return `<option value="${id}" ${id === teamId ? "selected" : ""}>${team.name} ${team.marker}</option>`;
      }).join("");
      return `<label><span>Platz ${index + 1} <small>${score}/12 · +${TEAMS.length - index}</small></span><select id="song-final-${index}" ${selectable ? "" : "disabled"}>${options}</select></label>`;
    }).join("");
  }
  $("#finishSongBattle").textContent = game.status === "completed" ? "Korrektur übernehmen · Punkte aktualisieren" : "Endrangfolge speichern · Punkte vergeben";
  validateSongFinalRanking();
}

function validateSongFinalRanking(report = false) {
  const selects = TEAMS.map((_, index) => $(`#song-final-${index}`)).filter(Boolean);
  if (selects.length !== TEAMS.length) return false;
  const ranking = selects.map(select => select.value);
  const duplicate = new Set(ranking).size !== ranking.length;
  selects.forEach(select => select.setCustomValidity?.(duplicate ? "Jedes Reich darf nur einmal vorkommen." : ""));
  $("#songFinishMessage").textContent = duplicate ? "Jedes Reich darf nur einmal vorkommen. Bitte die Reihenfolge des Stechens korrigieren." : "";
  if (report && duplicate) selects.find(select => !select.checkValidity?.())?.reportValidity?.();
  return !duplicate;
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

function loadEdit(id) { if (id === BALLON_GAME.id) { ballonDirty = false; renderBallonAdmin(currentState, true); openBallonResult(); $("#ballonAdminPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; } if (id === SONG_BATTLE.id) { songReviewNumber = 1; renderSongBattleAdmin(currentState); $("#songBattleAdminPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; } const game = currentState.games[id]; if (!game) return; editingId = id; $("#formTitle").textContent = "Resultat korrigieren"; $("#cancelEdit").classList.remove("hidden"); $("#gameName").value = game.name || ""; $("#roundName").value = game.round || ""; $("#resultText").value = game.resultText || ""; TEAMS.forEach(team => $(`#score-${team.id}`).value = Number(game.points?.[team.id] || 0)); $("#resultForm").scrollIntoView({ behavior: "smooth", block: "start" }); }
function resetForm() { editingId = null; $("#resultForm").reset(); TEAMS.forEach(team => $(`#score-${team.id}`).value = 0); $("#formTitle").textContent = "Spielresultat erfassen"; $("#cancelEdit").classList.add("hidden"); $("#saveMessage").textContent = ""; }
function toast(message) { $("#toast").textContent = message; $("#toast").classList.add("show"); setTimeout(() => $("#toast").classList.remove("show"), 2200); }
async function withDisabled(button, action) { button.disabled = true; try { await action(); } catch (error) { toast(`Speichern fehlgeschlagen: ${error.message}`); } finally { button.disabled = false; } }
function setAccess(granted) {
  $("#loginPanel").classList.toggle("hidden", granted); $("#adminContent").classList.toggle("hidden", !granted); $("#logoutBtn").classList.toggle("hidden", !granted);
  if (granted && !oracleQuestionsUnsubscribe) oracleQuestionsUnsubscribe = store.subscribeOracleQuestions(questions => { oracleQuestions = questions; renderOracleQuestions(); });
  if (granted && !songAnswersUnsubscribe) songAnswersUnsubscribe = store.subscribeSongBattleAnswers(answers => { songAnswers = answers; if (currentState) renderSongBattleAdmin(currentState); });
  if (granted && !songAdminUnsubscribe) songAdminUnsubscribe = store.subscribeSongBattleAdmin(value => { songAdmin = value; if (currentState) renderSongBattleAdmin(currentState); });
  if (!granted && oracleQuestionsUnsubscribe) { oracleQuestionsUnsubscribe(); oracleQuestionsUnsubscribe = null; oracleQuestions = {}; }
  if (!granted && songAnswersUnsubscribe) { songAnswersUnsubscribe(); songAnswersUnsubscribe = null; songAnswers = {}; }
  if (!granted && songAdminUnsubscribe) { songAdminUnsubscribe(); songAdminUnsubscribe = null; songAdmin = { evaluations: {}, internalPoints: {} }; }
}
async function sha256(value) { const bytes = new TextEncoder().encode(value); const hash = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
function humanAuthError(code) { return ({ "auth/invalid-credential": "E-Mail oder Passwort ist falsch.", "auth/too-many-requests": "Zu viele Versuche. Bitte kurz warten.", "auth/network-request-failed": "Keine Verbindung. Bitte Internet prüfen." })[code] || "Login fehlgeschlagen."; }
function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }
