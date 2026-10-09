import { TEAMS } from "./data.js?v=challenges-3";

export const GAME_CHALLENGES = {
  id: "game-challenges",
  name: "🏆 Game Challenges",
  round: "5 Stationen · 5 Runden",
  roundCount: 5,
  durationSeconds: 240,
  description: "Fünf Reiche rotieren durch fünf Teamstationen. Jede Station vergibt interne 5/4/3/2/1 Punkte."
};

export const CHALLENGE_STATIONS = [
  { id: "cup-tower", name: "Cup Tower", icon: "🏗️", unit: "cm", resultLabel: "Höhe", integer: false, higherWins: true, instruction: "Baut in 4 Minuten einen möglichst hohen, freistehenden Becherturm. Nach Ablauf Hände weg – gemessen wird nur ein stabil stehender Turm." },
  { id: "pingpong", name: "Pingpong Challenge", icon: "🏓", unit: "Treffer", resultLabel: "Treffer aus 20", integer: true, min: 0, max: 20, higherWins: true, instruction: "Ihr habt gemeinsam 20 Versuche. Der Ball muss zuerst auf dem Tisch aufspringen und danach in einem Zielbecher landen." },
  { id: "darts", name: "Darts", icon: "🎯", unit: "Punkte", resultLabel: "Punkte aus 20 Würfen", integer: true, min: 0, higherWins: true, instruction: "Verteilt 20 Würfe frei im Team. Gezählt wird die normale Darts-Wertung inklusive Double, Triple und Bull." },
  { id: "rubber-cups", name: "Gummiband Cups", icon: "🪢", unit: "Becher", resultLabel: "Transportierte Becher", integer: true, min: 0, higherWins: true, instruction: "Transportiert die Becher nur mit Gummiband und Schnüren zur Zielseite und stapelt sie dort wieder ineinander. Hände sind tabu." },
  { id: "estimate", name: "Schätz-Challenge", icon: "🔮", unit: "Stationspunkte", resultLabel: "Schätzleistung", integer: false, higherWins: true, instruction: "Beratet euch und schreibt eure Schätzungen auf das Blatt. Gebt das Blatt danach der Spielleitung – keine Eingabe auf dem Handy." }
];

export const GAME_CHALLENGE_DEFAULT_ESTIMATES = {
  "estimate-1": estimateQuestion(1, "Wie viele Schrauben befinden sich im Glas?", "Stück"),
  "estimate-2": estimateQuestion(2, "Wie viele Gegenstände befinden sich im Behälter?", "Stück"),
  "estimate-3": estimateQuestion(3, "Wie schwer ist der Gegenstand?", "g")
};

export const GAME_CHALLENGE_ROTATIONS = Object.fromEntries(Array.from({ length: GAME_CHALLENGES.roundCount }, (_, roundIndex) => {
  const round = roundIndex + 1;
  return [`round-${round}`, Object.fromEntries(TEAMS.map((team, teamIndex) => [team.id, CHALLENGE_STATIONS[(teamIndex + roundIndex) % CHALLENGE_STATIONS.length].id]))];
}));

export function buildGameChallenges(status = "running", existing = null) {
  const now = Date.now(), running = status === "running", completed = status === "completed";
  if (!["not-started", "running", "completed"].includes(status)) throw new Error("Ungültiger Game-Challenges-Status.");
  return {
    name: GAME_CHALLENGES.name,
    round: GAME_CHALLENGES.round,
    description: GAME_CHALLENGES.description,
    status,
    currentRound: running || completed ? Number(existing?.currentRound || 1) : 0,
    phase: running ? existing?.phase || "ready" : completed ? "completed" : "hidden",
    timer: running ? { status: "idle", durationMs: GAME_CHALLENGES.durationSeconds * 1000, remainingMs: GAME_CHALLENGES.durationSeconds * 1000, startedAt: 0, endsAt: 0, ...(existing?.timer || {}) } : emptyChallengeTimer(),
    rotations: GAME_CHALLENGE_ROTATIONS,
    roundPublished: status === "not-started" ? {} : { ...(existing?.roundPublished || {}) },
    publicRounds: status === "not-started" ? {} : { ...(existing?.publicRounds || {}) },
    estimateRevealed: status === "not-started" ? false : !!existing?.estimateRevealed,
    publicEstimate: status === "not-started" ? null : existing?.publicEstimate || null,
    stations: completed ? { ...(existing?.stations || {}) } : {},
    internalPoints: completed ? { ...emptyTeamValues(), ...(existing?.internalPoints || {}) } : emptyTeamValues(),
    stationWins: completed ? { ...emptyTeamValues(), ...(existing?.stationWins || {}) } : emptyTeamValues(),
    ranking: completed ? [...(existing?.ranking || [])] : [],
    placements: completed ? { ...(existing?.placements || {}) } : {},
    winnerIds: completed ? [...(existing?.winnerIds || [])] : [],
    points: completed ? { ...emptyTeamValues(), ...(existing?.points || {}) } : emptyTeamValues(),
    resultText: completed ? existing?.resultText || "" : "",
    source: "game-challenges",
    createdAt: running ? now : existing?.createdAt || now,
    updatedAt: now
  };
}

