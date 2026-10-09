export const HUNT_POINTS_PER_OBJECT = 1;

export const HUNT_DEFAULT_TARGETS = {
  "object-1": { id: "object-1", number: 1, clue: "Hinweis 1 noch festlegen.", category: "", internalName: "", enabled: false },
  "object-2": { id: "object-2", number: 2, clue: "Hinweis 2 noch festlegen.", category: "", internalName: "", enabled: false },
  "object-3": { id: "object-3", number: 3, clue: "Hinweis 3 noch festlegen.", category: "", internalName: "", enabled: false },
  "object-4": { id: "object-4", number: 4, clue: "Hinweis 4 noch festlegen.", category: "", internalName: "", enabled: false },
  "object-5": { id: "object-5", number: 5, clue: "Hinweis 5 noch festlegen.", category: "", internalName: "", enabled: false },
  "object-6": { id: "object-6", number: 6, clue: "Hinweis 6 noch festlegen.", category: "", internalName: "", enabled: false },
  "object-7": { id: "object-7", number: 7, clue: "Hinweis 7 noch festlegen.", category: "", internalName: "", enabled: false },
  "object-8": { id: "object-8", number: 8, clue: "Hinweis 8 noch festlegen.", category: "", internalName: "", enabled: false },
  "object-9": { id: "object-9", number: 9, clue: "Hinweis 9 noch festlegen.", category: "", internalName: "", enabled: false },
  "object-10": { id: "object-10", number: 10, clue: "Hinweis 10 noch festlegen.", category: "", internalName: "", enabled: false }
};

export function normaliseHuntTargets(value = null) {
  return Object.fromEntries(Object.entries(HUNT_DEFAULT_TARGETS).map(([id, target]) => [id, { ...target, ...(value?.[id] || {}), id, number: target.number }]));
}

export function huntTargetList(value = null) {
  return Object.values(normaliseHuntTargets(value)).filter(target => target.enabled !== false).sort((a, b) => a.number - b.number);
}

export function huntFinds(games = {}, roundId = "", teamId = null) {
  return Object.entries(games || {}).filter(([, game]) => game?.source === "team-hunt" && game.roundId === roundId && (!teamId || game.teamId === teamId)).map(([id, game]) => ({ id, ...game }));
}

export function huntProgress(games = {}, roundId = "", teamId = null) {
  return new Set(huntFinds(games, roundId, teamId).map(find => find.targetId));
}

