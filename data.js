export const TEAMS = [
  { id: "draco", name: "Draco", marker: "🔴", title: "Reich des Drachen", logo: "assets/teams/draco.webp", color: "#d84747", glow: "#ff6b57" },
  { id: "serpens", name: "Serpens", marker: "🟢", title: "Reich der Schlange", logo: "assets/teams/serpens.webp", color: "#2f9e68", glow: "#61d095" },
  { id: "lupus", name: "Lupus", marker: "🔵", title: "Reich des Wolfes", logo: "assets/teams/lupus.webp", color: "#2f7fd4", glow: "#63aaff" },
  { id: "corvus", name: "Corvus", marker: "⚫", title: "Reich des Raben", logo: "assets/teams/corvus.webp", color: "#585860", glow: "#a5a5ae" },
  { id: "noctua", name: "Noctua", marker: "🟡", title: "Reich der Eule", logo: "assets/teams/noctua.webp", color: "#c18a32", glow: "#f3bd57" }
];

export const EMPTY_STATE = {
  settings: {
    mode: "live",
    updatedAt: 0,
    hunt: { active: false, roundId: "", startedAt: 0, endsAt: 0 },
    oracle: { active: false, revealed: false, roundId: "", question: "", answer: 0, unit: "", maxPoints: 5, startedAt: 0, endsAt: 0, results: {} }
  },
  games: {},
  songBattleAnswers: {},
  songBattleParticipants: {},
  songBattleAdmin: { evaluations: {}, internalPoints: {} },
  oracleAnswers: {},
  oracleQuestions: {}
};

export const BALLON_GAME = {
  id: "ballon-game",
  name: "Ballon Game",
  round: "Vormittag",
  durationMinutes: 15,
  description: "Alle fünf Teams transportieren gleichzeitig einen Ballon ohne Hände durchs ganze Team: Stirn an Stirn, Bauch an Bauch, Rücken an Rücken, Schulter an Schulter und zwischen den Knien. Fällt der Ballon herunter oder platzt er, geht es zurück an den Start."
};

export const SONG_BATTLE = {
  id: "song-battle",
  name: "🎵 Song Battle",
  round: "Vormittag",
  durationMinutes: 15,
  songCount: 6,
  description: "Erkennt bei sechs Songs jeweils Titel und Interpret. Pro richtige Angabe gibt es einen internen Punkt."
};

export const GAME_STATUSES = {
  "not-started": "Noch nicht gestartet",
  running: "Läuft",
  completed: "Beendet"
};

