import { TEAMS, totalsFromGames, sortedGames, formatTime, SONG_BATTLE, NOVITIUS_GAME, hasGameResult } from "./data.js?v=participants-20261010-1";
import { getStore } from "./store.js?v=participants-20261010-1";
import { TEAM_STORIES, getPlayerProfile, savePlayerProfile, clearPlayerProfile } from "./player.js?v=participants-20261010-1";
import { GAME_CHALLENGES } from "./challenges-data.js?v=participants-20261010-1";
import { BEER_PONG } from "./beer-pong-data.js?v=participants-20261010-1";
import { BALLOON_MONSTER } from "./balloon-monster-data.js?v=participants-20261010-1";
import { renderRanking } from "./ranking-motion.js?v=ranking-polish-20261010-1";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let previousLeader = sessionStorage.getItem("regnum-leader"), currentState = null, victoryTimer = null;
let songTeamId = null, songTeamUnsubscribe = null, songSubscriptionToken = 0, songOwnAnswers = {}, songParticipant = null, songParticipantOwned = false, songDraftKey = null, songDraftDirty = false;

store.subscribe(render);
$("#connectionText").textContent = window.regnumConnectionState === true ? "Live verbunden" : "Verbindung wird hergestellt";
document.body.classList.add("ready");
setupOnboarding();
window.addEventListener("regnum-player-changed", () => {
  highlightOwnRealm();
  ensureSongTeamSubscription();
  if (currentState?.settings?.mode === "live") {
    maybeCelebrateGameWinner(currentState.games?.[SONG_BATTLE.id], SONG_BATTLE.id);
    maybeCelebrateGameWinner(currentState.games?.[NOVITIUS_GAME.id], NOVITIUS_GAME.id);
    maybeCelebrateGameWinner(currentState.games?.[GAME_CHALLENGES.id], GAME_CHALLENGES.id);
    maybeCelebrateGameWinner(currentState.games?.[BALLOON_MONSTER.id], BALLOON_MONSTER.id);
  }
});
$("#victoryCelebration").addEventListener("click", hideVictoryCelebration);
$("#claimSongBattle").addEventListener("click", async () => {
  const profile = getPlayerProfile();
  if (!profile) return;
  const button = $("#claimSongBattle");
  button.disabled = true;
  $("#songBattleMessage").textContent = "";
  try {
    const result = await store.claimSongBattleTeam(profile);
    if (!result.claimed) $("#songBattleMessage").textContent = `${result.participant?.playerName || "Eine andere Person"} nimmt bereits für euer Reich teil.`;
  } catch (error) { $("#songBattleMessage").textContent = `Teilnahme fehlgeschlagen: ${error.message}`; }
  finally { button.disabled = false; }
});
$("#songBattleTitle").addEventListener("input", () => { songDraftDirty = true; });
$("#songBattleArtist").addEventListener("input", () => { songDraftDirty = true; });
$("#songBattleAnswerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const profile = getPlayerProfile();
  const game = currentState?.games?.[SONG_BATTLE.id];
  if (!profile || game?.status !== "running" || !game.answersOpen) return;
  const button = $("#saveSongBattleAnswer");
  button.disabled = true;
  $("#songBattleMessage").textContent = "";
  try {
    await store.submitSongBattleAnswer(game.currentSong, profile, $("#songBattleTitle").value, $("#songBattleArtist").value);
    songDraftDirty = false;
    $("#songBattleSaved").classList.remove("hidden");
  } catch (error) {
    $("#songBattleMessage").textContent = error.message === "song-battle-closed" ? "Die Antworten wurden inzwischen geschlossen." : error.message === "song-battle-empty" ? "Bitte mindestens Titel oder Interpret eintragen." : error.message === "song-battle-not-participant" ? "Für euer Reich nimmt bereits eine andere Person teil." : `Speichern fehlgeschlagen: ${error.message}`;
  } finally { button.disabled = false; }
});

