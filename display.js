import { TEAMS, totalsFromGames, formatTime, NOVITIUS_GAME } from "./data.js?v=ballon-monster-1";
import { getStore } from "./store.js?v=ballon-monster-1";
import { huntFinds, huntProgress } from "./hunt-data.js?v=ballon-monster-1";
import { GAME_CHALLENGES, GAME_CHALLENGE_ROTATIONS, stationById, challengeTimerRemaining } from "./challenges-data.js?v=ballon-monster-1";
import { BEER_PONG, beerPongMatchList, calculateBeerPongGroupTable } from "./beer-pong-data.js?v=ballon-monster-1";
import { BALLOON_MONSTER, balloonTimerRemaining, balloonRanking } from "./balloon-monster-data.js?v=ballon-monster-1";

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
  renderBalloonMonster(state);
  renderBeerPong(state, totals);
  $("#displayUpdated").textContent = state.settings.updatedAt ? `Stand ${formatTime(state.settings.updatedAt)}` : "";
}

function renderBalloonMonster(state) {
  const game = state.games?.[BALLOON_MONSTER.id], beer = state.games?.[BEER_PONG.id];
  const beerVisible = beer?.status === "running" || (beer?.status === "completed" && !beer.finalReveal);
  const visible = !beerVisible && (game?.status === "running" || (game?.status === "completed" && Date.now() - Number(game.updatedAt || 0) < 30000));
  document.body.classList.toggle("balloon-monster-active", visible);
  $("#displayBalloonMonster").classList.toggle("hidden", !visible);
  if (!visible) return;
  $("#displayBalloonMonster").innerHTML = balloonMonsterArena(game);
}

function balloonMonsterArena(game) {
  const phase = game.phase === "spinning" && Date.now() >= Number(game.spin?.endsAt || 0) ? "selected" : game.phase;
  const team = teamById(game.currentTeamId), ranking = balloonRanking(game.publicResults);
  const head = `<header class="balloon-tv-head"><div><p class="eyebrow">Spiel 1 · Die Prüfung der fünf Reiche</p><h1>🎈 Ballon-Monster</h1></div><span>${game.status === "completed" ? "Abgeschlossen" : `${Number(game.remainingTeamIds?.length || 0)} Reiche im Rad`}</span></header>`;
  if (game.status === "completed") return `${head}<div class="balloon-tv-final"><p>DIE PRÜFUNG IST ENTSCHIEDEN</p><h2>Endrangliste</h2>${balloonTvRanking(game, ranking, true)}<strong>${(game.winnerIds || []).map(id => teamById(id)?.name).join(" & ")} triumphiert${(game.winnerIds || []).length > 1 ? "en" : ""}!</strong></div>`;
  if ((phase === "intro" || phase === "wheel") && !team) return `${head}<div class="balloon-tv-intro"><div class="balloon-orbit">${TEAMS.map((item, index) => `<img src="${item.logo}" alt="" style="--i:${index};--team:${item.color}">`).join("")}</div><p>DIE PRÜFUNG DER FÜNF REICHE</p><h2>${phase === "intro" ? "Das Ballon-Monster erwacht" : "Das Glücksrad ist bereit"}</h2></div>`;
  if (phase === "spinning") return `${head}${balloonWheel(game)}<p class="balloon-wheel-call">DAS SCHICKSAL ENTSCHEIDET …</p>`;
  if (phase === "selected") return `${head}<div class="balloon-team-call" style="--team:${team?.color || "#888"}"><img src="${team?.logo || ""}" alt=""><p>${team?.marker || ""} ${escapeHtml(team?.name || "")}</p><h2>MACHT EUCH BEREIT!</h2></div>`;
  if (phase === "timer") {
    const remaining = balloonTimerRemaining(game.timer), expired = game.timer?.status === "running" && remaining <= 0;
    return `${head}<div class="balloon-tv-timer ${expired ? "expired" : ""}" style="--team:${team?.color || "#888"}"><img src="${team?.logo || ""}" alt=""><p>${team?.marker || ""} ${escapeHtml(team?.name || "")}</p><strong>${expired ? "ZEIT ABGELAUFEN!" : formatCountdown(remaining)}</strong><h2>${expired ? "Keine weiteren Ballons!" : game.timer?.status === "paused" ? "PAUSE" : "FÜLLT DAS BALLON-MONSTER!"}</h2></div>`;
  }
  if (phase === "course" || phase === "entry") return `${head}<div class="balloon-team-call balloon-course" style="--team:${team?.color || "#888"}"><img src="${team?.logo || ""}" alt=""><p>${team?.marker || ""} ${escapeHtml(team?.name || "")}</p><h2>${phase === "course" ? "DER PARCOURS LÄUFT" : "BALLONS WERDEN GEZÄHLT"}</h2><span>${phase === "course" ? "Wie viele Ballons schafft ihr ins Ziel?" : "Die Spielleitung prüft das Resultat …"}</span></div>`;
  if (phase === "result") return `${head}<div class="balloon-tv-result" style="--team:${team?.color || "#888"}"><img src="${team?.logo || ""}" alt=""><div><p>${team?.marker || ""} ${escapeHtml(team?.name || "")}</p><strong>${Number(game.publicResults?.[team?.id]?.balloons || 0)} BALLONS GERETTET!</strong></div></div>${balloonTvRanking(game, ranking)}`;
  return `${head}<div class="balloon-tv-intro"><h2>Bereit für das nächste Reich</h2></div>`;
}

