export const TEAMS = [
  { id: "draco", name: "Draco", title: "Reich des Drachen", logo: "assets/teams/draco.webp", color: "#d84747", glow: "#ff6b57" },
  { id: "serpens", name: "Serpens", title: "Reich der Schlange", logo: "assets/teams/serpens.webp", color: "#2f9e68", glow: "#61d095" },
  { id: "lupus", name: "Lupus", title: "Reich des Wolfes", logo: "assets/teams/lupus.webp", color: "#2f7fd4", glow: "#63aaff" },
  { id: "corvus", name: "Corvus", title: "Reich des Raben", logo: "assets/teams/corvus.webp", color: "#585860", glow: "#a5a5ae" },
  { id: "noctua", name: "Noctua", title: "Reich der Eule", logo: "assets/teams/noctua.webp", color: "#c18a32", glow: "#f3bd57" }
];

export const EMPTY_STATE = { settings: { mode: "live", updatedAt: 0, hunt: { active: false, roundId: "", startedAt: 0, endsAt: 0 } }, games: {} };

export function totalsFromGames(games = {}) {
  const totals = Object.fromEntries(TEAMS.map(team => [team.id, 0]));
  Object.values(games || {}).forEach(game => TEAMS.forEach(team => {
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