function setupOnboarding() {
  let selectedTeamId = null;
  let pendingProfile = null;
  let membership = null, membershipUid = null, joining = false;
  const onboarding = $("#onboarding");
  $("#teamChoices").innerHTML = TEAMS.map(team => `
    <label class="team-choice" style="--team:${team.color}">
      <input type="radio" name="realm" value="${team.id}">
      <span><img src="${team.logo}" alt=""><b>${team.name}</b><small>${team.title}</small></span>
    </label>`).join("");

  const open = () => {
    const current = getPlayerProfile();
    $("#playerName").value = current?.name || "";
    selectedTeamId = current?.teamId || null;
    document.querySelectorAll('input[name="realm"]').forEach(input => { input.checked = input.value === selectedTeamId; });
    $("#storyStep").classList.add("hidden");
    $("#joinStep").classList.remove("hidden");
    onboarding.classList.remove("hidden");
    document.body.classList.add("onboarding-open");
    updateJoinStatus();
  };

  const close = profile => {
    onboarding.classList.add("hidden");
    document.body.classList.remove("onboarding-open");
    const team = TEAMS.find(item => item.id === profile?.teamId);
    $("#playerBadge").classList.toggle("hidden", !team);
    $("#joinBtn").classList.toggle("hidden", !!team);
    if (team) $("#playerBadge").innerHTML = `<img src="${team.logo}" alt=""> <span>${escapeHtml(profile.name)} · ${team.name}</span>`;
  };
  function updateJoinStatus() {
    const paused = currentState?.settings?.registrationOpen === false && !membership;
    $("#joinStatus").textContent = paused ? "Der Beitritt ist pausiert. Bitte bei der Spielleitung melden. Die Rangliste bleibt sichtbar." : membership ? "Dein Name und Reich sind für dieses Gerät registriert. Änderungen übernimmt die Spielleitung." : "";
    $("#joinForm button[type=submit]").disabled = paused || joining;
    $("#enterRealm").disabled = paused || joining;
    $("#playerName").readOnly = !!membership;
    document.querySelectorAll('input[name="realm"]').forEach(input => { input.disabled = !!membership; });
    if (paused && !$("#storyStep").classList.contains("hidden")) $("#storyError").textContent = "Der Beitritt wurde inzwischen pausiert.";
  }
  store.subscribe(updateJoinStatus);
  store.subscribePlayer((player, uid) => {
    const removed = membership && membershipUid === uid && !player;
    membership = player; membershipUid = uid;
    if (removed) {
      clearPlayerProfile(); close(null); open();
      $("#joinError").textContent = "Deine Teilnahme wurde von der Spielleitung entfernt. Du kannst erneut beitreten, sobald der Beitritt offen ist.";
    }
    updateJoinStatus();
  });
  async function register(profile) {
    joining = true; updateJoinStatus();
    try {
      const accepted = await store.registerPlayer(profile);
      membership = { teamId: accepted.teamId, playerName: accepted.name, joinedAt: accepted.joinedAt }; membershipUid = accepted.id;
      close(savePlayerProfile(accepted.name, accepted.teamId, accepted));
    } finally { joining = false; updateJoinStatus(); }
  }

  $("#teamChoices").addEventListener("change", event => { selectedTeamId = event.target.value; $("#joinError").textContent = ""; });
  $("#joinForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("#playerName").value.trim();
    if (!name || !selectedTeamId) { $("#joinError").textContent = "Bitte Name eingeben und ein Reich wählen."; return; }
    const team = TEAMS.find(item => item.id === selectedTeamId);
    pendingProfile = { name, teamId: selectedTeamId };
    $("#storyCrest").src = team.logo;
    $("#storyCrest").alt = `Wappen ${team.name}`;
    $("#storyTeam").textContent = team.name;
    $("#storyText").textContent = TEAM_STORIES[team.id];
    $("#joinStep").classList.add("hidden");
    $("#storyStep").classList.remove("hidden");
  });
  $("#backToChoice").addEventListener("click", () => { $("#storyStep").classList.add("hidden"); $("#joinStep").classList.remove("hidden"); });
  $("#enterRealm").addEventListener("click", async () => {
    if (!pendingProfile || joining) return;
    $("#storyError").textContent = "";
    try { await register(pendingProfile); }
    catch (error) { $("#storyError").textContent = error.message; }
  });
  $("#playerBadge").addEventListener("click", open);
  $("#joinBtn").addEventListener("click", open);
  $("#viewRanking").addEventListener("click", () => close(membership ? getPlayerProfile() : null));

  const profile = getPlayerProfile();
  open();
  if (profile && TEAMS.some(team => team.id === profile.teamId) && profile.name) register(profile).catch(error => {
    clearPlayerProfile(); close(null); open(); $("#joinError").textContent = error.message;
  });
}

