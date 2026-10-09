import { TEAMS, sortedGames, formatTime, SONG_BATTLE, NOVITIUS_GAME, GAME_STATUSES, hasGameResult, songBattleScores, suggestedSongBattleRanking, scoreNovitiusAnswer, novitiusTieGroups } from "./data.js?v=ballon-monster-1";
import { getStore } from "./store.js?v=ballon-monster-1";
import { HUNT_DEFAULT_TARGETS, normaliseHuntTargets, huntTargetList, huntFinds, huntProgress } from "./hunt-data.js?v=ballon-monster-1";
import { GAME_CHALLENGES, GAME_CHALLENGE_ROTATIONS, CHALLENGE_STATIONS, normaliseGameChallengesAdmin, challengeEstimateQuestions, stationById, challengeTimerRemaining, calculateGameChallenges } from "./challenges-data.js?v=ballon-monster-1";
import { BEER_PONG, normaliseBeerPongAdmin, beerPongMatchList, calculateBeerPongGroupTable, beerPongTieGroups } from "./beer-pong-data.js?v=ballon-monster-1";
import { BALLOON_MONSTER, normaliseBalloonMonsterAdmin, balloonTimerRemaining, balloonRanking } from "./balloon-monster-data.js?v=ballon-monster-1";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let currentState = null, editingId = null;
let songAnswers = {}, songParticipants = {}, songAdmin = { evaluations: {}, internalPoints: {} }, songAnswersUnsubscribe = null, songParticipantsUnsubscribe = null, songAdminUnsubscribe = null;
let songReviewNumber = 1;
let novitiusAdmin = { questions: {} }, novitiusParticipants = {}, novitiusAnswers = {}, novitiusAdminUnsubscribe = null, novitiusParticipantsUnsubscribe = null, novitiusAnswersUnsubscribe = null, novitiusReviewNumber = 1;
let challengesAdmin = normaliseGameChallengesAdmin(), challengesAdminUnsubscribe = null, challengeReviewRound = 1, challengeEditorSignature = "", lastChallengeCurrentRound = 0;
let beerPongAdmin = normaliseBeerPongAdmin(), beerPongAdminUnsubscribe = null;
let balloonMonsterAdmin = normaliseBalloonMonsterAdmin(), balloonMonsterAdminUnsubscribe = null;
let huntAdmin = { targets: normaliseHuntTargets() }, huntAdminUnsubscribe = null, huntTargetSignature = "";

$("#startBalloonMonster").addEventListener("click", async () => {
  const supply = Number($("#balloonMonsterSupply").value);
  if (!confirm(`Ballon-Monster mit ${supply} Ballons Vorrat pro Reich starten? Bisherige Ballon-Monster-Daten werden ersetzt.`)) return;
  await withDisabled($("#startBalloonMonster"), async () => { await store.startBalloonMonster(supply); toast("Ballon-Monster gestartet · Auslosung bereit"); });
});
$("#resetBalloonMonster").addEventListener("click", async () => {
  const running = currentState?.games?.[BALLOON_MONSTER.id]?.status === "running";
  const message = running ? "Ballon-Monster abbrechen? Das Spiel verschwindet sofort von Handys und Grossbildschirm. Noch nicht vergebene Tagespunkte bleiben unverändert." : "Ballon-Monster vollständig zurücksetzen? Resultate und bereits vergebene Tagespunkte dieses Spiels werden entfernt.";
  if (!confirm(message)) return;
  await withDisabled($("#resetBalloonMonster"), async () => { await store.resetBalloonMonster(); toast(running ? "Ballon-Monster abgebrochen" : "Ballon-Monster zurückgesetzt"); });
});
$("#drawBalloonTeam").addEventListener("click", async () => { try { const id = await store.drawBalloonMonsterTeam(); toast(`${teamById(id)?.name || "Reich"} wurde ausgelost`); } catch (error) { balloonError(error); } });
$("#undoBalloonDraw").addEventListener("click", async () => { if (!confirm("Diese Auslosung zurücknehmen und das Reich wieder in die Auswahl legen?")) return; try { await store.undoBalloonMonsterDraw(); toast("Auslosung zurückgenommen"); } catch (error) { balloonError(error); } });
$("#startBalloonTimer").addEventListener("click", async () => { try { await store.startBalloonMonsterTimer(); toast("90-Sekunden-Timer läuft"); } catch (error) { balloonError(error); } });
$("#pauseBalloonTimer").addEventListener("click", async () => { try { await store.pauseBalloonMonsterTimer(); toast("Timer pausiert"); } catch (error) { balloonError(error); } });
$("#resetBalloonTimer").addEventListener("click", async () => { if (!confirm("Timer wirklich auf 01:30 zurücksetzen?")) return; try { await store.resetBalloonMonsterTimer(); toast("Timer zurückgesetzt"); } catch (error) { balloonError(error); } });
$("#startBalloonCourse").addEventListener("click", async () => { try { await store.startBalloonMonsterCourse(); toast("Parcours läuft"); } catch (error) { balloonError(error); } });
$("#finishBalloonCourse").addEventListener("click", async () => { try { await store.finishBalloonMonsterCourse(); toast("Parcours beendet · Resultat erfassen"); } catch (error) { balloonError(error); } });
$("#abortBalloonRound").addEventListener("click", async () => { if (!confirm("Aktuellen Durchgang abbrechen? Timer und Entwurf werden gelöscht; das Reich kommt zurück in die Auslosung.")) return; try { await store.abortBalloonMonsterRound(); toast("Durchgang abgebrochen"); } catch (error) { balloonError(error); } });
$("#balloonResultForm").addEventListener("submit", async event => { event.preventDefault(); const teamId = currentState?.games?.[BALLOON_MONSTER.id]?.currentTeamId; try { await store.saveBalloonMonsterResult(teamId, $("#balloonResultValue").value); toast("Ergebnis als Entwurf gespeichert"); } catch (error) { balloonError(error); } });
$("#publishBalloonResult").addEventListener("click", async () => { const teamId = currentState?.games?.[BALLOON_MONSTER.id]?.currentTeamId; if (!confirm("Gespeichertes Ergebnis jetzt öffentlich anzeigen?")) return; try { await store.publishBalloonMonsterResult(teamId); toast("Ergebnis veröffentlicht"); } catch (error) { balloonError(error); } });
$("#nextBalloonTeam").addEventListener("click", async () => { try { await store.prepareNextBalloonMonsterTeam(); await store.drawBalloonMonsterTeam(); toast("Nächstes Reich wird ausgelost"); } catch (error) { balloonError(error); } });
$("#finishBalloonMonster").addEventListener("click", async () => { const game = currentState?.games?.[BALLOON_MONSTER.id], summary = balloonFinalSummary(game); if (!confirm(`Endrangliste bestätigen und Tagespunkte vergeben?\n\n${summary}`)) return; try { await store.finishBalloonMonster(); toast("Ballon-Monster abgeschlossen · Tagespunkte vergeben"); } catch (error) { balloonError(error); } });
$("#balloonCorrections").addEventListener("submit", async event => { const form = event.target.closest("form[data-balloon-correction]"); if (!form) return; event.preventDefault(); try { await store.saveBalloonMonsterResult(form.dataset.balloonCorrection, form.elements.balloons.value); toast("Korrektur als Entwurf gespeichert"); } catch (error) { balloonError(error); } });
$("#balloonCorrections").addEventListener("click", async event => { const button = event.target.closest("button[data-balloon-publish-correction]"); if (!button) return; const team = teamById(button.dataset.balloonPublishCorrection); if (!confirm(`Gespeicherte Korrektur für ${team?.name || "dieses Reich"} veröffentlichen und Tagespunkte neu berechnen?`)) return; try { await store.publishBalloonMonsterResult(button.dataset.balloonPublishCorrection); toast("Korrektur veröffentlicht · Tagespunkte aktualisiert"); } catch (error) { balloonError(error); } });