export function normaliseGameChallengesAdmin(value = null) {
  const estimates = Object.fromEntries(Object.entries(GAME_CHALLENGE_DEFAULT_ESTIMATES).map(([key, question]) => [key, {
    ...question,
    ...(value?.estimateQuestions?.[key] || {}),
    estimates: { ...(value?.estimateQuestions?.[key]?.estimates || {}) }
  }]));
  Object.entries(value?.estimateQuestions || {}).forEach(([key, question]) => {
    if (!estimates[key]) estimates[key] = { ...question, estimates: { ...(question?.estimates || {}) } };
  });
  return { results: value?.results || {}, estimateQuestions: estimates, updatedAt: Number(value?.updatedAt || 0) };
}

export function cleanEstimateQuestion(id, value = {}) {
  const number = Number(value.number || String(id).replace(/\D/g, "")) || 1;
  return {
    id,
    number,
    text: String(value.text || "").trim().slice(0, 180),
    unit: String(value.unit || "").trim().slice(0, 30),
    correctValue: value.correctValue === "" || value.correctValue === null || value.correctValue === undefined ? "" : finiteNonNegative(value.correctValue, "Das richtige Ergebnis"),
    enabled: value.enabled !== false,
    estimates: { ...(value.estimates || {}) }
  };
}

export function cleanChallengeResult(stationId, value) {
  const station = stationById(stationId);
  if (!station || stationId === "estimate") throw new Error("Ungültige Station.");
  const number = finiteNonNegative(value, station.resultLabel);
  if (station.integer && !Number.isInteger(number)) throw new Error(`${station.resultLabel} muss eine ganze Zahl sein.`);
  if (Number.isFinite(station.max) && number > station.max) throw new Error(`${station.resultLabel} darf maximal ${station.max} betragen.`);
  return number;
}

export function cleanEstimateValue(value) {
  return finiteNonNegative(value, "Die Schätzung");
}

export function buildChallengePublicRound(roundNumber, adminValue) {
  const round = Number(roundNumber), admin = normaliseGameChallengesAdmin(adminValue), assignments = GAME_CHALLENGE_ROTATIONS[`round-${round}`];
  if (!assignments) throw new Error("Ungültige Runde.");
  const activeQuestions = challengeEstimateQuestions(admin);
  if (!activeQuestions.length) throw new Error("Mindestens eine Schätzfrage muss aktiv sein.");
  const teams = {};
  TEAMS.forEach(team => {
    const stationId = assignments[team.id], station = stationById(stationId);
    if (stationId === "estimate") {
      const missing = activeQuestions.filter(question => !Number.isFinite(Number(question.estimates?.[team.id])));
      if (missing.length) throw new Error(`${team.name}: Bitte alle Schätzungen erfassen.`);
      teams[team.id] = { stationId, stationName: station.name, icon: station.icon, submitted: true };
    } else {
      const raw = admin.results?.[stationId]?.[team.id];
      if (!Number.isFinite(Number(raw))) throw new Error(`${team.name}: Resultat für ${station.name} fehlt.`);
      teams[team.id] = { stationId, stationName: station.name, icon: station.icon, value: cleanChallengeResult(stationId, raw), unit: station.unit };
    }
  });
  return { round, teams, publishedAt: Date.now() };
}

export function buildPublicEstimate(adminValue) {
  const admin = normaliseGameChallengesAdmin(adminValue), questions = challengeEstimateQuestions(admin);
  if (!questions.length) throw new Error("Mindestens eine Schätzfrage muss aktiv sein.");
  return {
    questions: Object.fromEntries(questions.map(question => {
      if (!Number.isFinite(Number(question.correctValue))) throw new Error(`Richtiges Ergebnis fehlt: ${question.text}`);
      const correctValue = Number(question.correctValue), estimates = {}, deviations = {}, subPoints = {};
      TEAMS.forEach(team => {
        const estimate = Number(question.estimates?.[team.id]);
        if (!Number.isFinite(estimate)) throw new Error(`${team.name}: Schätzung fehlt bei „${question.text}“.`);
        estimates[team.id] = estimate;
        deviations[team.id] = fairEstimateDeviation(estimate, correctValue);
      });
      const scored = rankTeamValues(deviations, false);
      TEAMS.forEach(team => { subPoints[team.id] = scored.points[team.id]; });
      return [question.id, { id: question.id, number: question.number, text: question.text, unit: question.unit, correctValue, estimates, deviations, subPoints }];
    })),
    revealedAt: Date.now()
  };
}

