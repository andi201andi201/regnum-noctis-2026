export const TEAMS = [
  { id: "draco", name: "Draco", title: "Reich des Drachen", icon: "🐉", color: "#d84747", glow: "#ff6b57" },
  { id: "serpens", name: "Serpens", title: "Reich der Schlange", icon: "🐍", color: "#2f9e68", glow: "#61d095" },
  { id: "lupus", name: "Lupus", title: "Reich des Wolfes", icon: "🐺", color: "#6078a9", glow: "#94aee5" },
  { id: "corvus", name: "Corvus", title: "Reich des Raben", icon: "◆", color: "#7255a5", glow: "#ae83e8" },
  { id: "noctua", name: "Noctua", title: "Reich der Eule", icon: "🦉", color: "#c18a32", glow: "#f3bd57" }
];

export const EMPTY_STATE = { settings: { mode: "live", updatedAt: 0 }, games: {} };

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