$("#songRoundSelect").innerHTML = Array.from({ length: SONG_BATTLE.songCount }, (_, index) => `<option value="${index + 1}">Song ${index + 1} von ${SONG_BATTLE.songCount}</option>`).join("");
$("#startSongBattle").addEventListener("click", async () => {
  if (!confirm("Song Battle jetzt mit Song 1 starten und Antworten öffnen?")) return;
  await withDisabled($("#startSongBattle"), async () => { await store.startSongBattle(); toast("Song Battle läuft · Song 1 ist offen"); });
});
$("#resetSongBattle").addEventListener("click", async () => {
  const running = currentState?.games?.[SONG_BATTLE.id]?.status === "running";
  const message = running ? "Song Battle abbrechen? Das Spiel verschwindet sofort von den Handys. Alle bisherigen Antworten und Bewertungen werden gelöscht." : "Song Battle vollständig zurücksetzen? Antworten, Bewertungen und Gesamtpunkte dieses Spiels werden entfernt.";
  if (!confirm(message)) return;
  await withDisabled($("#resetSongBattle"), async () => { await store.resetSongBattle(); songReviewNumber = 1; toast(running ? "Song Battle abgebrochen" : "Song Battle zurückgesetzt"); });
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
$("#novitiusThresholdInputs").innerHTML = [3, 2, 1].map((points, index) => `<label>${points} Punkte<input id="novitius-threshold-${index}" type="number" min="0" step="any" required></label>`).join("");
$("#startNovitius").addEventListener("click", async () => {
  if (!confirm("«Wer kennt den Novitius?» starten und die Anmeldung öffnen?")) return;
  await withDisabled($("#startNovitius"), async () => { await store.startNovitiusGame(); toast("Anmeldung geöffnet"); });
});
$("#resetNovitius").addEventListener("click", async () => {
  const running = currentState?.games?.[NOVITIUS_GAME.id]?.status === "running";
  const message = running ? "Novitius-Spiel abbrechen? Das Spiel verschwindet sofort von den Handys. Anmeldungen und Antworten werden gelöscht; die vorbereiteten Fragen bleiben erhalten." : "Spiel vollständig zurücksetzen? Teilnehmende, Antworten und Spielpunkte werden gelöscht. Die vorbereiteten Fragen bleiben erhalten.";
  if (!confirm(message)) return;
  await withDisabled($("#resetNovitius"), async () => { await store.resetNovitiusGame(); novitiusReviewNumber = 1; toast(running ? "Novitius-Spiel abgebrochen" : "Novitius-Spiel zurückgesetzt"); });
});
$("#openNovitiusRegistration").addEventListener("click", async () => { try { await store.setNovitiusRegistration(true); toast("Anmeldung offen"); } catch (error) { toast(error.message); } });
$("#closeNovitiusRegistration").addEventListener("click", async () => { try { await store.setNovitiusRegistration(false); toast("Teilnehmerliste und Teamgrössen fixiert"); } catch (error) { toast(error.message); } });
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
$("#novitiusLiveResultForm").addEventListener("submit", async event => {
  event.preventDefault();
  try { await store.setNovitiusLiveResult($("#novitiusLiveResult").value); toast("Tatsächliches Ergebnis gespeichert"); }
  catch (error) { toast(error.message); }
});
$("#novitiusTieForm").addEventListener("submit", async event => {
  event.preventDefault();
  const teamIds = [...$("#novitiusTieAnswers").querySelectorAll("input[data-tie-team]")].map(input => input.dataset.tieTeam);
  const answers = Object.fromEntries(teamIds.map(id => [id, Number($("#novitiusTieAnswers").querySelector(`[data-tie-team="${id}"]`).value)]));
  try { await store.saveNovitiusTieBreak({ question: $("#novitiusTieQuestion").value, correctValue: Number($("#novitiusTieCorrect").value), teamIds, answers }); toast("Stechen ausgewertet · Resultat kann abgeschlossen werden"); }
  catch (error) { toast(error.message); }
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
$("#novitiusAdminAnswers").addEventListener("click", async event => {
  const button = event.target.closest("button[data-novitius-correct]"); if (!button) return;
  const [participantId, questionNumber] = button.dataset.novitiusCorrect.split("|");
  const input = event.target.closest("div").querySelector("input");
  const question = novitiusAdmin.questions?.[`question-${questionNumber}`];
  const value = question?.type === "time" ? input.value : Number(input.value);
  try { await store.correctNovitiusAnswer(participantId, Number(questionNumber), value); toast("Antwort korrigiert und Wertung neu berechnet"); }
  catch (error) { toast(error.message); }
});
$("#novitiusQuestionList").addEventListener("click", event => { const button = event.target.closest("button[data-novitius-edit]"); if (button) openNovitiusQuestionEditor(Number(button.dataset.novitiusEdit)); });
$("#cancelNovitiusQuestion").addEventListener("click", () => $("#novitiusQuestionForm").classList.add("hidden"));
$("#novitiusQuestionType").addEventListener("change", updateNovitiusCorrectInput);
$("#novitiusQuestionForm").addEventListener("submit", async event => {
  event.preventDefault(); $("#novitiusQuestionMessage").textContent = "";
  const number = Number($("#novitiusQuestionNumber").value);
  try {
    await store.saveNovitiusQuestion(number, { text: $("#novitiusQuestionText").value, type: $("#novitiusQuestionType").value, scoreMode: $("#novitiusScoreMode").value, unit: $("#novitiusQuestionUnit").value, correctValue: $("#novitiusCorrectValue").value, thresholds: [0,1,2].map(index => Number($(`#novitius-threshold-${index}`).value)), liveAnswer: $("#novitiusLiveAnswer").checked });
    $("#novitiusQuestionForm").classList.add("hidden"); toast(`Frage ${number} gespeichert`);
  } catch (error) { $("#novitiusQuestionMessage").textContent = error.message; }
});

$("#challengeReviewRound").innerHTML = Array.from({ length: GAME_CHALLENGES.roundCount }, (_, index) => `<option value="${index + 1}">Runde ${index + 1}</option>`).join("");
$("#startGameChallenges").addEventListener("click", async () => { if (!confirm("Game Challenges mit Runde 1 starten? Bisherige Game-Challenges-Resultate werden ersetzt.")) return; await withDisabled($("#startGameChallenges"), async () => { await store.startGameChallenges(); challengeReviewRound = 1; toast("Game Challenges gestartet"); }); });
$("#resetGameChallenges").addEventListener("click", async () => { const running = currentState?.games?.[GAME_CHALLENGES.id]?.status === "running"; const message = running ? "Game Challenges abbrechen? Das Spiel verschwindet sofort von den Handys und der TV-Ansicht. Alle bereits erfassten Rundenresultate werden gelöscht; die Schätzfragen bleiben erhalten." : "Game Challenges vollständig zurücksetzen? Resultate und Tagespunkte dieses Spiels werden entfernt."; if (!confirm(message)) return; await withDisabled($("#resetGameChallenges"), async () => { await store.resetGameChallenges(); challengeReviewRound = 1; toast(running ? "Game Challenges abgebrochen" : "Game Challenges zurückgesetzt"); }); });
$("#startChallengeTimer").addEventListener("click", async () => { try { await store.startGameChallengeTimer(); } catch (error) { toast(error.message); } });
$("#pauseChallengeTimer").addEventListener("click", async () => { try { await store.pauseGameChallengeTimer(); } catch (error) { toast(error.message); } });
$("#resetChallengeTimer").addEventListener("click", async () => { try { await store.resetGameChallengeTimer(); } catch (error) { toast(error.message); } });
$("#endChallengeRound").addEventListener("click", async () => { try { await store.endGameChallengeRound(); toast("Runde beendet · Resultate erfassen"); } catch (error) { toast(error.message); } });
$("#challengeReviewRound").addEventListener("change", event => { challengeReviewRound = Number(event.target.value); renderGameChallengesAdmin(currentState); });
$("#challengeRoundForm").addEventListener("submit", async event => { event.preventDefault(); $("#challengeRoundMessage").textContent = ""; try { await store.saveGameChallengeRound(challengeReviewRound, collectChallengeRoundEntries()); toast(`Runde ${challengeReviewRound} gespeichert`); } catch (error) { $("#challengeRoundMessage").textContent = error.message; } });
$("#publishChallengeRound").addEventListener("click", async () => { $("#challengeRoundMessage").textContent = ""; try { await store.saveGameChallengeRound(challengeReviewRound, collectChallengeRoundEntries()); await store.publishGameChallengeRound(challengeReviewRound); toast(`Runde ${challengeReviewRound} veröffentlicht`); } catch (error) { $("#challengeRoundMessage").textContent = error.message; } });
$("#nextChallengeRound").addEventListener("click", async () => { try { const next = Number(currentState?.games?.[GAME_CHALLENGES.id]?.currentRound || 1) + 1; await store.nextGameChallengeRound(); challengeReviewRound = next; renderGameChallengesAdmin(currentState); toast("Nächste Runde bereit"); } catch (error) { toast(error.message); } });
$("#challengeEstimateEditors").addEventListener("submit", async event => { const form = event.target.closest("form[data-estimate-question]"); if (!form) return; event.preventDefault(); try { await store.saveGameChallengeEstimateQuestion(form.dataset.estimateQuestion, { text: form.elements.text.value, unit: form.elements.unit.value, correctValue: form.elements.correctValue.value, enabled: form.elements.enabled.checked }); toast("Schätzfrage gespeichert"); } catch (error) { toast(error.message); } });
$("#revealChallengeEstimate").addEventListener("click", async () => { try { await store.revealGameChallengeEstimate(); toast("Schätz-Challenge aufgelöst"); } catch (error) { toast(error.message); } });
$("#finishGameChallenges").addEventListener("click", async () => { const button = $("#finishGameChallenges"); button.disabled = true; $("#challengeFinishMessage").textContent = ""; try { await store.finishGameChallenges(); toast("Game Challenges abgeschlossen · Tagespunkte aktualisiert"); } catch (error) { $("#challengeFinishMessage").textContent = error.message; } finally { button.disabled = false; } });

$("#startBeerPong").addEventListener("click", async () => { if (!confirm("Beer-Pong-Turnier jetzt starten und den Turniermodus auf dem Grossbildschirm aktivieren?")) return; await withDisabled($("#startBeerPong"), async () => { await store.startBeerPong(); toast("Beer-Pong-Turnier gestartet"); }); });
$("#resetBeerPong").addEventListener("click", async () => { const running = currentState?.games?.[BEER_PONG.id]?.status === "running"; const message = running ? "Beer-Pong-Turnier abbrechen? Die Turnieransicht verschwindet sofort. Alle Matchresultate dieses Turniers werden gelöscht." : "Beer-Pong-Turnier vollständig zurücksetzen? Platzierung und Tagespunkte werden entfernt."; if (!confirm(message)) return; await withDisabled($("#resetBeerPong"), async () => { await store.resetBeerPong(); toast(running ? "Beer-Pong-Turnier abgebrochen" : "Beer-Pong-Turnier zurückgesetzt"); }); });
$("#beerPongMatches").addEventListener("click", async event => {
  const round = event.target.closest("button[data-bp-round]");
  if (round) { try { await store.setBeerPongRound(Number(round.dataset.bpRound)); toast(`Runde ${round.dataset.bpRound} ist auf dem TV`); } catch (error) { beerPongError(error); } return; }
  const start = event.target.closest("button[data-bp-start]");
  if (start) { try { await store.startBeerPongMatch(start.dataset.bpStart); toast("Match läuft · TV aktualisiert"); } catch (error) { beerPongError(error); } return; }
  const publish = event.target.closest("button[data-bp-publish]");
  if (publish) { try { await store.publishBeerPongMatch(publish.dataset.bpPublish); toast("Matchresultat veröffentlicht"); } catch (error) { beerPongError(error); } }
});
$("#beerPongMatches").addEventListener("input", event => {
  const form = event.target.closest("form[data-bp-match]"); if (!form || !event.target.matches("input[data-bp-cups]")) return;
  const a = Number(form.elements.cupsHitA.value), b = Number(form.elements.cupsHitB.value);
  if (a !== b && Number.isFinite(a) && Number.isFinite(b)) form.elements.winnerId.value = a > b ? form.dataset.teamA : form.dataset.teamB;
});
$("#beerPongMatches").addEventListener("submit", async event => {
  const form = event.target.closest("form[data-bp-match]"); if (!form) return; event.preventDefault();
  try { await store.saveBeerPongMatch(form.dataset.bpMatch, { cupsHitA: form.elements.cupsHitA.value, cupsHitB: form.elements.cupsHitB.value, winnerId: form.elements.winnerId.value, decidedBy: form.elements.cupsHitA.value === form.elements.cupsHitB.value ? "tiebreak" : "cups" }); toast("Matchresultat gespeichert · noch nicht öffentlich"); }
  catch (error) { beerPongError(error); }
});
$("#saveBeerPongTieBreak").addEventListener("click", async () => { const ranks = {}; $("#beerPongTieInputs").querySelectorAll("select[data-bp-tie-team]").forEach(select => { ranks[select.dataset.bpTieTeam] = Number(select.value); }); try { await store.saveBeerPongTieBreakRanks(ranks); toast("Stechen gespeichert"); } catch (error) { beerPongError(error); } });
$("#evaluateBeerPongGroups").addEventListener("click", async () => { try { await store.evaluateBeerPongGroups(); toast("Gruppenphase ausgewertet"); } catch (error) { beerPongError(error); } });
$("#releaseBeerPongSemifinals").addEventListener("click", async () => { try { await store.releaseBeerPongSemifinals(); toast("Halbfinalpaarungen freigegeben"); } catch (error) { beerPongError(error); } });
$("#releaseBeerPongFinal").addEventListener("click", async () => { try { await store.releaseBeerPongFinal(); toast("Final Battle freigegeben"); } catch (error) { beerPongError(error); } });
$("#finishBeerPong").addEventListener("click", async () => { try { await store.finishBeerPong(); toast("Beer-Pong-Turnier abgeschlossen · Tagespunkte verbucht"); } catch (error) { beerPongError(error); } });
$("#resetBeerPongFinal").addEventListener("click", async () => { if (!confirm("Finale zurücksetzen? Ein vorhandenes Finalresultat und die Turnierpunkte werden entfernt.")) return; try { await store.resetBeerPongFinal(); toast("Finale zurückgesetzt"); } catch (error) { beerPongError(error); } });
$("#resetBeerPongKnockouts").addEventListener("click", async () => { if (!confirm("Gesamte KO-Phase zurücksetzen? Halbfinal- und Finalresultate sowie Turnierpunkte werden entfernt. Die Gruppenspiele bleiben erhalten.")) return; try { await store.resetBeerPongKnockouts(); toast("KO-Phase zurückgesetzt"); } catch (error) { beerPongError(error); } });
$("#revealRegnumWinner").addEventListener("click", async () => { if (!confirm("Jetzt den Gesamtsieger von Regnum Noctis auf allen Seiten enthüllen?")) return; try { await store.revealRegnumWinner(); toast("Gesamtsieger enthüllt"); } catch (error) { beerPongError(error); } });

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
  if (action === "delete" && id === GAME_CHALLENGES.id) {
    if (confirm("Game Challenges vollständig zurücksetzen? Resultate und Punkte werden entfernt; die Schätzfragen bleiben erhalten.")) { await store.resetGameChallenges(); toast("Game Challenges zurückgesetzt"); }
    return;
  }
  if (action === "delete" && id === BEER_PONG.id) {
    if (confirm("Beer-Pong-Turnier vollständig zurücksetzen? Matchresultate, Platzierung und Tagespunkte werden entfernt.")) { await store.resetBeerPong(); toast("Beer-Pong-Turnier zurückgesetzt"); }
    return;
  }
  if (action === "delete" && id === BALLOON_MONSTER.id) {
    if (confirm("Ballon-Monster vollständig zurücksetzen? Resultate, Auslosung und Tagespunkte werden entfernt.")) { await store.resetBalloonMonster(); toast("Ballon-Monster zurückgesetzt"); }
    return;
  }
  if (action === "delete" && confirm("Dieses Resultat wirklich löschen? Die Rangliste wird sofort neu berechnet.")) { await store.deleteGame(id); toast("Resultat gelöscht"); if (editingId === id) resetForm(); }
});

function renderAdmin(state) {
  renderBalloonMonsterAdmin(state);
  renderSongBattleAdmin(state);
  renderNovitiusAdmin(state);
  renderGameChallengesAdmin(state);
  renderBeerPongAdmin(state);
  renderHuntAdmin(state);
  const mode = state.settings.mode || "live";
  document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  $("#modeHelp").textContent = { live: "Rangliste und Resultate sind für alle sichtbar.", frozen: "Publikum sieht keine Punkte – Admin bleibt bedienbar.", final: "Die Siegeransicht wird öffentlich angezeigt." }[mode];
  const games = sortedGames(state.games).filter(hasGameResult);
  $("#adminResults").innerHTML = games.map(game => `<article class="admin-result"><div><span>${formatTime(game.createdAt, true)}</span><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml(game.round || game.resultText || "")}</small></div><div class="admin-actions"><button data-action="edit" data-id="${game.id}">Bearbeiten</button><button class="danger" data-action="delete" data-id="${game.id}">Löschen</button></div></article>`).join("");
  $("#adminEmpty").classList.toggle("hidden", games.length > 0);
}

function renderBalloonMonsterAdmin(state) {
  const game = state?.games?.[BALLOON_MONSTER.id], status = game?.status || "not-started", running = status === "running", completed = status === "completed";
  const phase = effectiveBalloonPhase(game), team = teamById(game?.currentTeamId), remaining = game?.remainingTeamIds?.length ?? TEAMS.length;
  const phaseLabels = { idle: "Nicht gestartet", intro: "Spielstart", wheel: "Auslosung bereit", spinning: "Wappen wechseln", selected: "Ausgelost", timer: "Ballons füllen", course: "Parcours läuft", entry: "Resultat erfassen", result: "Ergebnis veröffentlicht", completed: "Spiel abgeschlossen" };
  $("#balloonMonsterAdminStatus").textContent = GAME_STATUSES[status] || "Noch nicht gestartet";
  $("#balloonMonsterStart").classList.toggle("hidden", status !== "not-started");
  $("#resetBalloonMonster").classList.toggle("hidden", status === "not-started");
  $("#resetBalloonMonster").textContent = running ? "Spiel abbrechen" : "Zurücksetzen";
  $("#resetBalloonMonster").classList.toggle("abort-action", running);
  $("#balloonMonsterControls").classList.toggle("hidden", status === "not-started");
  if (status === "not-started") return;
  $("#balloonMonsterSupply").value = balloonMonsterAdmin.supply;
  $("#balloonRemaining").textContent = `${remaining} / ${TEAMS.length}`;
  $("#balloonCurrentTeam").textContent = team ? `${team.marker} ${team.name}` : completed ? "Alle Reiche gespielt" : "Noch nicht ausgelost";
  $("#balloonCurrentPhase").textContent = phaseLabels[phase] || phase;
  const canDraw = running && !game.currentTeamId && remaining > 0;
  $("#balloonWheelControls").classList.toggle("hidden", !running || (!canDraw && !game.currentTeamId));
  $("#drawBalloonTeam").classList.toggle("hidden", !canDraw);
  $("#drawBalloonTeam").textContent = remaining === 1 ? "Letztes Reich ankündigen" : "Auslosung starten";
  $("#undoBalloonDraw").classList.toggle("hidden", !running || !game.currentTeamId || !!game.publicResults?.[game.currentTeamId]);
  const roundVisible = running && !!game.currentTeamId && !game.publicResults?.[game.currentTeamId];
  $("#balloonRoundControls").classList.toggle("hidden", !roundVisible);
  const timer = game?.timer || {}, remainingMs = balloonTimerRemaining(timer), expired = timer.status === "running" && remainingMs <= 0;
  $("#balloonAdminTimer").textContent = expired ? "ZEIT ABGELAUFEN" : formatCountdown(remainingMs);
  $("#balloonAdminTimerState").textContent = timer.status === "paused" ? "Pausiert" : expired ? "Keine weiteren Ballons mehr" : timer.status === "running" ? "Läuft" : timer.status === "finished" ? "Beendet" : "Bereit";
  $("#startBalloonTimer").classList.toggle("hidden", !roundVisible || !(["spinning", "selected"].includes(game.phase) || timer.status === "paused"));
  $("#startBalloonTimer").textContent = timer.status === "paused" ? "Timer fortsetzen" : "Timer starten";
  $("#pauseBalloonTimer").classList.toggle("hidden", timer.status !== "running" || expired);
  $("#resetBalloonTimer").classList.toggle("hidden", !roundVisible || timer.status === "idle");
  $("#startBalloonCourse").classList.toggle("hidden", !roundVisible || !expired || game.phase === "course");
  $("#finishBalloonCourse").classList.toggle("hidden", !roundVisible || game.phase !== "course");
  $("#balloonResultForm").classList.toggle("hidden", !running || game.phase !== "entry");
  if (running && game.phase === "entry" && team) {
    $("#balloonResultTeam").textContent = `${team.marker} ${team.name} – Resultat`;
    $("#balloonResultValue").max = balloonMonsterAdmin.supply;
    const draft = balloonMonsterAdmin.drafts?.[team.id];
    if (document.activeElement !== $("#balloonResultValue")) $("#balloonResultValue").value = draft?.balloons ?? "";
    $("#balloonResultMessage").textContent = draft ? `✓ Entwurf gespeichert: ${draft.balloons} von maximal ${balloonMonsterAdmin.supply}` : "Noch nicht gespeichert";
  }
  $("#balloonPublishedControls").classList.toggle("hidden", !running || game.phase !== "result" || remaining <= 0);
  const ranked = balloonRanking(game.publicResults);
  $("#balloonAdminRanking").innerHTML = renderBalloonRanking(game, ranked, completed);
  const showCorrections = Object.keys(game.publicResults || {}).length > 0;
  $("#balloonCorrectionSection").classList.toggle("hidden", !showCorrections);
  if (showCorrections) $("#balloonCorrections").innerHTML = TEAMS.filter(item => game.publicResults?.[item.id]).map(item => { const published = game.publicResults[item.id].balloons, draft = balloonMonsterAdmin.drafts?.[item.id]?.balloons ?? published; return `<form data-balloon-correction="${item.id}" style="--team:${item.color}"><strong>${item.marker} ${item.name}</strong><input name="balloons" type="number" min="0" max="${balloonMonsterAdmin.supply}" step="1" value="${Number(draft)}" required><button class="secondary-button" type="submit">Entwurf speichern</button><button class="primary-button" type="button" data-balloon-publish-correction="${item.id}">Korrektur veröffentlichen</button></form>`; }).join("");
  const allPublished = TEAMS.every(item => Number.isInteger(Number(game.publicResults?.[item.id]?.balloons)));
  $("#balloonFinalisation").classList.toggle("hidden", !running || !allPublished || remaining > 0);
}

function renderBalloonRanking(game, ranked = balloonRanking(game?.publicResults), completed = false) {
  const played = new Set(ranked.ranking);
  const rows = ranked.ranking.map(id => { const team = teamById(id); return `<div style="--team:${team.color}"><b>${ranked.placements[id]}.</b><strong>${team.marker} ${team.name}</strong><span>${Number(game.publicResults[id].balloons)} Ballons${completed ? ` · +${Number(game.points?.[id] || 0)}` : ""}</span></div>`; });
  TEAMS.filter(team => !played.has(team.id)).forEach(team => rows.push(`<div class="is-pending" style="--team:${team.color}"><b>–</b><strong>${team.marker} ${team.name}</strong><span>noch nicht gespielt</span></div>`));
  return rows.join("");
}

function effectiveBalloonPhase(game) { return game?.phase === "spinning" && Date.now() >= Number(game.spin?.endsAt || 0) ? "selected" : game?.phase || "idle"; }
function formatCountdown(ms) { const seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function balloonFinalSummary(game) { const ranked = balloonRanking(game?.publicResults); return ranked.ranking.map(id => `${ranked.placements[id]}. ${teamById(id)?.name}: ${game.publicResults[id].balloons} Ballons → +${TEAMS.length + 1 - ranked.placements[id]}`).join("\n"); }
function balloonError(error) { $("#balloonMonsterMessage").textContent = error.message; toast(error.message); }
setInterval(() => {
  const game = currentState?.games?.[BALLOON_MONSTER.id];
  if (game?.status !== "running") return;
  if (game.phase === "spinning" && Date.now() >= Number(game.spin?.endsAt || 0)) $("#balloonCurrentPhase").textContent = "Ausgelost";
  if (game.phase !== "timer" || game.timer?.status !== "running") return;
  const remaining = balloonTimerRemaining(game.timer), expired = remaining <= 0;
  $("#balloonAdminTimer").textContent = expired ? "ZEIT ABGELAUFEN" : formatCountdown(remaining);
  $("#balloonAdminTimerState").textContent = expired ? "Keine weiteren Ballons mehr" : "Läuft";
  if (expired && $("#startBalloonCourse").classList.contains("hidden")) renderBalloonMonsterAdmin(currentState);
}, 250);

function renderBeerPongAdmin(state) {
  const game = state?.games?.[BEER_PONG.id];
  const status = game?.status || "not-started", running = status === "running", completed = status === "completed";
  $("#beerPongAdminStatus").textContent = GAME_STATUSES[status] || GAME_STATUSES["not-started"];
  $("#startBeerPong").classList.toggle("hidden", status !== "not-started");
  $("#beerPongPrestart").classList.toggle("hidden", status !== "not-started");
  $("#resetBeerPong").classList.toggle("hidden", status === "not-started");
  $("#resetBeerPong").classList.toggle("abort-action", running);
  $("#resetBeerPong").textContent = running ? "Turnier abbrechen" : "Zurücksetzen";
  $("#beerPongControls").classList.toggle("hidden", status === "not-started");
  if (status === "not-started") return;

  const phaseLabels = { groups: "Gruppenphase", semifinals: "Halbfinals", final: "The Final Battle", completed: "Turnier beendet" };
  const phaseHelp = {
    groups: "Matches starten, Resultate speichern und danach einzeln veröffentlichen.",
    semifinals: "Die Halbfinalpaarungen basieren auf der freigegebenen Gruppenrangliste.",
    final: "Zehn Becher pro Seite · ohne Zeitlimit.",
    completed: "Die Turnierpunkte sind einmalig in der Tagesrangliste verbucht. Korrekturen bleiben über die Rücksetzbuttons möglich."
  };
  $("#beerPongPhase").textContent = phaseLabels[game.phase] || phaseLabels.groups;
  $("#beerPongPhaseHelp").textContent = phaseHelp[game.phase] || "";

  const matches = beerPongMatchList(game), currentRound = Math.min(3, Math.max(1, Number(game.currentRound) || 1));
  const roundControls = running && game.phase === "groups" ? `<div class="beer-pong-round-switch"><span>Auf dem TV anzeigen:</span>${[1, 2, 3].map(round => `<button type="button" data-bp-round="${round}" class="${currentRound === round ? "active" : ""}">Runde ${round}</button>`).join("")}</div>` : "";
  $("#beerPongMatches").innerHTML = roundControls + matches.map(match => renderBeerPongMatchAdmin(game, match, running)).join("");

  const table = calculateBeerPongGroupTable(game, beerPongAdmin.tieBreakRanks);
  $("#beerPongGroupTable").innerHTML = `<div class="beer-pong-table-head"><span>#</span><span>Reich</span><span>Sp</span><span>S</span><span>P</span><span>Diff.</span><span>Treffer</span></div>${table.standings.map(row => {
    const team = teamById(row.teamId);
    return `<div class="beer-pong-table-row" style="--team:${team?.color || "#888"}"><b>${row.place}</b><strong>${team?.marker || ""} ${escapeHtml(team?.name || row.teamId)}</strong><span>${row.played}</span><span>${row.wins}</span><em>${row.groupPoints}</em><span>${signedNumber(row.cupDifference)}</span><span>${row.cupsHit}</span></div>`;
  }).join("")}`;

  const groupMatches = matches.filter(match => match.stage === "group"), allGroupsPublished = groupMatches.length === 5 && groupMatches.every(match => match.published && match.status === "completed");
  const tieGroups = allGroupsPublished && !game.groupEvaluated ? beerPongTieGroups(game) : [];
  $("#beerPongTieBreak").classList.toggle("hidden", !tieGroups.length);
  $("#beerPongTieInputs").innerHTML = tieGroups.map((teamIds, groupIndex) => `<fieldset><legend>Stechen ${groupIndex + 1}: ${teamIds.map(id => teamById(id)?.name || id).join(" / ")}</legend>${teamIds.map(id => {
    const team = teamById(id), selected = Number(beerPongAdmin.tieBreakRanks?.[id] || 0);
    return `<label style="--team:${team?.color || "#888"}"><span>${team?.marker || ""} ${escapeHtml(team?.name || id)}</span><select data-bp-tie-team="${id}"><option value="">Rang wählen</option>${teamIds.map((_, index) => `<option value="${index + 1}" ${selected === index + 1 ? "selected" : ""}>${index + 1}. im Stechen</option>`).join("")}</select></label>`;
  }).join("")}</fieldset>`).join("");

  const semis = [game.matches?.["semi-1"], game.matches?.["semi-2"]], semisPublished = semis.every(match => match?.published && match.status === "completed");
  const finalPublished = game.matches?.final?.published && game.matches.final.status === "completed";
  $("#evaluateBeerPongGroups").classList.toggle("hidden", !running || game.phase !== "groups" || !allGroupsPublished || !!game.groupEvaluated);
  $("#releaseBeerPongSemifinals").classList.toggle("hidden", !running || !game.groupEvaluated || !!game.semifinalsReleased);
  $("#releaseBeerPongFinal").classList.toggle("hidden", !running || !game.semifinalsReleased || !semisPublished || !!game.finalReleased);
  $("#finishBeerPong").classList.toggle("hidden", !running || !game.finalReleased || !finalPublished);
  $("#resetBeerPongFinal").classList.toggle("hidden", !game.finalReleased);
  $("#resetBeerPongKnockouts").classList.toggle("hidden", !game.semifinalsReleased);
  $("#beerPongRevealSection").classList.toggle("hidden", !completed);
  $("#revealRegnumWinner").classList.toggle("hidden", !!game.finalReveal);
  const revealHeading = $("#beerPongRevealSection h3");
  if (revealHeading) revealHeading.textContent = game.finalReveal ? "✓ Gesamtsieger wurde enthüllt" : "Die Tagesrangliste bleibt auf dem TV eingefroren";
}

function renderBeerPongMatchAdmin(game, match, running) {
  const teamA = teamById(match.teamA), teamB = teamById(match.teamB), draft = beerPongAdmin.drafts?.[match.id], result = draft || (match.published ? match : null);
  const phaseActive = match.stage === "group" ? game.phase === "groups" : match.stage === "semifinal" ? game.phase === "semifinals" : game.phase === "final";
  const editable = running && phaseActive && (match.status === "running" || match.published);
  const status = match.published ? "Veröffentlicht" : draft ? "Gespeichert · nicht öffentlich" : match.status === "running" ? "Läuft" : "Bereit";
  const max = Number(match.cupsPerSide || 6), equal = result && Number(result.cupsHitA) === Number(result.cupsHitB);
  return `<article class="beer-pong-match-card ${match.status === "running" ? "is-live" : ""} ${match.published ? "is-published" : ""}">
    <header><div><span>${escapeHtml(match.label)}</span><strong>${match.stage === "final" ? "THE FINAL BATTLE" : match.stage === "semifinal" ? "HALBFINALE" : "GRUPPENSPIEL"}</strong></div><em ${match.status === "running" && !match.published && match.stage !== "final" ? `data-bp-admin-ends="${Number(match.endsAt || 0)}"` : ""}>${match.status === "running" && !match.published && match.stage !== "final" ? `Läuft · ${beerPongCountdown(match.endsAt)}` : status}</em></header>
    <div class="beer-pong-versus"><div style="--team:${teamA?.color || "#888"}"><img src="${teamA?.logo || ""}" alt=""><b>${teamA?.marker || ""} ${escapeHtml(teamA?.name || match.teamA || "Offen")}</b></div><span>VS</span><div style="--team:${teamB?.color || "#888"}"><img src="${teamB?.logo || ""}" alt=""><b>${teamB?.marker || ""} ${escapeHtml(teamB?.name || match.teamB || "Offen")}</b></div></div>
    ${running && phaseActive && match.status === "pending" ? `<button class="primary-button" type="button" data-bp-start="${match.id}">Match starten${match.stage === "final" ? "" : " · 06:00"}</button>` : ""}
    ${editable ? `<form data-bp-match="${match.id}" data-team-a="${match.teamA}" data-team-b="${match.teamB}"><div class="beer-pong-score-inputs"><label>${escapeHtml(teamA?.name || match.teamA)}<input name="cupsHitA" data-bp-cups type="number" min="0" max="${max}" step="1" value="${result?.cupsHitA ?? ""}" required><small>getroffene Becher</small></label><b>:</b><label>${escapeHtml(teamB?.name || match.teamB)}<input name="cupsHitB" data-bp-cups type="number" min="0" max="${max}" step="1" value="${result?.cupsHitB ?? ""}" required><small>getroffene Becher</small></label></div><label>Sieger bestätigen<select name="winnerId" required><option value="">Bitte wählen</option><option value="${match.teamA}" ${result?.winnerId === match.teamA ? "selected" : ""}>${teamA?.marker || ""} ${escapeHtml(teamA?.name || match.teamA)}</option><option value="${match.teamB}" ${result?.winnerId === match.teamB ? "selected" : ""}>${teamB?.marker || ""} ${escapeHtml(teamB?.name || match.teamB)}</option></select></label>${equal ? '<p class="beer-pong-equal-note">Gleiche Trefferzahl: Sieger nach dem Entscheidungswurf manuell bestätigen.</p>' : ""}<div class="hunt-admin-actions"><button class="secondary-button" type="submit">Resultat speichern</button>${draft ? `<button class="primary-button" type="button" data-bp-publish="${match.id}">${match.published ? "Korrektur veröffentlichen" : "Resultat veröffentlichen"}</button>` : ""}</div></form>` : match.published ? `<div class="beer-pong-public-score"><strong>${Number(match.cupsHitA)} : ${Number(match.cupsHitB)}</strong><span>Sieger: ${escapeHtml(teamById(match.winnerId)?.name || match.winnerId)}</span></div>` : ""}
  </article>`;
}

function beerPongError(error) { $("#beerPongMessage").textContent = error.message; toast(error.message); }
function teamById(id) { return TEAMS.find(team => team.id === id); }
function signedNumber(value) { const number = Number(value || 0); return number > 0 ? `+${number}` : String(number); }
function beerPongCountdown(endsAt) { const seconds = Math.max(0, Math.ceil((Number(endsAt || 0) - Date.now()) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
setInterval(() => document.querySelectorAll("[data-bp-admin-ends]").forEach(element => { element.textContent = `Läuft · ${beerPongCountdown(element.dataset.bpAdminEnds)}`; }), 500);

function renderGameChallengesAdmin(state) {
  const game = state?.games?.[GAME_CHALLENGES.id], status = game?.status || "not-started", running = status === "running", completed = status === "completed";
  if (running && Number(game.currentRound || 1) !== lastChallengeCurrentRound) { lastChallengeCurrentRound = Number(game.currentRound || 1); challengeReviewRound = lastChallengeCurrentRound; }
  challengeReviewRound = Math.min(5, Math.max(1, challengeReviewRound));
  $("#gameChallengesAdminStatus").textContent = GAME_STATUSES[status] || GAME_STATUSES["not-started"];
  $("#startGameChallenges").classList.toggle("hidden", status !== "not-started");
  $("#resetGameChallenges").classList.toggle("hidden", status === "not-started");
  $("#resetGameChallenges").classList.toggle("abort-action", running);
  $("#resetGameChallenges").textContent = running ? "Spiel abbrechen" : "Zurücksetzen";
  $("#gameChallengesControls").classList.toggle("hidden", status === "not-started");
  if (status === "not-started") return;
  const round = Number(game.currentRound || 1), timerStatus = game.timer?.status || "idle";
  $("#challengeCurrentRound").textContent = `Runde ${round} von ${GAME_CHALLENGES.roundCount}`;
  updateChallengeAdminTimer();
  $("#startChallengeTimer").classList.toggle("hidden", !running || timerStatus === "running");
  $("#pauseChallengeTimer").classList.toggle("hidden", !running || timerStatus !== "running");
  $("#resetChallengeTimer").classList.toggle("hidden", !running);
  $("#endChallengeRound").classList.toggle("hidden", !running || game.phase === "results" || game.phase === "published");
  $("#challengeRotation").innerHTML = TEAMS.map(team => { const station = stationById(GAME_CHALLENGE_ROTATIONS[`round-${round}`][team.id]); return `<div style="--team:${team.color}"><span>${team.marker} ${team.name}</span><strong>${station.icon} ${escapeHtml(station.name)}</strong></div>`; }).join("");
  $("#challengeReviewRound").value = String(challengeReviewRound);
  renderChallengeRoundInputs(challengeReviewRound);
  const published = !!game.roundPublished?.[`round-${challengeReviewRound}`];
  $("#publishChallengeRound").textContent = published ? "Veröffentlichung aktualisieren" : "Runde veröffentlichen";
  $("#nextChallengeRound").classList.toggle("hidden", !running || challengeReviewRound !== round || round >= 5 || !published);
  $("#revealChallengeEstimate").classList.toggle("hidden", !!game.estimateRevealed || !running);
  $("#challengeEstimateRevealHelp").textContent = game.estimateRevealed ? "✓ Lösungen und Schätzungen sind veröffentlicht. Korrekturen werden automatisch aktualisiert." : "Die Lösungen und Schätzungen werden erst nach allen fünf veröffentlichten Runden sichtbar.";
  renderChallengeEstimateEditors();
  const finalReady = completed || (!!game.estimateRevealed && Array.from({ length: 5 }, (_, i) => game.roundPublished?.[`round-${i + 1}`]).every(Boolean));
  $("#challengeFinalisation").classList.toggle("hidden", !finalReady);
  if (finalReady) renderChallengeFinalisation(game);
}

function updateChallengeAdminTimer() {
  const game = currentState?.games?.[GAME_CHALLENGES.id]; if (!game || game.status === "not-started") return;
  const remaining = challengeTimerRemaining(game.timer), seconds = Math.ceil(remaining / 1000);
  $("#challengeTimer").textContent = remaining <= 0 && game.timer?.status === "running" ? "WECHSEL" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
setInterval(updateChallengeAdminTimer, 250);

function renderChallengeRoundInputs(round) {
  const assignments = GAME_CHALLENGE_ROTATIONS[`round-${round}`];
  $("#challengeRoundInputs").innerHTML = TEAMS.map(team => {
    const station = stationById(assignments[team.id]);
    if (station.id === "estimate") return `<article style="--team:${team.color}"><header><strong>${team.marker} ${team.name}</strong><span>${station.icon} ${station.name}</span></header>${challengeEstimateQuestions(challengesAdmin).map(question => `<label>${escapeHtml(question.text)}<span><input data-challenge-team="${team.id}" data-estimate="${question.id}" type="number" min="0" step="any" value="${escapeAttribute(question.estimates?.[team.id] ?? "")}" required> ${escapeHtml(question.unit)}</span></label>`).join("")}</article>`;
    const value = challengesAdmin.results?.[station.id]?.[team.id] ?? "";
    return `<article style="--team:${team.color}"><header><strong>${team.marker} ${team.name}</strong><span>${station.icon} ${station.name}</span></header><label>${escapeHtml(station.resultLabel)}<span><input data-challenge-team="${team.id}" data-result="${station.id}" type="number" min="0" ${station.max ? `max="${station.max}"` : ""} step="${station.integer ? 1 : "any"}" value="${escapeAttribute(value)}" required> ${escapeHtml(station.unit)}</span></label></article>`;
  }).join("");
}

function collectChallengeRoundEntries() {
  const entries = Object.fromEntries(TEAMS.map(team => [team.id, { estimates: {} }]));
  $("#challengeRoundInputs").querySelectorAll("input[data-challenge-team]").forEach(input => { const entry = entries[input.dataset.challengeTeam]; if (input.dataset.estimate) entry.estimates[input.dataset.estimate] = input.value; else entry.value = input.value; });
  return entries;
}

function renderChallengeEstimateEditors() {
  const signature = JSON.stringify(challengesAdmin.estimateQuestions); if (signature === challengeEditorSignature) return; challengeEditorSignature = signature;
  $("#challengeEstimateEditors").innerHTML = Object.values(challengesAdmin.estimateQuestions).sort((a, b) => a.number - b.number).map(question => `<form data-estimate-question="${question.id}"><div class="challenge-estimate-head"><strong>Schätzfrage ${question.number}</strong><label><input name="enabled" type="checkbox" ${question.enabled !== false ? "checked" : ""}> aktiv</label></div><label>Frage<input name="text" maxlength="180" value="${escapeAttribute(question.text)}" required></label><div class="form-grid"><label>Einheit<input name="unit" maxlength="30" value="${escapeAttribute(question.unit)}"></label><label>Richtiges Ergebnis<input name="correctValue" type="number" min="0" step="any" value="${escapeAttribute(question.correctValue ?? "")}" placeholder="später möglich"></label></div><button class="secondary-button" type="submit">Schätzfrage speichern</button></form>`).join("");
}

function renderChallengeFinalisation(game) {
  let result = game;
  if (game.status !== "completed") { try { result = calculateGameChallenges(game, challengesAdmin); } catch (error) { $("#challengeFinishMessage").textContent = error.message; return; } }
  $("#challengeFinalRanking").innerHTML = result.ranking.map(teamId => { const team = TEAMS.find(item => item.id === teamId), place = result.placements[teamId]; return `<div class="song-final-row" style="--team:${team.color}"><strong>${place}. ${team.marker} ${team.name}</strong><span>${result.internalPoints[teamId]}/25 · ${result.stationWins[teamId]} Stationssiege · +${result.points[teamId]}</span></div>`; }).join("");
  $("#finishGameChallenges").textContent = completedLabel(game.status);
}

function completedLabel(status) { return status === "completed" ? "Korrekturen übernehmen · Punkte aktualisieren" : "Spiel abschliessen · Tagespunkte vergeben"; }

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
  $("#resetSongBattle").classList.toggle("abort-action", running);
  $("#resetSongBattle").textContent = running ? "Spiel abbrechen" : "Zurücksetzen";
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
  $("#resetNovitius").classList.toggle("abort-action", running);
  $("#resetNovitius").textContent = running ? "Spiel abbrechen" : "Zurücksetzen";
  $("#novitiusControls").classList.toggle("hidden", status === "not-started");
  renderNovitiusQuestionList();
  if (status === "not-started") return;

  const participants = Object.entries(novitiusParticipants);
  $("#novitiusParticipantCount").textContent = `${participants.length} angemeldet`;
  $("#novitiusParticipantList").innerHTML = participants.length ? participants.sort(([, a], [, b]) => a.teamId.localeCompare(b.teamId) || a.playerName.localeCompare(b.playerName)).map(([id, participant]) => {
    const team = TEAMS.find(item => item.id === participant.teamId);
    return `<span style="--team:${team?.color || "#888"}"><i></i>${escapeHtml(participant.playerName)} · ${team?.marker || ""} ${team?.name || participant.teamId}${game.participantsLocked ? "" : `<button type="button" data-novitius-remove="${id}">×</button>`}</span>`;
  }).join("") : '<p class="save-message">Noch niemand angemeldet.</p>';
  $("#openNovitiusRegistration").classList.toggle("hidden", !running || Number(game.currentQuestion || 0) > 0 || game.registrationOpen);
  $("#closeNovitiusRegistration").classList.toggle("hidden", !running || Number(game.currentQuestion || 0) > 0 || !game.registrationOpen);
  $("#novitiusRoundSelect").value = String(novitiusReviewNumber);
  const currentKey = `question-${game.currentQuestion || 0}`, currentQuestionState = game.questionStates?.[currentKey] || "locked";
  $("#startNovitiusQuestion").classList.toggle("hidden", !running || (!!game.currentQuestion && currentQuestionState !== "revealed"));
  $("#nextNovitiusQuestion").classList.toggle("hidden", !running || !game.currentQuestion || currentQuestionState !== "revealed" || Number(game.currentQuestion) >= NOVITIUS_GAME.questionCount);
  $("#novitiusAnswerControls").classList.toggle("hidden", !running || !game.currentQuestion);
  $("#openNovitiusAnswers").classList.add("hidden");
  $("#closeNovitiusAnswers").classList.toggle("hidden", !running || !game.currentQuestion || !game.answersOpen);
  $("#revealNovitiusQuestion").classList.toggle("hidden", !running || !game.currentQuestion || currentQuestionState !== "closed");

  const key = `question-${novitiusReviewNumber}`;
  const markers = state.novitiusSubmissions?.[key] || {}, submitted = Object.keys(markers).length;
  const stateLabels = { locked: "gesperrt", open: "offen", closed: "geschlossen", revealed: "aufgelöst" };
  $("#novitiusRoundStatus").textContent = completed ? "Abgeschlossen · Korrekturen aktualisieren die Tagespunkte." : game.currentQuestion ? `Frage ${game.currentQuestion} von ${NOVITIUS_GAME.questionCount} · ${stateLabels[currentQuestionState]} · ${submitted}/${participants.length} abgegeben` : `Anmeldung ${game.registrationOpen ? "offen" : "geschlossen"} · danach Frage 1 freigeben`;
  $("#novitiusTeamSubmissions").innerHTML = TEAMS.map(team => {
    const count = Object.values(markers).filter(marker => marker.teamId === team.id).length;
    const eligible = game.participantsLocked ? Number(game.teamSizes?.[team.id] || 0) : participants.filter(([, participant]) => participant.teamId === team.id).length;
    return `<div style="--team:${team.color}"><span>${team.marker} ${team.name}</span><strong>${count} / ${eligible}</strong></div>`;
  }).join("");
  const reviewedQuestion = novitiusAdmin.questions?.[key];
  $("#novitiusAdminAnswers").innerHTML = game.currentQuestion ? participants.map(([id, participant]) => {
    const team = TEAMS.find(item => item.id === participant.teamId), answer = novitiusAnswers?.[id]?.[key];
    const inputType = reviewedQuestion?.type === "time" ? "time" : "number", step = inputType === "time" ? "60" : "1";
    return `<div style="--team:${team?.color || "#888"}"><span>${team?.marker || ""} ${escapeHtml(participant.playerName)}</span><input type="${inputType}" step="${step}" value="${escapeAttribute(answer?.value ?? "")}" aria-label="Antwort ${escapeAttribute(participant.playerName)}"><button type="button" data-novitius-correct="${id}|${novitiusReviewNumber}">Korrigieren</button></div>`;
  }).join("") : "";
  const liveResultNeeded = running && Number(game.currentQuestion) === 10 && currentQuestionState === "closed" && (novitiusAdmin.questions?.["question-10"]?.correctValue === "" || novitiusAdmin.questions?.["question-10"]?.correctValue === null || novitiusAdmin.questions?.["question-10"]?.correctValue === undefined);
  $("#novitiusLiveResultForm").classList.toggle("hidden", !liveResultNeeded);
  if (!liveResultNeeded && novitiusAdmin.liveResult !== null && novitiusAdmin.liveResult !== undefined) $("#novitiusLiveResult").value = novitiusAdmin.liveResult;
  const finalReady = completed || !!game.revealedQuestions?.["question-10"];
  $("#novitiusFinalisation").classList.toggle("hidden", !finalReady);
  $("#finishNovitius").textContent = completed ? "Resultat neu berechnen" : "Spiel abschliessen · Punkte vergeben";
  renderNovitiusTieBreak(game, finalReady);
}

