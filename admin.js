import { TEAMS, sortedGames, formatTime, SONG_BATTLE, NOVITIUS_GAME, GAME_STATUSES, hasGameResult, songBattleScores, suggestedSongBattleRanking } from "./data.js?v=hunt-2";
import { getStore } from "./store.js?v=hunt-2";
import { HUNT_DEFAULT_TARGETS, normaliseHuntTargets, huntTargetList, huntFinds, huntProgress } from "./hunt-data.js?v=hunt-2";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let currentState = null, editingId = null;
let songAnswers = {}, songParticipants = {}, songAdmin = { evaluations: {}, internalPoints: {} }, songAnswersUnsubscribe = null, songParticipantsUnsubscribe = null, songAdminUnsubscribe = null;
let songReviewNumber = 1;
let novitiusAdmin = { questions: {} }, novitiusParticipants = {}, novitiusAnswers = {}, novitiusAdminUnsubscribe = null, novitiusParticipantsUnsubscribe = null, novitiusAnswersUnsubscribe = null, novitiusReviewNumber = 1;
let huntAdmin = { targets: normaliseHuntTargets() }, huntAdminUnsubscribe = null, huntTargetSignature = "";

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
$("#revealSongRound").addEventListener("click", async () => {
  const button = $("#revealSongRound");
  button.disabled = true;
  try { await store.revealSongBattleSong(songReviewNumber); toast(`Song ${songReviewNumber} ist aufgelöst`); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$("#songTeamAnswers").addEventListener("click", async event => {
  const releaseButton = event.target.closest("button[data-release-team]");
  if (releaseButton) {
    const team = TEAMS.find(item => item.id === releaseButton.dataset.releaseTeam);
    if (!confirm(`Teilnahme von ${team?.name || "diesem Reich"} freigeben? Bereits gespeicherte Song-Antworten dieses Reichs werden gelöscht.`)) return;
    await store.releaseSongBattleTeam(releaseButton.dataset.releaseTeam);
    toast(`${team?.name || "Teilnahme"} freigegeben`);
    return;
  }
  const button = event.target.closest("button[data-song-eval]");
  if (!button) return;
  button.disabled = true;
  try {
    await store.saveSongBattleEvaluation(songReviewNumber, button.dataset.team, button.dataset.songEval, button.dataset.value === "true");
  } catch (error) { toast(`Bewertung fehlgeschlagen: ${error.message}`); }
  finally { button.disabled = false; }
});
$("#finishSongBattle").addEventListener("click", async () => {
  const button = $("#finishSongBattle");
  $("#songFinishMessage").textContent = "";
  try {
    button.disabled = true;
    await store.finishSongBattle();
    toast("Song Battle abgeschlossen · Gesamtpunkte aktualisiert");
  } catch (error) { $("#songFinishMessage").textContent = error.message; }
  finally { button.disabled = false; }
});

$("#novitiusRoundSelect").innerHTML = Array.from({ length: NOVITIUS_GAME.questionCount }, (_, index) => `<option value="${index + 1}">Frage ${index + 1} von ${NOVITIUS_GAME.questionCount}</option>`).join("");
$("#novitiusThresholdInputs").innerHTML = [5, 4, 3, 2, 1].map((points, index) => `<label>${points} Punkte<input id="novitius-threshold-${index}" type="number" min="0" step="any" required></label>`).join("");
$("#startNovitius").addEventListener("click", async () => {
  if (!confirm("Anmeldung für «Wer kennt den Novitius?» jetzt öffnen?")) return;
  await withDisabled($("#startNovitius"), async () => { await store.startNovitiusGame(); toast("Anmeldung geöffnet"); });
});
$("#resetNovitius").addEventListener("click", async () => {
  if (!confirm("Spiel vollständig zurücksetzen? Teilnehmende, Antworten und Spielpunkte werden gelöscht. Die vorbereiteten Fragen bleiben erhalten.")) return;
  await withDisabled($("#resetNovitius"), async () => { await store.resetNovitiusGame(); novitiusReviewNumber = 1; toast("Novitius-Spiel zurückgesetzt"); });
});
$("#openNovitiusRegistration").addEventListener("click", async () => { try { await store.setNovitiusRegistration(true); toast("Anmeldung offen"); } catch (error) { toast(error.message); } });
$("#closeNovitiusRegistration").addEventListener("click", async () => { try { await store.setNovitiusRegistration(false); toast("Teilnehmerliste geschlossen"); } catch (error) { toast(error.message); } });
$("#novitiusRoundSelect").addEventListener("change", event => { novitiusReviewNumber = Number(event.target.value); if (currentState?.games?.[NOVITIUS_GAME.id]?.status === "completed") renderNovitiusAdmin(currentState); });
$("#startNovitiusQuestion").addEventListener("click", () => startNovitiusRound(Number($("#novitiusRoundSelect").value)));
$("#nextNovitiusQuestion").addEventListener("click", () => { const current = Number(currentState?.games?.[NOVITIUS_GAME.id]?.currentQuestion || 0); if (current < NOVITIUS_GAME.questionCount) startNovitiusRound(current + 1); });
$("#openNovitiusAnswers").addEventListener("click", async () => { await store.setNovitiusAnswersOpen(true); toast("Antworten geöffnet"); });
$("#closeNovitiusAnswers").addEventListener("click", async () => { await store.setNovitiusAnswersOpen(false); toast("Antworten gesperrt"); });
$("#revealNovitiusQuestion").addEventListener("click", async () => {
  const button = $("#revealNovitiusQuestion"); button.disabled = true;
  try { await store.revealNovitiusQuestion(novitiusReviewNumber); toast(`Frage ${novitiusReviewNumber} aufgelöst`); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$("#finishNovitius").addEventListener("click", async () => {
  const button = $("#finishNovitius"); button.disabled = true; $("#novitiusFinishMessage").textContent = "";
  try { await store.finishNovitiusGame(); toast("Novitius-Spiel abgeschlossen · Punkte aktualisiert"); }
  catch (error) { $("#novitiusFinishMessage").textContent = error.message; }
  finally { button.disabled = false; }
});
$("#novitiusParticipantList").addEventListener("click", async event => {
  const button = event.target.closest("button[data-novitius-remove]"); if (!button) return;
  const participant = novitiusParticipants[button.dataset.novitiusRemove];
  if (!confirm(`${participant?.playerName || "Teilnehmende Person"} entfernen? Alle Antworten dieser Person werden gelöscht.`)) return;
  await store.removeNovitiusParticipant(button.dataset.novitiusRemove); toast("Teilnehmende Person entfernt");
});
$("#novitiusQuestionList").addEventListener("click", event => { const button = event.target.closest("button[data-novitius-edit]"); if (button) openNovitiusQuestionEditor(Number(button.dataset.novitiusEdit)); });
$("#cancelNovitiusQuestion").addEventListener("click", () => $("#novitiusQuestionForm").classList.add("hidden"));
$("#novitiusQuestionType").addEventListener("change", updateNovitiusCorrectInput);
$("#novitiusQuestionForm").addEventListener("submit", async event => {
  event.preventDefault(); $("#novitiusQuestionMessage").textContent = "";
  const number = Number($("#novitiusQuestionNumber").value);
  try {
    await store.saveNovitiusQuestion(number, { text: $("#novitiusQuestionText").value, type: $("#novitiusQuestionType").value, unit: $("#novitiusQuestionUnit").value, correctValue: $("#novitiusCorrectValue").value, thresholds: [0,1,2,3,4].map(index => Number($(`#novitius-threshold-${index}`).value)), liveAnswer: $("#novitiusLiveAnswer").checked });
    $("#novitiusQuestionForm").classList.add("hidden"); toast(`Frage ${number} gespeichert`);
  } catch (error) { $("#novitiusQuestionMessage").textContent = error.message; }
});

$("#scoreInputs").innerHTML = TEAMS.map(team => `<label class="score-field" style="--team:${team.color}"><span><i></i>${team.name}</span><input id="score-${team.id}" type="number" inputmode="numeric" value="0" step="1" required></label>`).join("");
if (store.demo) setAccess(true);
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
    if (store.demo) setAccess(true);
    else await store.auth.login($("#email").value, $("#password").value);
  } catch (error) {
    $("#loginError").textContent = error.message === "wrong-password" ? "Passwort ist falsch." : humanAuthError(error.code);
  }
});
$("#logoutBtn").addEventListener("click", async () => {
  if (store.demo) {
    toast("Im lokalen Demomodus ist der Adminbereich automatisch offen.");
  } else await store.auth.logout();
});

document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", async () => { await store.setMode(button.dataset.mode); toast(`Modus auf „${button.textContent}“ gesetzt`); }));
$("#startTeamHunt").addEventListener("click", async () => {
  if (!confirm("Nachtjagd jetzt für alle Reiche starten? Sie bleibt aktiv, bis ihr sie manuell stoppt.")) return;
  try { await store.startHunt(); toast("Nachtjagd gestartet"); } catch (error) { toast(error.message); }
});
$("#stopTeamHunt").addEventListener("click", async () => {
  if (!confirm("Nachtjagd jetzt beenden? Alle bisherigen Funde und Punkte bleiben erhalten.")) return;
  await store.stopHunt();
  toast("Nachtjagd beendet");
});
$("#resetTeamHunt").addEventListener("click", async () => {
  if (!confirm("Nachtjagd vollständig zurücksetzen? Alle Nachtjagd-Funde und die dazugehörigen Tagespunkte werden entfernt.")) return;
  await store.resetHunt(); toast("Nachtjagd zurückgesetzt");
});
$("#huntTargetEditorList").addEventListener("submit", async event => {
  const form = event.target.closest("form[data-hunt-target]"); if (!form) return; event.preventDefault();
  const id = form.dataset.huntTarget;
  try { await store.saveHuntTarget(id, { clue: form.querySelector("[name=clue]").value, internalName: form.querySelector("[name=internalName]").value, category: form.querySelector("[name=category]").value, enabled: form.querySelector("[name=enabled]").checked }); toast(`Gegenstand ${HUNT_DEFAULT_TARGETS[id].number} gespeichert`); }
  catch (error) { toast(error.message); }
});
$("#huntManualFindForm").addEventListener("submit", async event => {
  event.preventDefault(); const hunt = currentState.settings.hunt;
  const result = await store.addHuntFind(hunt.roundId, $("#huntManualTarget").value, $("#huntManualTeam").value, $("#huntManualPlayer").value);
  toast(result.awarded ? "Fund hinzugefügt · +1 Tagespunkt" : "Dieses Reich hat den Gegenstand bereits gefunden");
  if (result.awarded) $("#huntManualPlayer").value = "";
});
$("#huntFindMatrix").addEventListener("click", async event => {
  const button = event.target.closest("button[data-remove-hunt]"); if (!button) return;
  const [teamId, targetId] = button.dataset.removeHunt.split("|");
  if (!confirm("Diesen Fund entfernen? Der entsprechende Tagespunkt wird sofort zurückgenommen.")) return;
  await store.removeHuntFind(currentState.settings.hunt.roundId, targetId, teamId); toast("Fund und Tagespunkt entfernt");
});

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
  if (action === "delete" && id === SONG_BATTLE.id) {
    if (confirm("Song Battle vollständig zurücksetzen? Antworten, Bewertungen, Teilnahmen und Punkte werden entfernt.")) { await store.resetSongBattle(); toast("Song Battle zurückgesetzt"); }
    return;
  }
  if (action === "delete" && id === NOVITIUS_GAME.id) {
    if (confirm("Novitius-Quiz vollständig zurücksetzen? Teilnahmen, Antworten und Punkte werden entfernt; die vorbereiteten Fragen bleiben erhalten.")) { await store.resetNovitiusGame(); toast("Novitius-Quiz zurückgesetzt"); }
    return;
  }
  if (action === "delete" && confirm("Dieses Resultat wirklich löschen? Die Rangliste wird sofort neu berechnet.")) { await store.deleteGame(id); toast("Resultat gelöscht"); if (editingId === id) resetForm(); }
});

function renderAdmin(state) {
  renderSongBattleAdmin(state);
  renderNovitiusAdmin(state);
  renderHuntAdmin(state);
  const mode = state.settings.mode || "live";
  document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  $("#modeHelp").textContent = { live: "Rangliste und Resultate sind für alle sichtbar.", frozen: "Publikum sieht keine Punkte – Admin bleibt bedienbar.", final: "Die Siegeransicht wird öffentlich angezeigt." }[mode];
  const games = sortedGames(state.games).filter(hasGameResult);
  $("#adminResults").innerHTML = games.map(game => `<article class="admin-result"><div><span>${formatTime(game.createdAt, true)}</span><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml(game.round || game.resultText || "")}</small></div><div class="admin-actions"><button data-action="edit" data-id="${game.id}">Bearbeiten</button><button class="danger" data-action="delete" data-id="${game.id}">Löschen</button></div></article>`).join("");
  $("#adminEmpty").classList.toggle("hidden", games.length > 0);
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
  const songKey = `song-${songReviewNumber}`;
  const currentSongSelected = Number(game.currentSong) === songReviewNumber;
  const revealed = !!game.revealedSongs?.[songKey];
  $("#revealSongRound").classList.toggle("hidden", !running || !currentSongSelected || game.answersOpen);
  $("#revealSongRound").textContent = revealed ? "Auflösung aktualisieren" : "Song auflösen";
  $("#openSongAnswers").classList.toggle("hidden", !running || game.answersOpen || revealed);
  $("#songRoundStatus").textContent = completed
    ? "Abgeschlossen · Antworten und Bewertungen können weiterhin kontrolliert werden. Zum Übernehmen einer Korrektur Resultat erneut speichern."
    : `Aktuell auf den Handys: Song ${game.currentSong} von ${SONG_BATTLE.songCount} · Antworten ${game.answersOpen ? "offen" : "geschlossen"}`;
  $("#songAdminRoundTitle").textContent = `Song ${songReviewNumber} von ${SONG_BATTLE.songCount}`;

  const submissions = TEAMS.filter(team => songAnswers?.[team.id]?.[songKey]).length;
  $("#songSubmissionCount").textContent = `${submissions} / ${TEAMS.length} abgegeben`;
  $("#songTeamAnswers").innerHTML = TEAMS.map(team => {
    const answer = songAnswers?.[team.id]?.[songKey];
    const participant = songParticipants?.[team.id];
    const evaluation = songAdmin.evaluations?.[songKey]?.[team.id] || {};
    return `<article class="song-answer-card ${answer ? "submitted" : "missing"}" style="--team:${team.color}">
      <div class="song-answer-team"><span>${team.marker}</span><div><strong>${team.name.toUpperCase()}</strong><small>${participant ? `${escapeHtml(participant.playerName || "Teilnahme reserviert")} · ${answer ? "✓ abgegeben" : "noch offen"}` : "Noch niemand angemeldet"}</small></div>${participant ? `<button type="button" class="song-release-player" data-release-team="${team.id}">Freigeben</button>` : ""}</div>
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
  const incomplete = TEAMS.some(team => Array.from({ length: SONG_BATTLE.songCount }, (_, index) => {
    const key = `song-${index + 1}`;
    const answer = songAnswers?.[team.id]?.[key];
    const evaluation = songAdmin.evaluations?.[key]?.[team.id];
    return answer && (typeof evaluation?.title !== "boolean" || typeof evaluation?.artist !== "boolean");
  }).some(Boolean));
  $("#songFinalHelp").textContent = incomplete
    ? "Bitte zuerst alle eingegangenen Antworten vollständig mit ✓ oder ✗ bewerten."
    : "Die Rangfolge ergibt sich automatisch. Bei Gleichstand teilen sich die Teams den Platz und erhalten dieselben Gesamtpunkte.";
  $("#finishSongBattle").disabled = incomplete;

  const suggested = suggestedSongBattleRanking(scores, game.ranking || []);
  const placements = {};
  $("#songFinalRanking").innerHTML = suggested.map((teamId, index) => {
    const team = TEAMS.find(item => item.id === teamId);
    const place = index > 0 && scores[teamId] === scores[suggested[index - 1]] ? placements[suggested[index - 1]] : index + 1;
    placements[teamId] = place;
    return `<div class="song-final-row" style="--team:${team.color}"><strong>${place}. ${team.marker} ${team.name}</strong><span>${scores[teamId]}/12 · +${TEAMS.length + 1 - place}</span></div>`;
  }).join("");
  $("#finishSongBattle").textContent = game.status === "completed" ? "Korrektur übernehmen · Punkte aktualisieren" : "Resultat abschliessen · Punkte vergeben";
}

async function startNovitiusRound(number) {
  const game = currentState?.games?.[NOVITIUS_GAME.id];
  if (game?.status !== "running") return;
  if (!game.participantsLocked && !confirm("Die Anmeldung ist noch offen. Mit dem Start wird die Teilnehmerliste geschlossen. Frage trotzdem starten?")) return;
  if (!confirm(`Frage ${number} starten und Antworten öffnen?`)) return;
  try { await store.startNovitiusQuestion(number); novitiusReviewNumber = number; toast(`Frage ${number} läuft`); }
  catch (error) { toast(error.message); }
}

function renderNovitiusAdmin(state) {
  const game = state?.games?.[NOVITIUS_GAME.id];
  const status = game?.status || "not-started";
  const running = status === "running", completed = status === "completed";
  if (running && game.currentQuestion) novitiusReviewNumber = Number(game.currentQuestion);
  $("#novitiusAdminStatus").textContent = GAME_STATUSES[status] || GAME_STATUSES["not-started"];
  $("#startNovitius").classList.toggle("hidden", status !== "not-started");
  $("#resetNovitius").classList.toggle("hidden", status === "not-started");
  $("#novitiusControls").classList.toggle("hidden", status === "not-started");
  renderNovitiusQuestionList();
  if (status === "not-started") return;

  const participants = Object.entries(novitiusParticipants);
  $("#novitiusParticipantCount").textContent = `${participants.length} angemeldet`;
  $("#novitiusParticipantList").innerHTML = participants.length ? participants.sort(([, a], [, b]) => a.teamId.localeCompare(b.teamId) || a.playerName.localeCompare(b.playerName)).map(([id, participant]) => {
    const team = TEAMS.find(item => item.id === participant.teamId);
    return `<span style="--team:${team?.color || "#888"}"><i></i>${escapeHtml(participant.playerName)} · ${team?.marker || ""} ${team?.name || participant.teamId}<button type="button" data-novitius-remove="${id}">×</button></span>`;
  }).join("") : '<p class="save-message">Noch niemand angemeldet.</p>';
  $("#openNovitiusRegistration").classList.toggle("hidden", !running || Number(game.currentQuestion || 0) > 0 || game.registrationOpen);
  $("#closeNovitiusRegistration").classList.toggle("hidden", !running || Number(game.currentQuestion || 0) > 0 || !game.registrationOpen);
  $("#novitiusRoundSelect").value = String(novitiusReviewNumber);
  $("#startNovitiusQuestion").classList.toggle("hidden", !running);
  $("#nextNovitiusQuestion").classList.toggle("hidden", !running || !game.currentQuestion || Number(game.currentQuestion) >= NOVITIUS_GAME.questionCount);
  $("#novitiusAnswerControls").classList.toggle("hidden", !running || !game.currentQuestion);
  $("#openNovitiusAnswers").classList.toggle("hidden", !running || !game.currentQuestion || game.answersOpen || game.revealedQuestions?.[`question-${game.currentQuestion}`]);
  $("#closeNovitiusAnswers").classList.toggle("hidden", !running || !game.currentQuestion || !game.answersOpen);
  $("#revealNovitiusQuestion").classList.toggle("hidden", !running || !game.currentQuestion || game.answersOpen);

  const key = `question-${novitiusReviewNumber}`;
  const submitted = participants.filter(([id]) => novitiusAnswers?.[id]?.[key]).length;
  $("#novitiusRoundStatus").textContent = completed ? "Abgeschlossen · Fragen und Resultat können weiterhin kontrolliert werden." : game.currentQuestion ? `Frage ${game.currentQuestion} von ${NOVITIUS_GAME.questionCount} · ${game.answersOpen ? "Antworten offen" : "Antworten geschlossen"} · ${submitted}/${participants.length} abgegeben` : `Anmeldung ${game.registrationOpen ? "offen" : "geschlossen"} · danach Frage 1 starten`;
  const reviewedQuestion = novitiusAdmin.questions?.[key];
  $("#novitiusAdminAnswers").innerHTML = game.currentQuestion ? participants.map(([id, participant]) => {
    const team = TEAMS.find(item => item.id === participant.teamId), answer = novitiusAnswers?.[id]?.[key];
    return `<div style="--team:${team?.color || "#888"}"><span>${team?.marker || ""} ${escapeHtml(participant.playerName)}</span><strong>${answer ? escapeHtml(formatNovitiusValue(answer.value, reviewedQuestion?.unit || game.currentQuestionData?.unit)) : "–"}</strong></div>`;
  }).join("") : "";
  const finalReady = completed || (Number(game.currentQuestion) === NOVITIUS_GAME.questionCount && !game.answersOpen);
  $("#novitiusFinalisation").classList.toggle("hidden", !finalReady);
  $("#finishNovitius").textContent = completed ? "Resultat neu berechnen" : "Spiel abschliessen · Punkte vergeben";
}

function renderNovitiusQuestionList() {
  const questions = novitiusAdmin.questions || {};
  $("#novitiusQuestionList").innerHTML = Array.from({ length: NOVITIUS_GAME.questionCount }, (_, index) => {
    const number = index + 1, question = questions[`question-${number}`] || {};
    const answer = question.correctValue === "" || question.correctValue === null || question.correctValue === undefined ? "Antwort noch offen" : `Antwort: ${formatNovitiusValue(question.correctValue, question.unit)}`;
    return `<article><span>${number}</span><div><strong>${escapeHtml(question.text || "Noch nicht vorbereitet")}</strong><small>${escapeHtml(answer)} · ${question.type === "time" ? "Uhrzeit" : "Zahl"}</small></div><button type="button" data-novitius-edit="${number}">Bearbeiten</button></article>`;
  }).join("");
}

function openNovitiusQuestionEditor(number) {
  const question = novitiusAdmin.questions?.[`question-${number}`]; if (!question) return;
  $("#novitiusQuestionNumber").value = number;
  $("#novitiusQuestionText").value = question.text || "";
  $("#novitiusQuestionType").value = question.type || "number";
  $("#novitiusQuestionUnit").value = question.unit || "";
  $("#novitiusCorrectValue").value = question.correctValue ?? "";
  [0,1,2,3,4].forEach(index => { $(`#novitius-threshold-${index}`).value = Number(question.thresholds?.[index] || 0); });
  $("#novitiusLiveAnswer").checked = !!question.liveAnswer;
  updateNovitiusCorrectInput();
  $("#novitiusQuestionForm").classList.remove("hidden");
  $("#novitiusQuestionForm").scrollIntoView({ behavior: "smooth", block: "center" });
}

function updateNovitiusCorrectInput() {
  const time = $("#novitiusQuestionType").value === "time";
  $("#novitiusCorrectValue").type = time ? "time" : "number";
  $("#novitiusCorrectValue").step = time ? "60" : "any";
}

function formatNovitiusValue(value, unit = "") {
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function renderHuntAdmin(state) {
  const hunt = state.settings.hunt || {}, hasRound = !!hunt.roundId, active = !!hunt.active;
  const targets = hasRound ? Object.values(hunt.targets || {}).sort((a, b) => a.number - b.number) : huntTargetList(huntAdmin.targets);
  const finds = hasRound ? huntFinds(state.games, hunt.roundId) : [];
  $("#startTeamHunt").classList.toggle("hidden", hasRound);
  $("#stopTeamHunt").classList.toggle("hidden", !active);
  $("#resetTeamHunt").classList.toggle("hidden", !hasRound || active);
  $("#huntAdminStatus").textContent = active ? `Aktiv seit ${formatTime(hunt.startedAt)} · ${finds.length} Funde` : hasRound ? `Beendet · ${finds.length} Funde gespeichert` : "Noch nicht gestartet";
  $("#huntManualFind").classList.toggle("hidden", !hasRound);
  $("#huntDetailSection").classList.toggle("hidden", !hasRound);
  $("#huntTeamOverview").innerHTML = TEAMS.map(team => `<div style="--team:${team.color}"><span>${team.marker} ${team.name}</span><strong>${huntProgress(state.games, hunt.roundId, team.id).size} / ${targets.length || 10}</strong></div>`).join("");

  const signature = JSON.stringify(huntAdmin.targets);
  if (signature !== huntTargetSignature) {
    huntTargetSignature = signature;
    $("#huntTargetEditorList").innerHTML = Object.values(normaliseHuntTargets(huntAdmin.targets)).sort((a, b) => a.number - b.number).map(target => `<form data-hunt-target="${target.id}" class="hunt-target-editor"><div class="hunt-target-editor-head"><strong>Gegenstand ${target.number}</strong><label><input name="enabled" type="checkbox" ${target.enabled !== false ? "checked" : ""}> aktiv</label></div><label>Geheimnisvoller Hinweis<textarea name="clue" maxlength="220" required>${escapeHtml(target.clue)}</textarea></label><div class="form-grid"><label>Interner Name<input name="internalName" maxlength="80" value="${escapeAttribute(target.internalName)}" required></label><label>Erkennungsziel (KI-Kategorie)<input name="category" maxlength="60" value="${escapeAttribute(target.category)}" required></label></div><button class="secondary-button" type="submit">Gegenstand speichern</button></form>`).join("");
  }
  if (!hasRound) return;
  $("#huntManualTarget").innerHTML = targets.map(target => `<option value="${target.id}">Gegenstand ${target.number} · ${escapeHtml(huntAdmin.targets?.[target.id]?.internalName || target.internalName || target.id)}</option>`).join("");
  $("#huntManualTeam").innerHTML = TEAMS.map(team => `<option value="${team.id}">${team.marker} ${team.name}</option>`).join("");
  const byKey = new Map(finds.map(find => [`${find.teamId}|${find.targetId}`, find]));
  $("#huntFindMatrix").innerHTML = targets.map(target => `<article><header><strong>Gegenstand ${target.number}</strong><span>${escapeHtml(huntAdmin.targets?.[target.id]?.internalName || target.internalName || target.id)}</span></header><div>${TEAMS.map(team => { const find = byKey.get(`${team.id}|${target.id}`); return `<section style="--team:${team.color}"><b>${team.marker} ${team.name}</b>${find ? `<span>✓ ${escapeHtml(find.playerName)} · ${formatTime(find.createdAt)}</span><button type="button" data-remove-hunt="${team.id}|${target.id}">Fund entfernen</button>` : "<span>–</span>"}</section>`; }).join("")}</div></article>`).join("");
  $("#huntAdminHistory").innerHTML = [...finds].sort((a, b) => b.createdAt - a.createdAt).map(find => { const team = TEAMS.find(item => item.id === find.teamId); const target = huntAdmin.targets?.[find.targetId]; return `<div style="--team:${team?.color || "#888"}"><time>${formatTime(find.createdAt)}</time><span><strong>Gegenstand ${find.targetNumber}</strong> · ${escapeHtml(target?.internalName || find.targetId)}<small>von ${escapeHtml(find.playerName)} · ${team?.marker || ""} ${team?.name || find.teamId}${find.manual ? " · manuell" : ""}</small></span><b>+${Number(find.awardedPoints || 1)}</b></div>`; }).join("") || '<p class="empty-state">Noch keine Funde.</p>';
}

function loadEdit(id) { if (id === SONG_BATTLE.id) { songReviewNumber = 1; renderSongBattleAdmin(currentState); $("#songBattleAdminPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; } if (id === NOVITIUS_GAME.id) { novitiusReviewNumber = 1; renderNovitiusAdmin(currentState); $("#novitiusAdminPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; } const game = currentState.games[id]; if (!game) return; editingId = id; $("#formTitle").textContent = "Resultat korrigieren"; $("#cancelEdit").classList.remove("hidden"); $("#gameName").value = game.name || ""; $("#roundName").value = game.round || ""; $("#resultText").value = game.resultText || ""; TEAMS.forEach(team => $(`#score-${team.id}`).value = Number(game.points?.[team.id] || 0)); $("#resultForm").scrollIntoView({ behavior: "smooth", block: "start" }); }
function resetForm() { editingId = null; $("#resultForm").reset(); TEAMS.forEach(team => $(`#score-${team.id}`).value = 0); $("#formTitle").textContent = "Spielresultat erfassen"; $("#cancelEdit").classList.add("hidden"); $("#saveMessage").textContent = ""; }
function toast(message) { $("#toast").textContent = message; $("#toast").classList.add("show"); setTimeout(() => $("#toast").classList.remove("show"), 2200); }
async function withDisabled(button, action) { button.disabled = true; try { await action(); } catch (error) { toast(`Speichern fehlgeschlagen: ${error.message}`); } finally { button.disabled = false; } }
function setAccess(granted) {
  $("#loginPanel").classList.toggle("hidden", granted); $("#adminContent").classList.toggle("hidden", !granted); $("#logoutBtn").classList.toggle("hidden", !granted);
  if (granted && !songAnswersUnsubscribe) songAnswersUnsubscribe = store.subscribeSongBattleAnswers(answers => { songAnswers = answers; if (currentState) renderSongBattleAdmin(currentState); });
  if (granted && !songParticipantsUnsubscribe) songParticipantsUnsubscribe = store.subscribeSongBattleParticipants(participants => { songParticipants = participants; if (currentState) renderSongBattleAdmin(currentState); });
  if (granted && !songAdminUnsubscribe) songAdminUnsubscribe = store.subscribeSongBattleAdmin(value => { songAdmin = value; if (currentState) renderSongBattleAdmin(currentState); });
  if (granted && !novitiusAdminUnsubscribe) novitiusAdminUnsubscribe = store.subscribeNovitiusAdmin(value => { novitiusAdmin = value; renderNovitiusQuestionList(); if (currentState) renderNovitiusAdmin(currentState); });
  if (granted && !novitiusParticipantsUnsubscribe) novitiusParticipantsUnsubscribe = store.subscribeNovitiusParticipants(value => { novitiusParticipants = value; if (currentState) renderNovitiusAdmin(currentState); });
  if (granted && !novitiusAnswersUnsubscribe) novitiusAnswersUnsubscribe = store.subscribeNovitiusAnswers(value => { novitiusAnswers = value; if (currentState) renderNovitiusAdmin(currentState); });
  if (granted && !huntAdminUnsubscribe) huntAdminUnsubscribe = store.subscribeHuntAdmin(value => { huntAdmin = value; huntTargetSignature = ""; if (currentState) renderHuntAdmin(currentState); });
  if (!granted && songAnswersUnsubscribe) { songAnswersUnsubscribe(); songAnswersUnsubscribe = null; songAnswers = {}; }
  if (!granted && songParticipantsUnsubscribe) { songParticipantsUnsubscribe(); songParticipantsUnsubscribe = null; songParticipants = {}; }
  if (!granted && songAdminUnsubscribe) { songAdminUnsubscribe(); songAdminUnsubscribe = null; songAdmin = { evaluations: {}, internalPoints: {} }; }
  if (!granted && novitiusAdminUnsubscribe) { novitiusAdminUnsubscribe(); novitiusAdminUnsubscribe = null; novitiusAdmin = { questions: {} }; }
  if (!granted && novitiusParticipantsUnsubscribe) { novitiusParticipantsUnsubscribe(); novitiusParticipantsUnsubscribe = null; novitiusParticipants = {}; }
  if (!granted && novitiusAnswersUnsubscribe) { novitiusAnswersUnsubscribe(); novitiusAnswersUnsubscribe = null; novitiusAnswers = {}; }
  if (!granted && huntAdminUnsubscribe) { huntAdminUnsubscribe(); huntAdminUnsubscribe = null; huntAdmin = { targets: normaliseHuntTargets() }; huntTargetSignature = ""; }
}
function humanAuthError(code) { return ({ "auth/invalid-credential": "E-Mail oder Passwort ist falsch.", "auth/too-many-requests": "Zu viele Versuche. Bitte kurz warten.", "auth/network-request-failed": "Keine Verbindung. Bitte Internet prüfen." })[code] || "Login fehlgeschlagen."; }
function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }
function escapeAttribute(value = "") { return escapeHtml(String(value)).replaceAll('"', "&quot;"); }