export function buildBallonGame(status, ranking = [], existing = null) {
  if (!Object.hasOwn(GAME_STATUSES, status)) throw new Error("Bitte einen gültigen Spielstatus wählen.");
  if (status === "completed" && (!Array.isArray(ranking) || ranking.length !== TEAMS.length || new Set(ranking).size !== TEAMS.length || ranking.some(id => !TEAMS.some(team => team.id === id)))) {
    throw new Error("Bitte alle fünf Reiche genau einmal auf Platz 1–5 einordnen.");
  }
  const now = Date.now();
  const points = Object.fromEntries(TEAMS.map(team => [team.id, 0]));
  const places = status === "completed" ? [...ranking] : [];
  places.forEach((id, index) => { points[id] = TEAMS.length - index; });
  const { id, ...definition } = BALLON_GAME;
  return {
    ...definition, status, ranking: places, points, source: "placement",
    resultText: places.map((teamId, index) => `${index + 1}. ${TEAMS.find(team => team.id === teamId).name}`).join(" · "),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

export function buildSongBattle(status = "running", existing = null) {
  if (!Object.hasOwn(GAME_STATUSES, status)) throw new Error("Bitte einen gültigen Spielstatus wählen.");
  const now = Date.now();
  const { id, songCount, ...definition } = SONG_BATTLE;
  return {
    ...definition,
    status,
    currentSong: status === "not-started" ? 0 : Number(existing?.currentSong) || 1,
    answersOpen: status === "running" ? existing?.answersOpen !== false : false,
    revealedSongs: status === "not-started" ? {} : { ...(existing?.revealedSongs || {}) },
    publicReveals: status === "not-started" ? {} : { ...(existing?.publicReveals || {}) },
    ranking: status === "completed" ? [...(existing?.ranking || [])] : [],
    placements: status === "completed" ? { ...(existing?.placements || {}) } : {},
    winnerIds: status === "completed" ? [...(existing?.winnerIds || [])] : [],
    points: status === "completed" ? { ...(existing?.points || emptyTeamPoints()) } : emptyTeamPoints(),
    internalPoints: status === "completed" ? { ...(existing?.internalPoints || emptyTeamPoints()) } : {},
    resultText: status === "completed" ? existing?.resultText || "" : "",
    source: "song-battle",
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

export function songBattleScores(evaluations = {}) {
  const scores = emptyTeamPoints();
  Object.values(evaluations || {}).forEach(song => TEAMS.forEach(team => {
    if (song?.[team.id]?.title === true) scores[team.id] += 1;
    if (song?.[team.id]?.artist === true) scores[team.id] += 1;
  }));
  return scores;
}

export function songBattleTieGroups(scores = {}) {
  const groups = new Map();
  TEAMS.forEach(team => {
    const score = Number(scores[team.id] || 0);
    if (!groups.has(score)) groups.set(score, []);
    groups.get(score).push(team.id);
  });
  return [...groups.entries()].filter(([, ids]) => ids.length > 1).sort((a, b) => b[0] - a[0]).map(([score, teamIds]) => ({ score, teamIds }));
}

export function suggestedSongBattleRanking(scores = {}, previousRanking = []) {
  const previousPosition = new Map(previousRanking.map((id, index) => [id, index]));
  return [...TEAMS].sort((a, b) => Number(scores[b.id] || 0) - Number(scores[a.id] || 0) || (previousPosition.get(a.id) ?? 99) - (previousPosition.get(b.id) ?? 99) || a.name.localeCompare(b.name)).map(team => team.id);
}

export function finalizeSongBattle(game, evaluations) {
  const scores = songBattleScores(evaluations);
  const ranking = suggestedSongBattleRanking(scores, game?.ranking || []);
  const points = emptyTeamPoints();
  const placements = {};
  ranking.forEach((id, index) => {
    const place = index > 0 && scores[id] === scores[ranking[index - 1]] ? placements[ranking[index - 1]] : index + 1;
    placements[id] = place;
    points[id] = TEAMS.length + 1 - place;
  });
  const winnerIds = ranking.filter(id => placements[id] === 1);
  const now = Date.now();
  return {
    ...game,
    status: "completed",
    answersOpen: false,
    ranking: [...ranking],
    placements,
    winnerIds,
    points,
    internalPoints: scores,
    resultText: ranking.map(teamId => `${placements[teamId]}. ${TEAMS.find(team => team.id === teamId).name} ${scores[teamId]}/12`).join(" · "),
    source: "song-battle",
    createdAt: game?.status === "completed" ? game.createdAt : now,
    updatedAt: now
  };
}

function emptyTeamPoints() {
  return Object.fromEntries(TEAMS.map(team => [team.id, 0]));
}

export function hasGameResult(game) {
  return !game.status || game.status === "completed";
}

export function totalsFromGames(games = {}) {
  const totals = Object.fromEntries(TEAMS.map(team => [team.id, 0]));
  Object.values(games || {}).filter(hasGameResult).forEach(game => TEAMS.forEach(team => {
    totals[team.id] += Number(game.points?.[team.id] || 0);
  }));
  return totals;
}

export function sortedGames(games = {}) {
  return Object.entries(games || {}).map(([id, game]) => ({ id, ...game })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function formatTime(timestamp, withDate = false) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("de-CH", withDate ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}
