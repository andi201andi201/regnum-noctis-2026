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
    hunt: { active: false, roundId: "", startedAt: 0, stoppedAt: 0, targetCount: 10, targets: {} },
    oracle: { active: false, revealed: false, roundId: "", question: "", answer: 0, unit: "", maxPoints: 5, startedAt: 0, endsAt: 0, results: {} }
  },
  games: {},
  songBattleAnswers: {},
  songBattleParticipants: {},
  songBattleAdmin: { evaluations: {}, internalPoints: {} },
  novitiusParticipants: {},
  novitiusAnswers: {},
  novitiusSubmissions: {},
  novitiusAdmin: { questions: {} },
  huntAdmin: { targets: {} },
  beerPongAdmin: { drafts: {}, tieBreakRanks: {}, updatedAt: 0 },
  oracleAnswers: {},
  oracleQuestions: {}
};

export const SONG_BATTLE = {
  id: "song-battle",
  name: "🎵 Song Battle",
  round: "Vormittag",
  durationMinutes: 15,
  songCount: 6,
  description: "Erkennt bei sechs Songs jeweils Titel und Interpret. Pro richtige Angabe gibt es einen internen Punkt."
};

export const NOVITIUS_GAME = {
  id: "novitius-quiz",
  name: "Wer kennt den Novitius?",
  subjectName: "Simon",
  round: "Vormittag",
  durationMinutes: 15,
  questionCount: 10,
  description: "Wie gut kennt ihr Simon? Beantwortet zehn Schätzfragen und sammelt für euer Reich möglichst viele Punkte."
};

export const NOVITIUS_DEFAULT_QUESTIONS = {
  "question-1": novitiusQuestion(1, "Wie viele Minuten braucht Simon morgens vom Wecker bis zur Haustür?", "number", "Minuten", 25, [2, 5, 10]),
  "question-2": novitiusQuestion(2, "Wie viele Bier würde Simon an einem langen Abend realistisch trinken?", "number", "Bier", 12, [1, 3, 6]),
  "question-3": novitiusQuestion(3, "Wie viele Fotos sind ungefähr auf Simons Handy?", "number", "Fotos", 17643, [0.1, 0.25, 0.5], "percentage"),
  "question-4": novitiusQuestion(4, "Wie viele Paar Schuhe besitzt Simon?", "number", "Paar", 7, [0, 1, 2]),
  "question-5": novitiusQuestion(5, "Wie viele Länder hat Simon schon besucht?", "number", "Länder", 17, [1, 3, 5]),
  "question-6": novitiusQuestion(6, "Wie viele Minuten braucht Simon durchschnittlich zum Duschen?", "number", "Minuten", 10, [1, 3, 5]),
  "question-7": novitiusQuestion(7, "Wie viele Wecker stellt Simon morgens?", "number", "Wecker", 3, [0, 1, 2]),
  "question-8": novitiusQuestion(8, "Wie spät war Simon spätestens noch im Ausgang?", "time", "Uhr", "08:00", [30, 90, 180], "time"),
  "question-9": novitiusQuestion(9, "Wie viele Raclette-Pfännchen schafft Simon?", "number", "Pfännchen", 5, [0, 1, 2]),
  "question-10": { ...novitiusQuestion(10, "Wie viele Gummibärchen passen gleichzeitig in Simons Mund?", "number", "Gummibärchen", "", [0, 1, 2]), liveAnswer: true }
};

export const GAME_STATUSES = {
  "not-started": "Noch nicht gestartet",
  running: "Läuft",
  completed: "Beendet"
};

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

