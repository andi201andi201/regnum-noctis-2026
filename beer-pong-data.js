import { TEAMS } from "./data.js?v=firebase-live-20261009-1";
import { serverNow } from "./time.js?v=firebase-live-20261009-1";

export const BEER_PONG = {
  id: "beer-pong",
  name: "🍺 Beer Pong – Battle of the Five Realms",
  round: "Samstagabend · Turnierfinale",
  description: "Fünf Reiche kämpfen in Gruppenphase, Halbfinals und der Final Battle um den Turniersieg."
};

export const BEER_PONG_GROUP_MATCHES = [
  groupMatch("group-1", 1, 1, "draco", "serpens"),
  groupMatch("group-2", 1, 2, "lupus", "corvus"),
  groupMatch("group-3", 2, 1, "noctua", "draco"),
  groupMatch("group-4", 2, 2, "serpens", "lupus"),
  groupMatch("group-5", 3, 1, "corvus", "noctua")
];

export function buildBeerPong(status = "running", existing = null) {
  if (!["not-started", "running", "completed"].includes(status)) throw new Error("Ungültiger Beer-Pong-Status.");
  const now = serverNow(), running = status === "running", completed = status === "completed";
  return {
    name: BEER_PONG.name,
    round: BEER_PONG.round,
    description: BEER_PONG.description,
    status,
    phase: running ? "groups" : completed ? "completed" : "hidden",
    currentRound: status === "not-started" ? 0 : Math.min(3, Math.max(1, Number(existing?.currentRound) || 1)),
    matches: status === "not-started" ? {} : Object.fromEntries(BEER_PONG_GROUP_MATCHES.map(match => [match.id, { ...match }])),
    groupEvaluated: false,
    groupRanking: [],
    groupStandings: [],
    semifinalsReleased: false,
    finalReleased: false,
    finalReveal: completed ? !!existing?.finalReveal : false,
    ranking: completed ? [...(existing?.ranking || [])] : [],
    placements: completed ? { ...(existing?.placements || {}) } : {},
    points: completed ? { ...emptyTeamValues(), ...(existing?.points || {}) } : emptyTeamValues(),
    winnerIds: completed ? [...(existing?.winnerIds || [])] : [],
    resultText: completed ? existing?.resultText || "" : "",
    source: "beer-pong",
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

export function normaliseBeerPongAdmin(value = null) {
  return { drafts: { ...(value?.drafts || {}) }, tieBreakRanks: { ...(value?.tieBreakRanks || {}) }, finalResult: value?.finalResult || null, finalGame: value?.finalGame || null, updatedAt: Number(value?.updatedAt || 0) };
}

export function cleanBeerPongResult(match, value = {}) {
  if (!match?.teamA || !match?.teamB) throw new Error("Matchpaarung ist noch nicht vollständig.");
  const max = Number(match.cupsPerSide || 6), cupsHitA = integerRange(value.cupsHitA, 0, max, "Treffer Team A"), cupsHitB = integerRange(value.cupsHitB, 0, max, "Treffer Team B");
  const winnerId = String(value.winnerId || ""), validWinners = [match.teamA, match.teamB];
  if (!validWinners.includes(winnerId)) throw new Error("Bitte den Matchsieger bestätigen.");
  if (cupsHitA !== cupsHitB) {
    const calculated = cupsHitA > cupsHitB ? match.teamA : match.teamB;
    if (winnerId !== calculated) throw new Error("Der bestätigte Sieger widerspricht der Anzahl getroffener Becher.");
  }
  return { cupsHitA, cupsHitB, winnerId, decidedBy: cupsHitA === cupsHitB ? "tiebreak" : value.decidedBy === "time" ? "time" : "cups", savedAt: serverNow() };
}

export function publicBeerPongMatch(match, draft) {
  const result = cleanBeerPongResult(match, draft);
  return { ...match, status: "completed", published: true, ...result, publishedAt: serverNow() };
}

export function calculateBeerPongGroupTable(game, tieBreakRanks = {}, requireResolved = false) {
  const stats = Object.fromEntries(TEAMS.map(team => [team.id, { teamId: team.id, played: 0, wins: 0, groupPoints: 0, cupsHit: 0, cupsLost: 0, cupDifference: 0 }]));
  BEER_PONG_GROUP_MATCHES.forEach(definition => {
    const match = game?.matches?.[definition.id];
    if (!match?.published || match.status !== "completed") {
      if (requireResolved) throw new Error(`Ergebnis fehlt: Runde ${definition.round}, Tisch ${definition.table}.`);
      return;
    }
    const a = stats[match.teamA], b = stats[match.teamB];
    a.played += 1; b.played += 1;
    a.cupsHit += Number(match.cupsHitA); a.cupsLost += Number(match.cupsHitB);
    b.cupsHit += Number(match.cupsHitB); b.cupsLost += Number(match.cupsHitA);
    if (match.winnerId === match.teamA) { a.wins += 1; a.groupPoints += 2; }
    else if (match.winnerId === match.teamB) { b.wins += 1; b.groupPoints += 2; }
  });
  Object.values(stats).forEach(row => { row.cupDifference = row.cupsHit - row.cupsLost; });
  const base = Object.values(stats).sort(compareGroupStats);
  const tieGroups = exactTieGroups(base);
  if (requireResolved) tieGroups.forEach(group => validateTieRanks(group, tieBreakRanks));
  const ranking = [...base].sort((a, b) => {
    const comparison = compareGroupStats(a, b);
    if (comparison) return comparison;
    const aRank = Number(tieBreakRanks[a.teamId]), bRank = Number(tieBreakRanks[b.teamId]);
    if (Number.isFinite(aRank) && Number.isFinite(bRank)) return aRank - bRank;
    return teamName(a.teamId).localeCompare(teamName(b.teamId));
  });
  return { standings: ranking.map((row, index) => ({ ...row, place: index + 1 })), ranking: ranking.map(row => row.teamId), tieGroups };
}

export function evaluateBeerPongGroups(game, tieBreakRanks = {}) {
  const table = calculateBeerPongGroupTable(game, tieBreakRanks, true);
  return { ...game, groupEvaluated: true, groupRanking: table.ranking, groupStandings: table.standings, updatedAt: serverNow() };
}

export function releaseBeerPongSemifinals(game) {
  if (!game?.groupEvaluated || game.groupRanking?.length !== 5) throw new Error("Bitte zuerst die Gruppenphase vollständig auswerten.");
  const [first, second, third, fourth] = game.groupRanking;
  return {
    ...game,
    phase: "semifinals",
    semifinalsReleased: true,
    finalReleased: false,
    matches: {
      ...groupMatchesOnly(game.matches),
      "semi-1": knockoutMatch("semi-1", "semifinal", "Halbfinale 1", 1, first, fourth, 6),
      "semi-2": knockoutMatch("semi-2", "semifinal", "Halbfinale 2", 2, second, third, 6)
    },
    updatedAt: serverNow()
  };
}

export function releaseBeerPongFinal(game) {
  const semi1 = game?.matches?.["semi-1"], semi2 = game?.matches?.["semi-2"];
  if (![semi1, semi2].every(match => match?.published && match.status === "completed" && match.winnerId)) throw new Error("Bitte zuerst beide Halbfinals veröffentlichen.");
  return {
    ...game,
    phase: "final",
    finalReleased: true,
    matches: { ...game.matches, final: knockoutMatch("final", "final", "The Final Battle", 1, semi1.winnerId, semi2.winnerId, 10) },
    updatedAt: serverNow()
  };
}

export function completeBeerPong(game) {
  const final = game?.matches?.final, semi1 = game?.matches?.["semi-1"], semi2 = game?.matches?.["semi-2"];
  if (!final?.published || final.status !== "completed" || !final.winnerId) throw new Error("Bitte zuerst das Finale veröffentlichen.");
  const finalistLoser = final.winnerId === final.teamA ? final.teamB : final.teamA;
  const semiLosers = [semi1, semi2].map(match => match.winnerId === match.teamA ? match.teamB : match.teamA);
  semiLosers.sort((a, b) => game.groupRanking.indexOf(a) - game.groupRanking.indexOf(b));
  const fifth = game.groupRanking[4], ranking = [final.winnerId, finalistLoser, ...semiLosers, fifth];
  const placements = Object.fromEntries(ranking.map((id, index) => [id, index + 1]));
  const points = Object.fromEntries(ranking.map((id, index) => [id, 5 - index]));
  return {
    ...game,
    status: "completed",
    phase: "completed",
    ranking,
    placements,
    points,
    winnerIds: [ranking[0]],
    finalReveal: !!game.finalReveal,
    resultText: ranking.map((id, index) => `${index + 1}. ${teamName(id)}`).join(" · "),
    updatedAt: serverNow()
  };
}

export function beerPongMatchList(game) {
  return Object.values(game?.matches || {}).sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || Number(a.round) - Number(b.round) || Number(a.table) - Number(b.table));
}

export function beerPongTieGroups(game) { return calculateBeerPongGroupTable(game).tieGroups; }

export function resetBeerPongKnockouts(game) {
  return { ...game, status: "running", phase: "groups", currentRound: Math.min(3, Math.max(1, Number(game?.currentRound) || 1)), groupEvaluated: false, groupRanking: [], groupStandings: [], semifinalsReleased: false, finalReleased: false, matches: groupMatchesOnly(game.matches), ranking: [], placements: {}, points: emptyTeamValues(), winnerIds: [], resultText: "", finalReveal: false, updatedAt: serverNow() };
}

export function resetBeerPongFinal(game) {
  const matches = { ...(game?.matches || {}) }; delete matches.final;
  return { ...game, status: "running", phase: "semifinals", finalReleased: false, matches, ranking: [], placements: {}, points: emptyTeamValues(), winnerIds: [], resultText: "", finalReveal: false, updatedAt: serverNow() };
}

export function emptyBeerPongPoints() { return emptyTeamValues(); }

function groupMatch(id, round, table, teamA, teamB) { return { id, stage: "group", label: `Runde ${round} · Tisch ${table}`, round, table, teamA, teamB, cupsPerSide: 6, status: "pending", published: false }; }
function knockoutMatch(id, stage, label, table, teamA, teamB, cupsPerSide) { return { id, stage, label, round: stage === "final" ? 1 : table, table, teamA, teamB, cupsPerSide, status: "pending", published: false }; }
function groupMatchesOnly(matches = {}) { return Object.fromEntries(BEER_PONG_GROUP_MATCHES.map(definition => [definition.id, { ...definition, ...(matches?.[definition.id] || {}) }])); }
function stageOrder(stage) { return ({ group: 0, semifinal: 1, final: 2 })[stage] ?? 9; }
function teamName(id) { return TEAMS.find(team => team.id === id)?.name || id; }
function emptyTeamValues() { return Object.fromEntries(TEAMS.map(team => [team.id, 0])); }
function integerRange(value, min, max, label) { const number = Number(value); if (!(typeof value === "number" || typeof value === "string" && value.trim() !== "") || !Number.isInteger(number) || number < min || number > max) throw new Error(`${label} muss eine ganze Zahl zwischen ${min} und ${max} sein.`); return number; }
function compareGroupStats(a, b) { return b.groupPoints - a.groupPoints || b.cupDifference - a.cupDifference || b.cupsHit - a.cupsHit; }
function exactTieGroups(rows) {
  const groups = new Map();
  rows.forEach(row => { const key = `${row.groupPoints}|${row.cupDifference}|${row.cupsHit}`; (groups.get(key) || groups.set(key, []).get(key)).push(row.teamId); });
  return [...groups.values()].filter(ids => ids.length > 1);
}
function validateTieRanks(group, ranks) {
  const values = group.map(id => Number(ranks[id]));
  if (values.some(value => !Number.isInteger(value) || value < 1 || value > group.length) || new Set(values).size !== group.length) throw new Error(`Stechen erforderlich: ${group.map(teamName).join(", ")}. Bitte eine eindeutige Reihenfolge erfassen.`);
}