function render(state) {
  currentState = state;
  const mode = state.settings.mode || "live";
  const beerPongGame = state.games?.[BEER_PONG.id], beerPongAwaitingReveal = beerPongGame?.status === "completed" && !beerPongGame.finalReveal;
  const games = sortedGames(state.games).filter(hasGameResult).filter(game => !(game.id === BEER_PONG.id && beerPongAwaitingReveal));
  const visibleGames = beerPongAwaitingReveal ? { ...state.games, [BEER_PONG.id]: { ...beerPongGame, points: Object.fromEntries(TEAMS.map(team => [team.id, 0])) } } : state.games;
  const totals = totalsFromGames(visibleGames);
  const ranking = [...TEAMS].sort((a, b) => totals[b.id] - totals[a.id] || a.name.localeCompare(b.name));
  const leader = ranking[0];
  const hasResults = games.length > 0;

  $("#liveContent").classList.toggle("hidden", mode !== "live");
  $("#freezeView").classList.toggle("hidden", mode !== "frozen");
  $("#winnerView").classList.toggle("hidden", mode !== "final");

  if (mode === "final") renderWinner(leader, totals[leader.id]);
  if (mode !== "live") return;

  renderSongBattle(state.games[SONG_BATTLE.id]);
  const balloonGame = state.games[BALLOON_MONSTER.id];
  $("#balloonMonsterCard").classList.toggle("hidden", balloonGame?.status !== "running");
  if (balloonGame?.status === "completed") maybeCelebrateGameWinner(balloonGame, BALLOON_MONSTER.id);
  const novitiusGame = state.games[NOVITIUS_GAME.id];
  if (novitiusGame?.status === "completed") maybeCelebrateGameWinner(novitiusGame, NOVITIUS_GAME.id);
  const challengesGame = state.games[GAME_CHALLENGES.id];
  if (challengesGame?.status === "completed") maybeCelebrateGameWinner(challengesGame, GAME_CHALLENGES.id);
  const beerPongCardVisible = beerPongGame?.status === "running" || beerPongAwaitingReveal;
  $("#beerPongCard").classList.toggle("hidden", !beerPongCardVisible);
  $("#beerPongCard").classList.toggle("awaiting-reveal", beerPongAwaitingReveal);
  $("#beerPongPublicTitle").textContent = beerPongAwaitingReveal ? "Beer Pong ist entschieden" : "Beer Pong läuft";
  $("#beerPongPublicText").textContent = beerPongAwaitingReveal ? "Das Resultat und die Siegerverkündung siehst du jetzt auf dem grossen Bildschirm." : "Verfolge das Turnier auf dem grossen Bildschirm.";

  const hasLeader = totals[leader.id] > 0;
  renderRanking($("#leaderboard"), ranking.map((team, index) => ({
    id: team.id, points: totals[team.id], color: team.color, glow: team.glow,
    className: `rank-card ${index === 0 && hasLeader ? "leader" : ""}`,
    html: `
      <div class="position">${index + 1}</div>
      <div class="crest"><img src="${team.logo}" alt="Wappen ${team.name}"></div>
      <div class="team-copy"><strong>${team.name}</strong><small>${team.title}</small><span class="own-realm-label" hidden>Dein Reich</span></div>
      ${index === 0 && hasLeader ? '<div class="crown" title="Führendes Reich">♛</div>' : ""}
      <div class="score" data-score-container><strong data-score>${totals[team.id]}</strong><small>Punkte</small></div>`
  })));
  highlightOwnRealm();
  $("#updatedAt").textContent = state.settings.updatedAt ? `Stand ${formatTime(state.settings.updatedAt)}` : "Noch keine Resultate";

  if (hasResults) {
    const latest = games[0];
    $("#latestCard").classList.remove("hidden");
    $("#latestName").textContent = latest.name;
    $("#latestRound").textContent = latest.resultText || latest.round || "";
    $("#latestTime").textContent = formatTime(latest.createdAt);
    $("#latestPoints").innerHTML = pointChips(latest.points);
  } else $("#latestCard").classList.add("hidden");

  $("#resultsList").innerHTML = games.map(renderGameResult).join("");
  $("#emptyResults").classList.toggle("hidden", hasResults);

  if (hasResults && previousLeader && previousLeader !== leader.id) burstConfetti(leader.color);
  if (hasResults) { previousLeader = leader.id; sessionStorage.setItem("regnum-leader", leader.id); }
}

function highlightOwnRealm() {
  const ownTeamId = getPlayerProfile()?.teamId;
  $("#leaderboard").querySelectorAll("[data-team-id]").forEach(row => {
    const own = row.dataset.teamId === ownTeamId;
    row.classList.toggle("own-realm", own);
    const label = row.querySelector(".own-realm-label");
    if (label) label.hidden = !own;
  });
}