export function calculateGameChallenges(game, adminValue) {
  for (let round = 1; round <= GAME_CHALLENGES.roundCount; round += 1) if (!game?.roundPublished?.[`round-${round}`]) throw new Error(`Bitte zuerst Runde ${round} veröffentlichen.`);
  if (!game?.estimateRevealed) throw new Error("Bitte zuerst die Schätz-Challenge auflösen.");
  const admin = normaliseGameChallengesAdmin(adminValue), publicEstimate = buildPublicEstimate(admin), stations = {};
  CHALLENGE_STATIONS.forEach(station => {
    let values;
    if (station.id === "estimate") {
      values = emptyTeamValues();
      Object.values(publicEstimate.questions).forEach(question => TEAMS.forEach(team => { values[team.id] += Number(question.subPoints[team.id] || 0); }));
    } else {
      values = Object.fromEntries(TEAMS.map(team => {
        const value = admin.results?.[station.id]?.[team.id];
        if (!Number.isFinite(Number(value))) throw new Error(`${station.name}: Resultat für ${team.name} fehlt.`);
        return [team.id, cleanChallengeResult(station.id, value)];
      }));
    }
    const ranked = rankTeamValues(values, true);
    stations[station.id] = { id: station.id, name: station.name, icon: station.icon, unit: station.unit, values, ...ranked };
  });
  const internalPoints = emptyTeamValues(), stationWins = emptyTeamValues();
  Object.values(stations).forEach(station => TEAMS.forEach(team => {
    internalPoints[team.id] += Number(station.points[team.id] || 0);
    if (station.placements[team.id] === 1) stationWins[team.id] += 1;
  }));
  const ranking = [...TEAMS].sort((a, b) => internalPoints[b.id] - internalPoints[a.id] || stationWins[b.id] - stationWins[a.id] || a.name.localeCompare(b.name)).map(team => team.id);
  const placements = {}, points = emptyTeamValues();
  ranking.forEach((teamId, index) => {
    const previous = ranking[index - 1];
    const tied = previous && internalPoints[teamId] === internalPoints[previous] && stationWins[teamId] === stationWins[previous];
    placements[teamId] = tied ? placements[previous] : index + 1;
    points[teamId] = 6 - placements[teamId];
  });
  const now = Date.now();
  return {
    ...game,
    status: "completed",
    phase: "completed",
    timer: emptyChallengeTimer(),
    publicEstimate,
    stations,
    internalPoints,
    stationWins,
    ranking,
    placements,
    winnerIds: ranking.filter(id => placements[id] === 1),
    points,
    resultText: ranking.map(id => `${placements[id]}. ${TEAMS.find(team => team.id === id).name} ${internalPoints[id]}/25`).join(" · "),
    source: "game-challenges",
    updatedAt: now
  };
}

export function challengeEstimateQuestions(adminValue) {
  const admin = normaliseGameChallengesAdmin(adminValue);
  return Object.values(admin.estimateQuestions).filter(question => question.enabled !== false && String(question.text || "").trim()).sort((a, b) => Number(a.number) - Number(b.number));
}

export function stationForTeam(round, teamId) {
  return stationById(GAME_CHALLENGE_ROTATIONS[`round-${Number(round)}`]?.[teamId]);
}

export function stationById(id) { return CHALLENGE_STATIONS.find(station => station.id === id) || null; }

export function challengeTimerRemaining(timer, now = Date.now()) {
  if (timer?.status === "running") return Math.max(0, Number(timer.endsAt || 0) - now);
  return Math.max(0, Number(timer?.remainingMs ?? GAME_CHALLENGES.durationSeconds * 1000));
}

export function emptyChallengeTimer() {
  return { status: "idle", durationMs: GAME_CHALLENGES.durationSeconds * 1000, remainingMs: GAME_CHALLENGES.durationSeconds * 1000, startedAt: 0, endsAt: 0 };
}

function rankTeamValues(values, higherWins) {
  const ranking = [...TEAMS].sort((a, b) => (higherWins ? Number(values[b.id]) - Number(values[a.id]) : Number(values[a.id]) - Number(values[b.id])) || a.name.localeCompare(b.name)).map(team => team.id);
  const placements = {}, points = emptyTeamValues();
  ranking.forEach((teamId, index) => {
    const previous = ranking[index - 1];
    placements[teamId] = previous && Number(values[teamId]) === Number(values[previous]) ? placements[previous] : index + 1;
    points[teamId] = 6 - placements[teamId];
  });
  return { ranking, placements, points };
}

function fairEstimateDeviation(estimate, correctValue) {
  return correctValue === 0 ? Math.abs(estimate) : Math.abs(estimate - correctValue) / Math.abs(correctValue);
}

function estimateQuestion(number, text, unit) { return { id: `estimate-${number}`, number, text, unit, correctValue: "", enabled: true, estimates: {} }; }
function emptyTeamValues() { return Object.fromEntries(TEAMS.map(team => [team.id, 0])); }
function finiteNonNegative(value, label) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error(`${label} muss eine gültige Zahl ab 0 sein.`); return number; }
