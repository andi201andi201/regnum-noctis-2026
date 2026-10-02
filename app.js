import { TEAMS, totalsFromGames, sortedGames, formatTime, BALLON_GAME, GAME_STATUSES, hasGameResult } from "./data.js?v=games-2";
import { getStore } from "./store.js?v=games-2";
import { TEAM_STORIES, getPlayerProfile, savePlayerProfile } from "./player.js";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let previousLeader = sessionStorage.getItem("regnum-leader"), currentState = null, victoryTimer = null;

store.subscribe(render);
$("#connectionText").textContent = store.demo ? "Lokaler Demomodus" : "Live verbunden";
document.body.classList.add("ready");
setupOnboarding();
window.addEventListener("regnum-player-changed", () => {
  if (currentState?.settings?.mode === "live") maybeCelebrateGameWinner(currentState.games?.[BALLON_GAME.id], BALLON_GAME.id);
});
$("#victoryCelebration").addEventListener("click", hideVictoryCelebration);

function setupOnboarding() {
  let selectedTeamId = null;
  let pendingProfile = null;
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
  };

  const close = profile => {
    onboarding.classList.add("hidden");
    document.body.classList.remove("onboarding-open");
    const team = TEAMS.find(item => item.id === profile.teamId);
    $("#playerBadge").innerHTML = `<img src="${team.logo}" alt=""> <span>${escapeHtml(profile.name)} · ${team.name}</span>`;
    $("#playerBadge").classList.remove("hidden");
  };

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
  $("#enterRealm").addEventListener("click", () => close(savePlayerProfile(pendingProfile.name, pendingProfile.teamId)));
  $("#playerBadge").addEventListener("click", open);

  const profile = getPlayerProfile();
  if (profile && TEAMS.some(team => team.id === profile.teamId) && profile.name) close(profile);
  else open();
}

function render(state) {
  currentState = state;
  const mode = state.settings.mode || "live";
  const games = sortedGames(state.games).filter(hasGameResult);
  const totals = totalsFromGames(state.games);
  const ranking = [...TEAMS].sort((a, b) => totals[b.id] - totals[a.id] || a.name.localeCompare(b.name));
  const leader = ranking[0];
  const hasResults = games.length > 0;

  $("#liveContent").classList.toggle("hidden", mode !== "live");
  $("#freezeView").classList.toggle("hidden", mode !== "frozen");
  $("#winnerView").classList.toggle("hidden", mode !== "final");

  if (mode === "final") renderWinner(leader, totals[leader.id]);
  if (mode !== "live") return;

  renderBallonGame(state.games[BALLON_GAME.id]);

  $("#leaderboard").innerHTML = ranking.map((team, index) => `
    <li class="rank-card ${index === 0 && hasResults ? "leader" : ""}" style="--team:${team.color};--glow:${team.glow}">
      <div class="position">${index + 1}</div>
      <div class="crest"><img src="${team.logo}" alt="Wappen ${team.name}"></div>
      <div class="team-copy"><strong>${team.name}</strong><small>${team.title}</small></div>
      ${index === 0 && hasResults ? '<div class="crown" title="Führendes Reich">♛</div>' : ""}
      <div class="score"><strong>${totals[team.id]}</strong><small>Punkte</small></div>
    </li>`).join("");
  $("#updatedAt").textContent = state.settings.updatedAt ? `Stand ${formatTime(state.settings.updatedAt)}` : "Noch keine Resultate";

  if (hasResults) {
    const latest = games[0];
    $("#latestCard").classList.remove("hidden");
    $("#latestName").textContent = latest.name;
    $("#latestRound").textContent = latest.resultText || latest.round || "";
    $("#latestTime").textContent = formatTime(latest.createdAt);
    $("#latestPoints").innerHTML = pointChips(latest.points);
  } else $("#latestCard").classList.add("hidden");

  $("#resultsList").innerHTML = games.map(game => `<article class="result-row"><div class="result-title"><span>${formatTime(game.createdAt, true)}</span><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml([game.round, game.resultText].filter(Boolean).join(" · "))}</small></div><div class="point-chips">${pointChips(game.points)}</div></article>`).join("");
  $("#emptyResults").classList.toggle("hidden", hasResults);

  if (hasResults && previousLeader && previousLeader !== leader.id) burstConfetti(leader.color);
  if (hasResults) { previousLeader = leader.id; sessionStorage.setItem("regnum-leader", leader.id); }
}

function renderBallonGame(game) {
  const status = game?.status || "not-started";
  const running = status === "running";
  $("#ballonGameCard").classList.toggle("hidden", !running);
  $("#ballonGameStatus").textContent = GAME_STATUSES[status] || GAME_STATUSES["not-started"];
  $("#ballonGameCard").dataset.status = status;
  $("#ballonGameDescription").textContent = BALLON_GAME.description;
  if (status === "completed") maybeCelebrateGameWinner(game, BALLON_GAME.id);
}

function maybeCelebrateGameWinner(game, gameId) {
  const winnerId = game?.ranking?.[0];
  const resultVersion = `${game?.updatedAt || game?.createdAt || ""}:${winnerId || ""}`;
  if (!winnerId || (!game?.updatedAt && !game?.createdAt) || game.status !== "completed") return;
  const profile = getPlayerProfile();
  if (!profile?.teamId) return;
  const storageKey = `regnum-celebrated-${gameId}`;
  if (localStorage.getItem(storageKey) === resultVersion) return;
  localStorage.setItem(storageKey, resultVersion);
  if (profile.teamId !== winnerId) return;
  const team = TEAMS.find(item => item.id === winnerId);
  if (!team) return;
  const celebration = $("#victoryCelebration");
  celebration.style.setProperty("--team", team.color);
  $("#victoryCrest").src = team.logo;
  $("#victoryCrest").alt = `Wappen ${team.name}`;
  $("#victoryTeam").textContent = `${team.name} gewinnt!`;
  $("#victoryText").textContent = `Dein Reich hat das ${game.name || "Spiel"} gewonnen.`;
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
