import { TEAMS, totalsFromGames, sortedGames, formatTime } from "./data.js";
import { getStore } from "./store.js";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let previousLeader = sessionStorage.getItem("regnum-leader");

store.subscribe(render);
$("#connectionText").textContent = store.demo ? "Lokaler Demomodus" : "Live verbunden";
document.body.classList.add("ready");

function render(state) {
  const mode = state.settings.mode || "live";
  const games = sortedGames(state.games);
  const totals = totalsFromGames(state.games);
  const ranking = [...TEAMS].sort((a, b) => totals[b.id] - totals[a.id] || a.name.localeCompare(b.name));
  const leader = ranking[0];
  const hasResults = games.length > 0;

  $("#liveContent").classList.toggle("hidden", mode !== "live");
  $("#freezeView").classList.toggle("hidden", mode !== "frozen");
  $("#winnerView").classList.toggle("hidden", mode !== "final");

  if (mode === "final") renderWinner(leader, totals[leader.id]);
  if (mode !== "live") return;

  $("#leaderboard").innerHTML = ranking.map((team, index) => `
    <li class="rank-card ${index === 0 && hasResults ? "leader" : ""}" style="--team:${team.color};--glow:${team.glow}">
      <div class="position">${index + 1}</div>
      <div class="crest"><span>${team.icon}</span></div>
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

function pointChips(points = {}) { return TEAMS.filter(team => Number(points[team.id]) !== 0).map(team => `<span style="--team:${team.color}"><i></i>${team.name} <b>${Number(points[team.id]) > 0 ? "+" : ""}${Number(points[team.id])}</b></span>`).join("") || '<span class="muted">Keine Punkte</span>'; }

function renderWinner(team, points) {
  $("#winnerView").innerHTML = `<div class="winner-crown">♛</div><p class="eyebrow">Herrscher des Regnum Noctis 2026</p><div class="winner-crest" style="--team:${team.color};--glow:${team.glow}">${team.icon}</div><h2>${team.name}</h2><p>${team.title}</p><strong>${points} Punkte</strong>`;
  if (!$("#winnerView").dataset.celebrated) { $("#winnerView").dataset.celebrated = "1"; setTimeout(() => burstConfetti(team.color, 180), 250); }
}

function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }

function burstConfetti(color, amount = 80) {
  const canvas = $("#confetti"), ctx = canvas.getContext("2d"); canvas.width = innerWidth; canvas.height = innerHeight; canvas.classList.add("active");
  const colors = [color, "#d9b665", "#f4ead0", "#ffffff"];
  const pieces = Array.from({ length: amount }, () => ({ x: Math.random()*canvas.width, y: -20-Math.random()*canvas.height*.3, vx:(Math.random()-.5)*4, vy:2+Math.random()*5, r:3+Math.random()*5, a:Math.random()*Math.PI, c:colors[Math.floor(Math.random()*colors.length)] }));
  let frame = 0; (function draw(){ ctx.clearRect(0,0,canvas.width,canvas.height); pieces.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.a+=.08;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a);ctx.fillStyle=p.c;ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r);ctx.restore();}); if(frame++<180) requestAnimationFrame(draw); else {canvas.classList.remove("active");ctx.clearRect(0,0,canvas.width,canvas.height);} })();
}