function renderNovitiusTieBreak(game, finalReady) {
  if (!finalReady || game?.tieBreak?.ranking?.length) { $("#novitiusTieBreak").classList.add("hidden"); return; }
  const standings = calculateNovitiusStandings(game), groups = novitiusTieGroups(standings.internalPoints, standings.perfectRates);
  const teamIds = [...new Set(groups.flatMap(group => group.teamIds))];
  $("#novitiusTieBreak").classList.toggle("hidden", !teamIds.length);
  if (!teamIds.length) return;
  $("#novitiusTieHelp").textContent = `⚠️ Gleichstand nach Spielpunkten und normalisierten Volltreffern: ${teamIds.map(id => TEAMS.find(team => team.id === id)?.name).join(", ")}`;
  $("#novitiusTieAnswers").innerHTML = teamIds.map(id => { const team = TEAMS.find(item => item.id === id); return `<label>${team.marker} ${team.name}<input data-tie-team="${id}" type="number" step="any" required></label>`; }).join("");
}

function calculateNovitiusStandings(game) {
  const totals = Object.fromEntries(TEAMS.map(team => [team.id, 0])), perfects = Object.fromEntries(TEAMS.map(team => [team.id, 0]));
  Object.entries(novitiusParticipants).forEach(([participantId, participant]) => {
    for (let number = 1; number <= NOVITIUS_GAME.questionCount; number += 1) {
      const answer = novitiusAnswers?.[participantId]?.[`question-${number}`], question = novitiusAdmin.questions?.[`question-${number}`];
      if (!answer || !question) continue;
      const points = scoreNovitiusAnswer(question, answer.value).points;
      totals[participant.teamId] += points;
      if (points === 3) perfects[participant.teamId] += 1;
    }
  });
  return {
    internalPoints: Object.fromEntries(TEAMS.map(team => [team.id, Number(game?.teamSizes?.[team.id] || 0) ? totals[team.id] / Number(game.teamSizes[team.id]) : 0])),
    perfectRates: Object.fromEntries(TEAMS.map(team => [team.id, Number(game?.teamSizes?.[team.id] || 0) ? perfects[team.id] / Number(game.teamSizes[team.id]) : 0]))
  };
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
  $("#novitiusScoreMode").value = question.scoreMode || (question.type === "time" ? "time" : "absolute");
  $("#novitiusQuestionUnit").value = question.unit || "";
  $("#novitiusCorrectValue").value = question.correctValue ?? "";
  [0,1,2].forEach(index => { $(`#novitius-threshold-${index}`).value = Number(question.thresholds?.[index] || 0); });
  $("#novitiusLiveAnswer").checked = !!question.liveAnswer;
  updateNovitiusCorrectInput();
  $("#novitiusQuestionForm").classList.remove("hidden");
  $("#novitiusQuestionForm").scrollIntoView({ behavior: "smooth", block: "center" });
}

