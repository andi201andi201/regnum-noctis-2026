import { TEAMS } from "./data.js?v=firebase-live-20261009-1";
import { serverNow } from "./time.js?v=firebase-live-20261009-1";

export const BALLOON_MONSTER = {
  id: "ballon-monster",
  name: "🎈 Ballon-Monster",
  round: "Samstagvormittag",
  durationMinutes: 15,
  timerSeconds: 90,
  defaultSupply: 30,
  description: "In 90 Sekunden wird ein Ballon-Monster gefüllt. Nach dem Parcours zählen nur die Ballons, die das Ziel erreichen."
};

export function emptyBalloonTimer() {
  return { status: "idle", durationMs: BALLOON_MONSTER.timerSeconds * 1000, remainingMs: BALLOON_MONSTER.timerSeconds * 1000, startedAt: 0, endsAt: 0 };
}

export function balloonTimerRemaining(timer, now = serverNow()) {
  if (timer?.status === "running") return Math.max(0, Number(timer.endsAt || 0) - now);
  return Math.max(0, Number(timer?.remainingMs ?? BALLOON_MONSTER.timerSeconds * 1000));
}

export function buildBalloonMonster(status = "not-started", existing = null) {
  const now = serverNow(), running = status === "running", completed = status === "completed";
  return {
    name: BALLOON_MONSTER.name,
    round: BALLOON_MONSTER.round,
    description: BALLOON_MONSTER.description,
    status,
    phase: running ? "intro" : completed ? "completed" : "idle",
    remainingTeamIds: running ? TEAMS.map(team => team.id) : [],
    drawnOrder: running ? [] : completed ? [...(existing?.drawnOrder || [])] : [],
    currentTeamId: "",
    spin: null,
    timer: emptyBalloonTimer(),
    publicResults: completed ? { ...(existing?.publicResults || {}) } : {},
    ranking: completed ? [...(existing?.ranking || [])] : [],
    placements: completed ? { ...(existing?.placements || {}) } : {},
    winnerIds: completed ? [...(existing?.winnerIds || [])] : [],
    points: completed ? { ...emptyTeamValues(), ...(existing?.points || {}) } : emptyTeamValues(),
    internalPoints: completed ? { ...(existing?.internalPoints || {}) } : {},
    resultText: completed ? String(existing?.resultText || "") : "",
    source: BALLOON_MONSTER.id,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

export function normaliseBalloonMonsterAdmin(value = null) {
  const supply = Number(value?.supply);
  return {
    supply: Number.isInteger(supply) && supply >= 1 ? supply : BALLOON_MONSTER.defaultSupply,
    drafts: Object.fromEntries(Object.entries(value?.drafts || {}).filter(([teamId]) => TEAMS.some(team => team.id === teamId)).map(([teamId, draft]) => [teamId, cleanBalloonResult(draft?.balloons, Number.isInteger(supply) && supply >= 1 ? supply : BALLOON_MONSTER.defaultSupply)])),
    updatedAt: Number(value?.updatedAt || 0)
  };
}

export function cleanBalloonSupply(value) {
  const supply = Number(value);
  if (!Number.isInteger(supply) || supply < 1 || supply > 999) throw new Error("Bitte einen identischen Vorrat zwischen 1 und 999 Ballons eintragen.");
  return supply;
}

export function cleanBalloonResult(value, supply) {
  const balloons = Number(value), maximum = cleanBalloonSupply(supply);
  if (!(typeof value === "number" || typeof value === "string" && value.trim() !== "") || !Number.isInteger(balloons) || balloons < 0 || balloons > maximum) throw new Error(`Bitte eine ganze Zahl zwischen 0 und ${maximum} eintragen.`);
  return { balloons, savedAt: serverNow() };
}

export function balloonRanking(publicResults = {}) {
  const played = TEAMS.filter(team => Number.isInteger(Number(publicResults?.[team.id]?.balloons)));
  played.sort((a, b) => Number(publicResults[b.id].balloons) - Number(publicResults[a.id].balloons) || a.name.localeCompare(b.name));
  const placements = {};
  played.forEach((team, index) => {
    const previous = played[index - 1];
    placements[team.id] = previous && Number(publicResults[previous.id].balloons) === Number(publicResults[team.id].balloons) ? placements[previous.id] : index + 1;
  });
  return { ranking: played.map(team => team.id), placements };
}

export function publishBalloonResult(gameValue, adminValue, teamId) {
  const game = cloneGame(gameValue), admin = normaliseBalloonMonsterAdmin(adminValue);
  const correction = !!game.publicResults?.[teamId], completedCorrection = game.status === "completed" && correction;
  if (!TEAMS.some(team => team.id === teamId) || (!correction && game.currentTeamId !== teamId)) throw new Error("Dieses Reich ist aktuell nicht an der Reihe.");
  const draft = admin.drafts[teamId];
  if (!draft) throw new Error("Bitte das Ergebnis zuerst speichern und kontrollieren.");
  game.publicResults[teamId] = { balloons: draft.balloons, publishedAt: serverNow() };
  const scored = balloonRanking(game.publicResults);
  game.ranking = scored.ranking;
  game.placements = scored.placements;
  if (!correction || game.currentTeamId === teamId) {
    game.phase = "result";
    game.timer = emptyBalloonTimer();
  }
  game.updatedAt = serverNow();
  return completedCorrection ? completeBalloonMonster({ ...game, status: "running", pointsAwardedAt: game.pointsAwardedAt }) : game;
}

export function completeBalloonMonster(gameValue) {
  const game = cloneGame(gameValue);
  if (game.status !== "running") throw new Error("Ballon-Monster läuft nicht.");
  if (TEAMS.some(team => !Number.isInteger(Number(game.publicResults?.[team.id]?.balloons)))) throw new Error("Bitte zuerst für alle fünf Reiche ein Ergebnis veröffentlichen.");
  const { ranking, placements } = balloonRanking(game.publicResults), points = emptyTeamValues();
  ranking.forEach(teamId => { points[teamId] = TEAMS.length + 1 - placements[teamId]; });
  const now = serverNow();
  return {
    ...game,
    status: "completed",
    phase: "completed",
    currentTeamId: "",
    remainingTeamIds: [],
    spin: null,
    timer: emptyBalloonTimer(),
    ranking,
    placements,
    winnerIds: ranking.filter(teamId => placements[teamId] === 1),
    internalPoints: Object.fromEntries(TEAMS.map(team => [team.id, Number(game.publicResults[team.id].balloons)])),
    points,
    resultText: ranking.map(teamId => `${placements[teamId]}. ${teamById(teamId).name} ${game.publicResults[teamId].balloons} Ballons`).join(" · "),
    pointsAwardedAt: game.pointsAwardedAt || now,
    updatedAt: now
  };
}

export function refreshCompletedBalloonMonster(gameValue) {
  if (gameValue?.status !== "completed") return gameValue;
  return completeBalloonMonster({ ...gameValue, status: "running" });
}

export function announceBalloonTeam(gameValue, teamId, automatic = false) {
  const game = cloneGame(gameValue);
  if (game.status !== "running" || game.currentTeamId) throw new Error("Zuerst den aktuellen Durchgang abschliessen oder die Auslosung zurücknehmen.");
  if (!game.remainingTeamIds.includes(teamId)) throw new Error("Dieses Reich ist nicht mehr in der Auslosung.");
  const now = serverNow();
  game.currentTeamId = teamId;
  game.remainingTeamIds = game.remainingTeamIds.filter(id => id !== teamId);
  game.drawnOrder = [...game.drawnOrder, teamId];
  game.phase = automatic ? "selected" : "spinning";
  game.spin = { id: `${now}-${teamId}`, selectedTeamId: teamId, startedAt: now, endsAt: automatic ? now : now + 6000, automatic };
  game.timer = emptyBalloonTimer();
  game.updatedAt = now;
  return game;
}

export function undoBalloonDraw(gameValue) {
  const game = cloneGame(gameValue), teamId = game.currentTeamId;
  if (game.status !== "running" || !teamId) throw new Error("Es gibt keine Auslosung zum Rückgängigmachen.");
  if (game.publicResults?.[teamId]) throw new Error("Ein veröffentlichtes Ergebnis muss zuerst kontrolliert korrigiert werden.");
  game.remainingTeamIds = [...new Set([...game.remainingTeamIds, teamId])];
  game.drawnOrder = game.drawnOrder.filter((id, index) => !(id === teamId && index === game.drawnOrder.lastIndexOf(teamId)));
  game.currentTeamId = "";
  game.phase = "wheel";
  game.spin = null;
  game.timer = emptyBalloonTimer();
  game.updatedAt = serverNow();
  return game;
}

function cloneGame(value = {}) {
  return {
    ...value,
    remainingTeamIds: [...(value.remainingTeamIds || [])],
    drawnOrder: [...(value.drawnOrder || [])],
    publicResults: { ...(value.publicResults || {}) },
    ranking: [...(value.ranking || [])],
    placements: { ...(value.placements || {}) },
    points: { ...emptyTeamValues(), ...(value.points || {}) },
    timer: { ...emptyBalloonTimer(), ...(value.timer || {}) },
    spin: value.spin ? { ...value.spin } : null
  };
}

function emptyTeamValues() { return Object.fromEntries(TEAMS.map(team => [team.id, 0])); }
function teamById(id) { return TEAMS.find(team => team.id === id); }