export function buildNovitiusGame(status = "running", existing = null) {
  if (!Object.hasOwn(GAME_STATUSES, status)) throw new Error("Bitte einen gültigen Spielstatus wählen.");
  const now = Date.now();
  const { id, questionCount, ...definition } = NOVITIUS_GAME;
  return {
    ...definition,
    status,
    registrationOpen: status === "running" && !existing?.participantsLocked,
    participantsLocked: status === "completed" ? true : !!existing?.participantsLocked,
    roundId: status === "not-started" ? "" : existing?.roundId || now.toString(36),
    teamSizes: status === "not-started" ? emptyTeamPoints() : { ...emptyTeamPoints(), ...(existing?.teamSizes || {}) },
    currentQuestion: status === "not-started" ? 0 : Number(existing?.currentQuestion || 0),
    currentQuestionData: status === "running" ? existing?.currentQuestionData || null : null,
    answersOpen: status === "running" ? !!existing?.answersOpen : false,
    questionStates: status === "not-started" ? lockedNovitiusQuestions() : { ...lockedNovitiusQuestions(), ...(existing?.questionStates || {}) },
    revealedQuestions: status === "not-started" ? {} : { ...(existing?.revealedQuestions || {}) },
    publicReveals: status === "not-started" ? {} : { ...(existing?.publicReveals || {}) },
    tieBreak: status === "not-started" ? null : existing?.tieBreak || null,
    ranking: status === "completed" ? [...(existing?.ranking || [])] : [],
    placements: status === "completed" ? { ...(existing?.placements || {}) } : {},
    winnerIds: status === "completed" ? [...(existing?.winnerIds || [])] : [],
    points: status === "completed" ? { ...(existing?.points || emptyTeamPoints()) } : emptyTeamPoints(),
    internalPoints: status === "completed" ? { ...(existing?.internalPoints || emptyTeamPoints()) } : {},
    resultText: status === "completed" ? existing?.resultText || "" : "",
    source: "novitius-quiz",
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

export function scoreNovitiusAnswer(question, value) {
  if (question?.correctValue === null || question?.correctValue === undefined || question?.correctValue === "") return { points: 0, deviation: Infinity };
  const deviation = novitiusDeviation(question.scoreMode || question.type, value, question.correctValue);
  const thresholds = Array.isArray(question.thresholds) ? question.thresholds.map(Number) : [];
  const index = thresholds.findIndex(limit => Number.isFinite(limit) && deviation <= limit);
  return { points: index < 0 ? 0 : 3 - index, deviation };
}

export function novitiusDeviation(mode, value, correctValue) {
  if (mode === "time") {
    const answerMinutes = timeToMinutes(value), correctMinutes = timeToMinutes(correctValue);
    if (!Number.isFinite(answerMinutes) || !Number.isFinite(correctMinutes)) return Infinity;
    const direct = Math.abs(answerMinutes - correctMinutes);
    return Math.min(direct, 1440 - direct);
  }
  const answer = Number(value), correct = Number(correctValue);
  if (!Number.isFinite(answer) || !Number.isFinite(correct)) return Infinity;
  if (mode === "percentage") return correct === 0 ? (answer === 0 ? 0 : Infinity) : Math.abs(answer - correct) / Math.abs(correct);
  return Math.abs(answer - correct);
}

export function buildNovitiusReveal(question, participants = {}, answers = {}, teamSizes = {}, cumulative = null) {
  if (question?.correctValue === null || question?.correctValue === undefined || question?.correctValue === "") throw new Error("Bitte zuerst Simons korrekte Antwort eintragen.");
  const scored = Object.entries(participants).map(([participantId, participant]) => {
    const answer = answers?.[participantId] || null;
    const result = answer ? scoreNovitiusAnswer(question, answer.value) : { points: 0, deviation: Infinity };
    return { participantId, playerName: participant.playerName, teamId: participant.teamId, value: answer?.value ?? null, ...result };
  });
  const teamRoundScores = Object.fromEntries(TEAMS.map(team => {
    const divisor = Number(teamSizes?.[team.id] || 0);
    const sum = scored.filter(item => item.teamId === team.id).reduce((total, item) => total + item.points, 0);
    return [team.id, divisor ? sum / divisor : 0];
  }));
  const teamTotals = Object.fromEntries(TEAMS.map(team => [team.id, Number(cumulative?.[team.id] || 0) + teamRoundScores[team.id]]));
  const ranking = [...TEAMS].sort((a, b) => teamTotals[b.id] - teamTotals[a.id] || a.name.localeCompare(b.name)).map(team => team.id);
  return {
    questionNumber: question.number,
    question: question.text,
    type: question.type,
    unit: question.unit || "",
    correctValue: question.correctValue,
    thresholds: [...question.thresholds],
    scoreMode: question.scoreMode || question.type,
    submittedCount: scored.filter(item => item.value !== null).length,
    teamRoundScores,
    teamTotals,
    ranking,
    revealedAt: Date.now()
  };
}

export function rebuildNovitiusReveals(questions = {}, participants = {}, answers = {}, teamSizes = {}, revealedQuestions = {}) {
  const reveals = {};
  let cumulative = emptyTeamPoints();
  for (let number = 1; number <= NOVITIUS_GAME.questionCount; number += 1) {
    const key = `question-${number}`;
    if (!revealedQuestions?.[key]) continue;
    const question = questions?.[key];
    if (!question) continue;
    const questionAnswers = Object.fromEntries(Object.entries(answers || {}).map(([id, values]) => [id, values?.[key]]).filter(([, answer]) => answer));
    const reveal = buildNovitiusReveal(question, participants, questionAnswers, teamSizes, cumulative);
    reveals[key] = reveal;
    cumulative = reveal.teamTotals;
  }
  return reveals;
}

export function finalizeNovitiusGame(game, questions, participants = {}, answers = {}) {
  if (!Object.keys(participants).length) throw new Error("Es ist noch niemand für das Spiel angemeldet.");
  const missingSolutions = Array.from({ length: NOVITIUS_GAME.questionCount }, (_, index) => index + 1).filter(number => {
    const value = questions?.[`question-${number}`]?.correctValue;
    return value === null || value === undefined || value === "";
  });
  if (missingSolutions.length) throw new Error(`Bitte zuerst Simons korrekte Antwort für Frage ${missingSolutions.join(", ")} eintragen.`);
  if (Object.keys(game?.revealedQuestions || {}).filter(key => game.revealedQuestions[key]).length < NOVITIUS_GAME.questionCount) throw new Error("Bitte zuerst alle zehn Fragen auflösen.");
  const totals = Object.fromEntries(Object.keys(participants).map(id => [id, 0]));
  const perfects = Object.fromEntries(TEAMS.map(team => [team.id, 0]));
  for (let number = 1; number <= NOVITIUS_GAME.questionCount; number += 1) {
    const question = questions?.[`question-${number}`];
    if (!question) continue;
    Object.keys(participants).forEach(participantId => {
      const answer = answers?.[participantId]?.[`question-${number}`];
      if (answer) {
        const points = scoreNovitiusAnswer(question, answer.value).points;
        totals[participantId] += points;
        if (points === 3) perfects[participants[participantId].teamId] += 1;
      }
    });
  }
  const internalPoints = Object.fromEntries(TEAMS.map(team => {
    const divisor = Number(game?.teamSizes?.[team.id] || 0);
    const sum = Object.keys(participants).filter(id => participants[id].teamId === team.id).reduce((total, id) => total + totals[id], 0);
    return [team.id, divisor ? sum / divisor : 0];
  }));
  const perfectRates = Object.fromEntries(TEAMS.map(team => [team.id, Number(game?.teamSizes?.[team.id] || 0) ? perfects[team.id] / Number(game.teamSizes[team.id]) : 0]));
  const tieOrder = new Map((game?.tieBreak?.ranking || []).map((id, index) => [id, index]));
  const ranking = [...TEAMS].sort((a, b) => internalPoints[b.id] - internalPoints[a.id] || perfectRates[b.id] - perfectRates[a.id] || (tieOrder.get(a.id) ?? 99) - (tieOrder.get(b.id) ?? 99) || a.name.localeCompare(b.name)).map(team => team.id);
  const unresolved = novitiusTieGroups(internalPoints, perfectRates).filter(group => group.teamIds.some(id => !tieOrder.has(id)));
  if (unresolved.length) throw new Error(`Gleichstand – Stechfrage erforderlich: ${unresolved.map(group => group.teamIds.map(id => TEAMS.find(team => team.id === id).name).join(" / ")).join("; ")}`);
  const placements = {}, points = emptyTeamPoints();
  ranking.forEach((teamId, index) => {
    placements[teamId] = index + 1;
    points[teamId] = TEAMS.length - index;
  });
  const now = Date.now();
  return {
    ...game,
    status: "completed",
    registrationOpen: false,
    participantsLocked: true,
    answersOpen: false,
    currentQuestionData: null,
    ranking,
    placements,
    winnerIds: ranking.filter(id => placements[id] === 1),
    points,
    internalPoints,
    perfectRates,
    participantCount: Object.keys(participants).length,
    resultText: ranking.map(teamId => `${placements[teamId]}. ${TEAMS.find(team => team.id === teamId).name} ${internalPoints[teamId].toFixed(2)}/30`).join(" · "),
    source: "novitius-quiz",
    createdAt: game?.status === "completed" ? game.createdAt : now,
    updatedAt: now
  };
}

export function novitiusTieGroups(internalPoints = {}, perfectRates = {}) {
  const groups = new Map();
  TEAMS.forEach(team => {
    const key = `${Number(internalPoints[team.id] || 0).toFixed(10)}|${Number(perfectRates[team.id] || 0).toFixed(10)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(team.id);
  });
  return [...groups.values()].filter(teamIds => teamIds.length > 1).map(teamIds => ({ teamIds }));
}

function novitiusQuestion(number, text, type, unit, correctValue, thresholds, scoreMode = "absolute") {
  return { number, text, type, unit, correctValue, thresholds, scoreMode, liveAnswer: false };
}

function lockedNovitiusQuestions() {
  return Object.fromEntries(Array.from({ length: NOVITIUS_GAME.questionCount }, (_, index) => [`question-${index + 1}`, "locked"]));
}

function timeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return NaN;
  const hours = Number(match[1]), minutes = Number(match[2]);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 ? hours * 60 + minutes : NaN;
}

function emptyTeamPoints() {
  return Object.fromEntries(TEAMS.map(team => [team.id, 0]));
}

export function hasGameResult(game) {
  return game?.source !== "team-hunt" && game?.source !== "oracle" && game?.source !== "ballon-game" && game?.id !== "ballon-game" && (!game.status || game.status === "completed");
}

export function totalsFromGames(games = {}) {
  const totals = Object.fromEntries(TEAMS.map(team => [team.id, 0]));
  Object.entries(games || {}).filter(([id, game]) => id !== "ballon-game" && game?.source !== "oracle" && game?.source !== "ballon-game").map(([, game]) => game).filter(game => game?.source === "team-hunt" || hasGameResult(game)).forEach(game => TEAMS.forEach(team => {
    totals[team.id] += Number(game.points?.[team.id] || 0);
  }));
  return totals;
}

export function sortedGames(games = {}) {
  return Object.entries(games || {}).filter(([id, game]) => id !== "ballon-game" && game?.source !== "oracle" && game?.source !== "ballon-game" && game?.source !== "team-hunt").map(([id, game]) => ({ id, ...game })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function formatTime(timestamp, withDate = false) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("de-CH", withDate ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}