function updateNovitiusCorrectInput() {
  const time = $("#novitiusQuestionType").value === "time";
  $("#novitiusCorrectValue").type = time ? "time" : "number";
  $("#novitiusCorrectValue").step = time ? "60" : "any";
  if (time) $("#novitiusScoreMode").value = "time";
}

function formatNovitiusValue(value, unit = "") {
  const formatted = typeof value === "number" ? new Intl.NumberFormat("de-CH", { maximumFractionDigits: 2 }).format(value) : value;
  return `${formatted}${unit ? ` ${unit}` : ""}`;
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

function loadEdit(id) { if (id === BALLOON_MONSTER.id) { renderBalloonMonsterAdmin(currentState); $("#balloonMonsterAdminPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; } if (id === SONG_BATTLE.id) { songReviewNumber = 1; renderSongBattleAdmin(currentState); $("#songBattleAdminPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; } if (id === NOVITIUS_GAME.id) { novitiusReviewNumber = 1; renderNovitiusAdmin(currentState); $("#novitiusAdminPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; } if (id === GAME_CHALLENGES.id) { challengeReviewRound = 1; renderGameChallengesAdmin(currentState); $("#gameChallengesAdminPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; } if (id === BEER_PONG.id) { renderBeerPongAdmin(currentState); $("#beerPongAdminPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; } const game = currentState.games[id]; if (!game) return; editingId = id; $("#formTitle").textContent = "Resultat korrigieren"; $("#cancelEdit").classList.remove("hidden"); $("#gameName").value = game.name || ""; $("#roundName").value = game.round || ""; $("#resultText").value = game.resultText || ""; TEAMS.forEach(team => $(`#score-${team.id}`).value = Number(game.points?.[team.id] || 0)); $("#resultForm").scrollIntoView({ behavior: "smooth", block: "start" }); }
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
  if (granted && !challengesAdminUnsubscribe) challengesAdminUnsubscribe = store.subscribeGameChallengesAdmin(value => { challengesAdmin = value; challengeEditorSignature = ""; if (currentState) renderGameChallengesAdmin(currentState); });
  if (granted && !beerPongAdminUnsubscribe) beerPongAdminUnsubscribe = store.subscribeBeerPongAdmin(value => { beerPongAdmin = value; if (currentState) renderBeerPongAdmin(currentState); });
  if (granted && !balloonMonsterAdminUnsubscribe) balloonMonsterAdminUnsubscribe = store.subscribeBalloonMonsterAdmin(value => { balloonMonsterAdmin = value; if (currentState) renderBalloonMonsterAdmin(currentState); });
  if (granted && !huntAdminUnsubscribe) huntAdminUnsubscribe = store.subscribeHuntAdmin(value => { huntAdmin = value; huntTargetSignature = ""; if (currentState) renderHuntAdmin(currentState); });
  if (!granted && songAnswersUnsubscribe) { songAnswersUnsubscribe(); songAnswersUnsubscribe = null; songAnswers = {}; }
  if (!granted && songParticipantsUnsubscribe) { songParticipantsUnsubscribe(); songParticipantsUnsubscribe = null; songParticipants = {}; }
  if (!granted && songAdminUnsubscribe) { songAdminUnsubscribe(); songAdminUnsubscribe = null; songAdmin = { evaluations: {}, internalPoints: {} }; }
  if (!granted && novitiusAdminUnsubscribe) { novitiusAdminUnsubscribe(); novitiusAdminUnsubscribe = null; novitiusAdmin = { questions: {} }; }
  if (!granted && novitiusParticipantsUnsubscribe) { novitiusParticipantsUnsubscribe(); novitiusParticipantsUnsubscribe = null; novitiusParticipants = {}; }
  if (!granted && novitiusAnswersUnsubscribe) { novitiusAnswersUnsubscribe(); novitiusAnswersUnsubscribe = null; novitiusAnswers = {}; }
  if (!granted && challengesAdminUnsubscribe) { challengesAdminUnsubscribe(); challengesAdminUnsubscribe = null; challengesAdmin = normaliseGameChallengesAdmin(); challengeEditorSignature = ""; }
  if (!granted && beerPongAdminUnsubscribe) { beerPongAdminUnsubscribe(); beerPongAdminUnsubscribe = null; beerPongAdmin = normaliseBeerPongAdmin(); }
  if (!granted && balloonMonsterAdminUnsubscribe) { balloonMonsterAdminUnsubscribe(); balloonMonsterAdminUnsubscribe = null; balloonMonsterAdmin = normaliseBalloonMonsterAdmin(); }
  if (!granted && huntAdminUnsubscribe) { huntAdminUnsubscribe(); huntAdminUnsubscribe = null; huntAdmin = { targets: normaliseHuntTargets() }; huntTargetSignature = ""; }
}
function humanAuthError(code) { return ({ "auth/invalid-credential": "E-Mail oder Passwort ist falsch.", "auth/too-many-requests": "Zu viele Versuche. Bitte kurz warten.", "auth/network-request-failed": "Keine Verbindung. Bitte Internet prüfen." })[code] || "Login fehlgeschlagen."; }
function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }
function escapeAttribute(value = "") { return escapeHtml(String(value)).replaceAll('"', "&quot;"); }