function renderSongBattle(game) {
  const status = game?.status || "not-started";
  const running = status === "running";
  $("#songBattleCard").classList.toggle("hidden", !running);
  if (status === "completed") maybeCelebrateGameWinner(game, SONG_BATTLE.id);
  if (!running) return;
  ensureSongTeamSubscription();
  const songNumber = Number(game.currentSong) || 1;
  const key = `song-${songNumber}`;
  const answer = songOwnAnswers[key];
  const open = !!game.answersOpen;
  const reveal = game.publicReveals?.[key];
  $("#songBattlePublicStatus").textContent = reveal ? "Aufgelöst" : open ? "Antworten offen" : "Antworten geschlossen";
  $("#songBattleRound").textContent = `🎵 Song ${songNumber} von ${SONG_BATTLE.songCount}`;
  $("#songBattleReveal").classList.toggle("hidden", !reveal);
  $("#songBattleJoin").classList.toggle("hidden", !!reveal || !!songParticipant || !open);
  $("#songBattleOccupied").classList.toggle("hidden", !!reveal || !songParticipant || songParticipantOwned);
  $("#songBattleAnswerForm").classList.toggle("hidden", !!reveal || !open || !songParticipantOwned);
  $("#songBattleClosed").classList.toggle("hidden", !!reveal || open);
  $("#songBattleSaved").classList.toggle("hidden", !!reveal || !answer || !songParticipantOwned);
  if (songParticipant && !songParticipantOwned) $("#songBattleOccupied").textContent = `✓ ${songParticipant.playerName || "Eine Person aus eurem Reich"} nimmt für euer Reich teil.`;
  if (reveal) renderSongReveal(reveal);
  $("#songBattleMessage").textContent = "";
  if (songDraftKey !== key || !songDraftDirty) {
    songDraftKey = key;
    $("#songBattleTitle").value = answer?.title || "";
    $("#songBattleArtist").value = answer?.artist || "";
  }
  $("#saveSongBattleAnswer").textContent = answer ? "Antwort aktualisieren" : "Antwort speichern";
}

async function ensureSongTeamSubscription() {
  if (currentState?.games?.[SONG_BATTLE.id]?.status !== "running") return;
  const teamId = getPlayerProfile()?.teamId || null;
  if (!teamId || teamId === songTeamId) return;
  songTeamUnsubscribe?.();
  songTeamUnsubscribe = null;
  songTeamId = teamId;
  songOwnAnswers = {};
  songParticipant = null;
  songParticipantOwned = false;
  songDraftKey = null;
  const token = ++songSubscriptionToken;
  let stop;
  try { stop = await store.subscribeSongBattleTeam(teamId, value => {
    if (token !== songSubscriptionToken) return;
    songOwnAnswers = value?.answers || {};
    songParticipant = value?.participant || null;
    songParticipantOwned = !!value?.owned;
    songDraftDirty = false;
    if (currentState?.settings?.mode === "live") renderSongBattle(currentState.games?.[SONG_BATTLE.id]);
  }); } catch (error) {
    if (token === songSubscriptionToken) { songTeamId = null; $("#songBattleMessage").textContent = `Verbindung zur Teilnahme fehlgeschlagen: ${error.message}`; }
    return;
  }
  if (token !== songSubscriptionToken) stop?.();
  else songTeamUnsubscribe = stop;
}

function renderSongReveal(reveal) {
  $("#songBattleRevealList").innerHTML = TEAMS.map(team => {
    const result = reveal.teams?.[team.id] || {};
    const score = Number(result.titleCorrect) + Number(result.artistCorrect);
    return `<article class="song-reveal-row" style="--team:${team.color}"><div><strong>${team.marker} ${team.name}</strong><small>${result.submitted ? `${score}/2 Punkte` : "Keine Abgabe"}</small></div><p><span>${result.titleCorrect ? "✓" : "✗"} Titel</span><b>${escapeHtml(result.title || "–")}</b></p><p><span>${result.artistCorrect ? "✓" : "✗"} Interpret</span><b>${escapeHtml(result.artist || "–")}</b></p></article>`;
  }).join("");
}

