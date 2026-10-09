export const HUNT_POINTS_PER_OBJECT = 1;

export const HUNT_DEFAULT_TARGETS = {
  "object-1": { id: "object-1", number: 1, clue: "Ich lösche deinen Durst, obwohl ich selbst nie trinke.", category: "bottle", internalName: "Flasche", enabled: true },
  "object-2": { id: "object-2", number: 2, clue: "Man füllt mich, bevor man mich leert.", category: "cup", internalName: "Becher/Tasse", enabled: true },
  "object-3": { id: "object-3", number: 3, clue: "Ich habe Beine, gehe aber nirgendwo hin.", category: "chair", internalName: "Stuhl", enabled: true },
  "object-4": { id: "object-4", number: 4, clue: "Ich trage deine Sachen, ohne Hände zu haben.", category: "backpack", internalName: "Rucksack", enabled: true },
  "object-5": { id: "object-5", number: 5, clue: "Ich erzähle Geschichten, ohne zu sprechen.", category: "book", internalName: "Buch", enabled: true },
  "object-6": { id: "object-6", number: 6, clue: "Fast jeder trägt mich bei sich, obwohl ich selten still bin.", category: "cell phone", internalName: "Handy", enabled: true },
  "object-7": { id: "object-7", number: 7, clue: "Für viele beginnt und endet der Tag mit mir.", category: "toothbrush", internalName: "Zahnbürste", enabled: true },
  "object-8": { id: "object-8", number: 8, clue: "Ich helfe beim Essen, obwohl ich selbst nie hungrig bin.", category: "spoon", internalName: "Löffel", enabled: true },
  "object-9": { id: "object-9", number: 9, clue: "Wenn der Himmel schlechte Laune hat, werde ich interessant.", category: "umbrella", internalName: "Regenschirm", enabled: true },
  "object-10": { id: "object-10", number: 10, clue: "Ich laufe ständig und bleibe trotzdem am selben Ort.", category: "clock", internalName: "Uhr", enabled: true }
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