function balloonWheel(game) {
  const ids = TEAMS.map(team => team.id).filter(id => id === game.currentTeamId || game.remainingTeamIds?.includes(id)), selectedIndex = ids.indexOf(game.currentTeamId), segment = 360 / ids.length, finalAngle = 1800 + (360 - (selectedIndex * segment + segment / 2));
  const gradient = ids.map((id, index) => { const team = teamById(id); return `${team?.color || "#777"} ${index * segment}deg ${(index + 1) * segment}deg`; }).join(",");
  return `<div class="balloon-wheel-stage"><div class="balloon-wheel-pointer">▼</div><div class="balloon-wheel spinning" style="--wheel-gradient:conic-gradient(${gradient});--wheel-end:${finalAngle}deg;--segments:${ids.length}">${ids.map((id, index) => { const item = teamById(id), angle = index * segment + segment / 2; return `<span style="--angle:${angle}deg"><img src="${item.logo}" alt=""><b>${escapeHtml(item.name)}</b></span>`; }).join("")}</div></div>`;
}

function balloonTvRanking(game, ranked = balloonRanking(game.publicResults), final = false) {
  const played = new Set(ranked.ranking), rows = ranked.ranking.map(id => { const team = teamById(id); return `<li style="--team:${team.color}"><b>${ranked.placements[id]}.</b><img src="${team.logo}" alt=""><strong>${team.marker} ${team.name}</strong><span>${game.publicResults[id].balloons} Ballons${final ? ` · +${Number(game.points?.[id] || 0)}` : ""}</span></li>`; });
  TEAMS.filter(team => !played.has(team.id)).forEach(team => rows.push(`<li class="pending" style="--team:${team.color}"><b>–</b><img src="${team.logo}" alt=""><strong>${team.marker} ${team.name}</strong><span>noch nicht gespielt</span></li>`));
  return `<ol class="balloon-tv-ranking">${rows.join("")}</ol>`;
}