function renderGameResult(game) {
  if (game.id === BALLOON_MONSTER.id && game.status === "completed") {
    return `<article class="result-row song-public-result balloon-public-result"><div class="result-title"><span>${formatTime(game.createdAt, true)}</span><strong>🎈 BALLON-MONSTER – RESULTAT</strong><small>Gerettete Ballons · Gleichstände teilen sich den Rang</small><ol>${(game.ranking || []).map((teamId, index) => {
      const team = TEAMS.find(item => item.id === teamId), place = Number(game.placements?.[teamId] || index + 1);
      return `<li style="--team:${team?.color || "#888"}"><b>${place}. ${place === 1 ? "🏆 " : ""}${team?.marker || ""} ${escapeHtml(team?.name || teamId)}</b><span>${Number(game.internalPoints?.[teamId] || 0)} Ballons · +${Number(game.points?.[teamId] || 0)}</span></li>`;
    }).join("")}</ol></div></article>`;
  }
  if (game.id === BEER_PONG.id && game.status === "completed") {
    return `<article class="result-row song-public-result beer-pong-public-result"><div class="result-title"><span>${formatTime(game.createdAt, true)}</span><strong>🍺 BEER PONG – TURNIERRESULTAT</strong><ol>${(game.ranking || []).map((teamId, index) => {
      const team = TEAMS.find(item => item.id === teamId), place = Number(game.placements?.[teamId] || index + 1);
      return `<li style="--team:${team?.color || "#888"}"><b>${place}. ${place === 1 ? "🏆 " : ""}${team?.marker || ""} ${escapeHtml(team?.name || teamId)}</b><span>+${Number(game.points?.[teamId] || 0)} Tagespunkte</span></li>`;
    }).join("")}</ol></div></article>`;
  }
  if (game.id === SONG_BATTLE.id && game.status === "completed") {
    return `<article class="result-row song-public-result"><div class="result-title"><span>${formatTime(game.createdAt, true)}</span><strong>🎵 SONG BATTLE – RESULTAT</strong><ol>${(game.ranking || []).map((teamId, index) => {
      const team = TEAMS.find(item => item.id === teamId);
      const place = Number(game.placements?.[teamId] || index + 1);
      return `<li style="--team:${team?.color || "#888"}"><b>${place}. ${place === 1 ? "🏆 " : ""}${team?.marker || ""} ${escapeHtml(team?.name || teamId)}</b><span>${Number(game.internalPoints?.[teamId] || 0)}/12 · +${Number(game.points?.[teamId] || 0)}</span></li>`;
    }).join("")}</ol></div></article>`;
  }
  if (game.id === NOVITIUS_GAME.id && game.status === "completed") {
    const top10 = (game.publicReveals?.["question-10"]?.top10 || []).slice(0, 10);
    const individualRanking = top10.length ? `<small>Top 10 · Einzelwertung</small><ol>${top10.map((entry, index) => {
      const team = TEAMS.find(item => item.id === entry.teamId);
      return `<li style="--team:${team?.color || "#888"}"><b>${index + 1}. ${escapeHtml(entry.playerName)} · ${team?.marker || ""} ${escapeHtml(team?.name || "")}</b><span>${Number(entry.points || 0)}/30</span></li>`;
    }).join("")}</ol>` : "";
    return `<article class="result-row song-public-result novitius-public-result"><div class="result-title"><span>${formatTime(game.createdAt, true)}</span><strong>WER KENNT DEN NOVITIUS? – RESULTAT</strong><small>Teamwertung: Durchschnitt aller angemeldeten Personen</small><ol>${(game.ranking || []).map((teamId, index) => {
      const team = TEAMS.find(item => item.id === teamId);
      const place = Number(game.placements?.[teamId] || index + 1);
      return `<li style="--team:${team?.color || "#888"}"><b>${place}. ${place === 1 ? "🏆 " : ""}${team?.marker || ""} ${escapeHtml(team?.name || teamId)}</b><span>Ø ${formatAverage(game.internalPoints?.[teamId])}/30 · +${Number(game.points?.[teamId] || 0)}</span></li>`;
    }).join("")}</ol>${individualRanking}</div></article>`;
  }
  if (game.id === GAME_CHALLENGES.id && game.status === "completed") {
    return `<article class="result-row song-public-result challenge-public-result"><div class="result-title"><span>${formatTime(game.createdAt, true)}</span><strong>🏆 GAME CHALLENGES – RESULTAT</strong><small>5 Stationen · Gleichstände teilen sich den Platz</small><ol>${(game.ranking || []).map((teamId, index) => {
      const team = TEAMS.find(item => item.id === teamId), place = Number(game.placements?.[teamId] || index + 1);
      return `<li style="--team:${team?.color || "#888"}"><b>${place}. ${place === 1 ? "🏆 " : ""}${team?.marker || ""} ${escapeHtml(team?.name || teamId)}</b><span>${Number(game.internalPoints?.[teamId] || 0)}/25 · ${Number(game.stationWins?.[teamId] || 0)} Siege · +${Number(game.points?.[teamId] || 0)}</span></li>`;
    }).join("")}</ol></div></article>`;
  }
  return `<article class="result-row"><div class="result-title"><span>${formatTime(game.createdAt, true)}</span><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml([game.round, game.resultText].filter(Boolean).join(" · "))}</small></div><div class="point-chips">${pointChips(game.points)}</div></article>`;
}

function formatAverage(value) {
  return Number(value || 0).toLocaleString("de-CH", { maximumFractionDigits: 2 });
}

function maybeCelebrateGameWinner(game, gameId) {
  const winnerIds = game?.winnerIds?.length ? game.winnerIds : game?.ranking?.[0] ? [game.ranking[0]] : [];
  const resultVersion = `${game?.updatedAt || game?.createdAt || ""}:${winnerIds.join(",")}`;
  if (!winnerIds.length || (!game?.updatedAt && !game?.createdAt) || game.status !== "completed") return;
  const profile = getPlayerProfile();
  if (!profile?.teamId) return;
  const storageKey = `regnum-celebrated-${gameId}`;
  if (localStorage.getItem(storageKey) === resultVersion) return;
  if (!winnerIds.includes(profile.teamId)) return;
  localStorage.setItem(storageKey, resultVersion);
  const winnerId = profile.teamId;
  const team = TEAMS.find(item => item.id === winnerId);
  if (!team) return;
  const celebration = $("#victoryCelebration");
  celebration.style.setProperty("--team", team.color);
  $("#victoryCrest").src = team.logo;
  $("#victoryCrest").alt = `Wappen ${team.name}`;
  $("#victoryTeam").textContent = winnerIds.length > 1 ? `${team.name} gewinnt gemeinsam!` : `${team.name} gewinnt!`;
  $("#victoryText").textContent = winnerIds.length > 1 ? `Dein Reich teilt sich den Sieg im ${game.name || "Spiel"}.` : `Dein Reich hat das ${game.name || "Spiel"} gewonnen.`;
  celebration.classList.remove("hidden");
  burstConfetti(team.color, 130);
  clearTimeout(victoryTimer);
  victoryTimer = setTimeout(hideVictoryCelebration, 4200);
}

function hideVictoryCelebration() {
  $("#victoryCelebration").classList.add("hidden");
  clearTimeout(victoryTimer);
}

function pointChips(points = {}) { return TEAMS.filter(team => Number(points[team.id]) !== 0).map(team => `<span style="--team:${team.color}"><i></i>${team.name} <b>${Number(points[team.id]) > 0 ? "+" : ""}${Number(points[team.id])}</b></span>`).join("") || '<span class="muted">Keine Punkte</span>'; }

function renderWinner(team, points) {
  $("#winnerView").innerHTML = `<div class="winner-crown">♛</div><p class="eyebrow">Herrscher des Regnum Noctis 2026</p><div class="winner-crest" style="--team:${team.color};--glow:${team.glow}"><img src="${team.logo}" alt="Wappen ${team.name}"></div><h2>${team.name}</h2><p>${team.title}</p><strong>${points} Punkte</strong>`;
  if (!$("#winnerView").dataset.celebrated) { $("#winnerView").dataset.celebrated = "1"; setTimeout(() => burstConfetti(team.color, 180), 250); }
}

function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }

function burstConfetti(color, amount = 80) {
  const canvas = $("#confetti"), ctx = canvas.getContext("2d"); canvas.width = innerWidth; canvas.height = innerHeight; canvas.classList.add("active");
  const colors = [color, "#d9b665", "#f4ead0", "#ffffff"];
  const pieces = Array.from({ length: amount }, () => ({ x: Math.random()*canvas.width, y: -20-Math.random()*canvas.height*.3, vx:(Math.random()-.5)*4, vy:2+Math.random()*5, r:3+Math.random()*5, a:Math.random()*Math.PI, c:colors[Math.floor(Math.random()*colors.length)] }));
  let frame = 0; (function draw(){ ctx.clearRect(0,0,canvas.width,canvas.height); pieces.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.a+=.08;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a);ctx.fillStyle=p.c;ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r);ctx.restore();}); if(frame++<180) requestAnimationFrame(draw); else {canvas.classList.remove("active");ctx.clearRect(0,0,canvas.width,canvas.height);} })();
}
