export const TEAMS = [
  { id: "draco", name: "Draco", title: "Reich des Drachen", logo: "assets/teams/draco.webp", color: "#d84747", glow: "#ff6b57" },
  { id: "serpens", name: "Serpens", title: "Reich der Schlange", logo: "assets/teams/serpens.webp", color: "#2f9e68", glow: "#61d095" },
  { id: "lupus", name: "Lupus", title: "Reich des Wolfes", logo: "assets/teams/lupus.webp", color: "#2f7fd4", glow: "#63aaff" },
  { id: "corvus", name: "Corvus", title: "Reich des Raben", logo: "assets/teams/corvus.webp", color: "#585860", glow: "#a5a5ae" },
  { id: "noctua", name: "Noctua", title: "Reich der Eule", logo: "assets/teams/noctua.webp", color: "#c18a32", glow: "#f3bd57" }
];

export const EMPTY_STATE = {
  settings: {
    mode: "live",
    updatedAt: 0,
    hunt: { active: false, roundId: "", startedAt: 0, endsAt: 0 },
    oracle: { active: false, revealed: false, roundId: "", question: "", answer: 0, unit: "", maxPoints: 5, startedAt: 0, endsAt: 0, results: {} }
  },
  games: {},
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