function formatCountdown(ms) { const seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
setInterval(() => { if (currentState) renderBalloonMonster(currentState); }, 250);

function renderBeerPong(state, totals) {
  const game = state.games?.[BEER_PONG.id], tournamentVisible = game?.status === "running" || (game?.status === "completed" && !game.finalReveal);
  const winnerVisible = game?.status === "completed" && game.finalReveal;
  document.body.classList.toggle("beer-pong-active", tournamentVisible);
  document.body.classList.toggle("regnum-winner-active", winnerVisible);
  $("#displayBeerPong").classList.toggle("hidden", !tournamentVisible);
  $("#displayRegnumWinner").classList.toggle("hidden", !winnerVisible);
  if (tournamentVisible) $("#displayBeerPong").innerHTML = beerPongArena(game);
  if (winnerVisible) renderRegnumWinner(totals);
}

function beerPongArena(game) {
  if (game.status === "completed") {
    const champion = teamById(game.ranking?.[0]);
    return `<div class="beer-pong-arena-head"><div><p class="eyebrow">Battle of the Five Realms</p><h1>🍺 Beer Pong</h1></div><span>Turnier beendet</span></div><div class="beer-pong-champion" style="--team:${champion?.color || "#d9b665"}"><p>Turniersieger</p><img src="${champion?.logo || ""}" alt=""><h2>🏆 ${escapeHtml(champion?.name || "")}</h2><ol>${(game.ranking || []).map((id, index) => { const team = teamById(id); return `<li style="--team:${team?.color || "#888"}"><b>${index + 1}. ${team?.marker || ""} ${escapeHtml(team?.name || id)}</b><span>+${Number(game.points?.[id] || 0)}</span></li>`; }).join("")}</ol><strong>Die Tagesrangliste bleibt verborgen</strong><small>Wartet auf die Enthüllung des Regnum-Noctis-Siegers …</small></div>`;
  }
  const phase = game.phase || "groups";
  return `<div class="beer-pong-arena-head"><div><p class="eyebrow">Battle of the Five Realms</p><h1>🍺 Beer Pong</h1></div><span>${phase === "groups" ? "Gruppenphase" : phase === "semifinals" ? "Halbfinals" : "The Final Battle"}</span></div>${phase === "groups" ? beerPongGroups(game) : phase === "semifinals" ? beerPongSemifinals(game) : beerPongFinal(game)}${beerPongRules(phase)}`;
}

function beerPongGroups(game) {
  const matches = beerPongMatchList(game).filter(match => match.stage === "group"), table = calculateBeerPongGroupTable(game), round = Math.min(3, Math.max(1, Number(game.currentRound) || 1));
  const roundMatches = matches.filter(match => Number(match.round) === round);
  return `<div class="beer-pong-groups"><section class="beer-pong-current-round"><div class="beer-pong-current-round-head"><div><p class="eyebrow">Aktuell aufgeschaltet</p><h2>Runde ${round} <small>von 3</small></h2></div><span>${roundMatches.length > 1 ? `${roundMatches.length} Matches gleichzeitig` : "Letztes Gruppenspiel"}</span></div><div class="beer-pong-round-match-grid ${roundMatches.length === 1 ? "single" : ""}">${roundMatches.map(renderBeerPongRoundMatch).join("")}</div><div class="beer-pong-round-dots">${[1, 2, 3].map(number => `<i class="${number === round ? "active" : number < round ? "done" : ""}">${number}</i>`).join("")}</div></section><div class="beer-pong-tv-table"><p class="eyebrow">Live-Tabelle</p><h2>Gruppenrangliste</h2><header><span>#</span><span>Reich</span><span>Sp</span><span>P</span><span>Diff.</span></header>${table.standings.map(row => { const team = teamById(row.teamId); return `<div style="--team:${team?.color || "#888"}"><b>${row.place}</b><strong>${team?.marker || ""} ${escapeHtml(team?.name || row.teamId)}</strong><span>${row.played}</span><em>${row.groupPoints}</em><span>${signedNumber(row.cupDifference)}</span></div>`; }).join("")}</div></div>`;
}

function renderBeerPongRoundMatch(match) {
  const a = teamById(match.teamA), b = teamById(match.teamB);
  const middle = match.published ? `<span>Endstand</span><strong>${Number(match.cupsHitA)} : ${Number(match.cupsHitB)}</strong><em>🏆 ${escapeHtml(teamById(match.winnerId)?.name || match.winnerId)}</em>` : match.status === "running" ? `<span class="is-live">● LIVE</span><strong data-bp-ends="${Number(match.endsAt || 0)}">${beerPongCountdown(match.endsAt)}</strong><em>Match läuft</em>` : `<span>${escapeHtml(match.label)}</span><strong>VS</strong><em>Bereit</em>`;
  return `<article class="beer-pong-round-match ${match.status === "running" ? "is-live" : ""} ${match.published ? "is-finished" : ""}"><div class="beer-pong-round-team" style="--team:${a?.color || "#888"}"><img src="${a?.logo || ""}" alt=""><b>${escapeHtml(a?.name || match.teamA)}</b></div><div class="beer-pong-round-score">${middle}</div><div class="beer-pong-round-team" style="--team:${b?.color || "#888"}"><img src="${b?.logo || ""}" alt=""><b>${escapeHtml(b?.name || match.teamB)}</b></div><small>${escapeHtml(match.label)}</small></article>`;
}

function beerPongRules(phase) {
  const final = phase === "final";
  return `<section class="beer-pong-rules"><div><p class="eyebrow">Kurzregeln</p><strong>${final ? "Final · 10 Becher" : phase === "semifinals" ? "Halbfinals · 6 Becher" : "Gruppenphase · 6 Becher"}</strong><span>Gespielt wird mit 2 Bällen</span></div><ul><li>Ellenbogen hinter der Tischkante</li><li>Bodenaufsetzer = kein Treffer</li><li>${final ? "Gleicher Becher = 2 Becher trinken" : "Beide Bälle im gleichen Becher = 2 Becher"}</li><li>Keine Trickshots · kein Wegblasen</li></ul></section>`;
}

function beerPongSemifinals(game) {
  const semi1 = game.matches?.["semi-1"], semi2 = game.matches?.["semi-2"];
  return `<div class="beer-pong-knockout"><p class="beer-pong-callout">Vier Reiche. Zwei Duelle. Ein Finale.</p><div class="beer-pong-semi-grid">${[semi1, semi2].filter(Boolean).map(renderBeerPongDisplayMatch).join("")}</div><div class="beer-pong-final-placeholder"><span>THE FINAL BATTLE</span><strong>${[semi1, semi2].every(match => match?.published) ? "Bereit zur Freigabe" : "Die Sieger ziehen ins Finale ein"}</strong></div></div>`;
}

function beerPongFinal(game) {
  const final = game.matches?.final, teamA = teamById(final?.teamA), teamB = teamById(final?.teamB);
  return `<div class="beer-pong-final-stage"><p class="beer-pong-callout">THE FINAL BATTLE</p><div class="beer-pong-finalists"><div style="--team:${teamA?.color || "#888"}"><img src="${teamA?.logo || ""}" alt=""><strong>${escapeHtml(teamA?.name || "")}</strong></div><b>VS</b><div style="--team:${teamB?.color || "#888"}"><img src="${teamB?.logo || ""}" alt=""><strong>${escapeHtml(teamB?.name || "")}</strong></div></div>${renderBeerPongFinalStatus(final)}<div class="beer-pong-semi-recap">${[game.matches?.["semi-1"], game.matches?.["semi-2"]].filter(Boolean).map(renderBeerPongDisplayMatch).join("")}</div></div>`;
}

function renderBeerPongFinalStatus(match) {
  if (match?.published) return `<div class="beer-pong-final-result"><span>Finalresultat</span><strong>${Number(match.cupsHitA)} : ${Number(match.cupsHitB)}</strong><em>🏆 ${escapeHtml(teamById(match.winnerId)?.name || match.winnerId)}</em></div>`;
  if (match?.status === "running") return `<div class="beer-pong-final-result is-live"><span>● LIVE · 10 Becher · kein Zeitlimit</span><strong>Das Finale läuft</strong></div>`;
  return `<div class="beer-pong-final-result"><span>10 Becher · kein Zeitlimit</span><strong>Bereit für das Finale</strong></div>`;
}

function renderBeerPongDisplayMatch(match) {
  const a = teamById(match.teamA), b = teamById(match.teamB);
  const result = match.published ? `<strong>${Number(match.cupsHitA)} : ${Number(match.cupsHitB)}</strong><em>🏆 ${escapeHtml(teamById(match.winnerId)?.name || match.winnerId)}</em>` : match.status === "running" ? `<strong class="beer-pong-live" data-bp-ends="${Number(match.endsAt || 0)}">${match.stage === "final" ? "LIVE" : beerPongCountdown(match.endsAt)}</strong><em>● Match läuft</em>` : `<strong>– : –</strong><em>Bereit</em>`;
  return `<article class="beer-pong-tv-match ${match.status === "running" ? "is-live" : ""}"><span>${escapeHtml(match.label)}</span><div><b style="--team:${a?.color || "#888"}">${a?.marker || ""} ${escapeHtml(a?.name || match.teamA || "Offen")}</b>${result}<b style="--team:${b?.color || "#888"}">${b?.marker || ""} ${escapeHtml(b?.name || match.teamB || "Offen")}</b></div></article>`;
}

function renderRegnumWinner(totals) {
  const best = Math.max(...TEAMS.map(team => Number(totals[team.id] || 0))), winners = TEAMS.filter(team => Number(totals[team.id] || 0) === best);
  $("#displayRegnumWinner").innerHTML = `<div class="regnum-winner-rays"></div><p class="eyebrow">Das Schicksal ist entschieden</p><h1>${winners.length > 1 ? "Herrscher des Regnum Noctis 2026" : "Herrscher des Regnum Noctis 2026"}</h1><div class="regnum-winner-crests">${winners.map(team => `<article style="--team:${team.color}"><img src="${team.logo}" alt=""><h2>${team.marker} ${escapeHtml(team.name)}</h2><strong>${best} Punkte</strong></article>`).join("")}</div><p>Die Nacht gehört euch.</p>`;
}

function beerPongCountdown(endsAt) { const seconds = Math.max(0, Math.ceil((Number(endsAt || 0) - Date.now()) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function updateBeerPongTimers() { document.querySelectorAll("[data-bp-ends]").forEach(element => { element.textContent = beerPongCountdown(element.dataset.bpEnds); }); }
setInterval(updateBeerPongTimers, 500);
function teamById(id) { return TEAMS.find(team => team.id === id); }
function signedNumber(value) { const number = Number(value || 0); return number > 0 ? `+${number}` : String(number); }

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
