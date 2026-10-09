const rankings = new WeakMap();
const MOVE_DURATION = 620;
const SCORE_DURATION = 640;
const DELTA_DURATION = 2000;

/**
 * Update an existing ranking without replacing its team rows.
 * Each entry supplies { id, points, html, className, color, glow }; html marks
 * the score number with data-score and can mark its parent data-score-container.
 * State belongs to this page only, so restored scores never replay on reload.
 */
export function renderRanking(list, entries) {
  if (!list) return;
  const view = list.ownerDocument.defaultView;
  let state = rankings.get(list);
  if (!state) {
    state = { rows: new Map(), order: [], visible: false, view, media: view?.matchMedia?.("(prefers-reduced-motion: reduce)"), preferenceHandler: null };
    rankings.set(list, state);
  }
  const visible = isVisible(list);
  const reducedMotion = state.media?.matches;
  const canAnimate = state.visible && visible && !reducedMotion && typeof view?.requestAnimationFrame === "function";
  const nextOrder = entries.map(entry => String(entry.id));
  const orderChanged = state.order.length !== nextOrder.length || state.order.some((id, index) => id !== nextOrder[index]);
  const previousRects = new Map();

  // Capture the current visual position before cancelling an interrupted move.
  for (const [id, rowState] of state.rows) {
    if (canAnimate && orderChanged) previousRects.set(id, rowState.row.getBoundingClientRect());
    if (orderChanged || !canAnimate) cancelMove(rowState);
    if (!canAnimate) {
      finishScore(rowState, view);
      removeDelta(rowState, view);
    }
  }

  const retained = new Set();
  for (const entry of entries) {
    const id = String(entry.id);
    const points = Number(entry.points);
    if (!Number.isFinite(points)) continue;
    let rowState = state.rows.get(id);
    if (!rowState) {
      const row = [...list.children].find(child => child.tagName === "LI" && child.dataset.teamId === id) || list.ownerDocument.createElement("li");
      rowState = { row, owner: state, score: null, target: undefined, displayed: points, html: undefined, frame: null, move: null, delta: null, deltaAnimation: null, deltaTimer: null };
      state.rows.set(id, rowState);
    }
    const row = rowState.row;
    const previousTarget = rowState.target;
    row.dataset.teamId = id;
    row.className = entry.className || "";
    if (entry.color != null) row.style.setProperty("--team", entry.color);
    if (entry.glow != null) row.style.setProperty("--glow", entry.glow);
    updateContents(rowState, String(entry.html || ""));
    rowState.target = points;
    retained.add(row);
    list.appendChild(row);

    if (previousTarget === undefined || !canAnimate) {
      finishScore(rowState, view);
    } else if (previousTarget !== points) {
      animateScore(rowState, view);
      showDelta(rowState, points - previousTarget, view);
    } else if (rowState.frame == null && rowState.score) {
      rowState.score.textContent = formatScore(points);
    }
  }

  for (const [id, rowState] of state.rows) {
    if (!retained.has(rowState.row)) {
      finishScore(rowState, view);
      cancelMove(rowState);
      removeDelta(rowState, view);
      state.rows.delete(id);
    }
  }
  for (const child of [...list.children]) if (!retained.has(child)) child.remove();

  if (canAnimate && orderChanged) {
    for (const [id, rowState] of state.rows) {
      const previous = previousRects.get(id);
      if (!previous || typeof rowState.row.animate !== "function") continue;
      const current = rowState.row.getBoundingClientRect();
      const x = previous.left - current.left;
      const y = previous.top - current.top;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const animation = rowState.row.animate([
        { transform: `translate(${x}px, ${y}px)` },
        { transform: "translate(0, 0)" }
      ], { duration: MOVE_DURATION, easing: "cubic-bezier(.2,.75,.25,1)" });
      rowState.move = animation;
      animation.onfinish = () => {
        if (rowState.move === animation) rowState.move = null;
        stopWatchingIfIdle(state);
      };
    }
  }
  state.order = nextOrder;
  state.visible = isVisible(list);
  watchMotionPreference(state);
}

function isVisible(list) {
  if (!list.isConnected) return false;
  const rect = list.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function updateContents(rowState, html) {
  if (rowState.html === html) return;
  const previousScore = rowState.score;
  rowState.row.innerHTML = html;
  let score = rowState.row.querySelector("[data-score]");
  // Keep an active score tween when badges, ranks or other text change.
  if (previousScore && score && previousScore.tagName === score.tagName) {
    for (const attribute of [...previousScore.attributes]) previousScore.removeAttribute(attribute.name);
    for (const attribute of [...score.attributes]) previousScore.setAttribute(attribute.name, attribute.value);
    score.replaceWith(previousScore);
    score = previousScore;
  }
  rowState.score = score;
  rowState.html = html;
  if (score) score.textContent = formatScore(Number.isInteger(rowState.target) ? Math.round(rowState.displayed) : rowState.displayed);
  if (rowState.delta && score) deltaContainer(rowState).appendChild(rowState.delta);
}

function animateScore(rowState, view) {
  if (rowState.frame != null) view.cancelAnimationFrame(rowState.frame);
  rowState.frame = null;
  if (!rowState.score) {
    rowState.displayed = rowState.target;
    return;
  }
  const from = rowState.displayed;
  const target = rowState.target;
  const integer = Number.isInteger(target);
  const startedAt = view.performance.now();
  const tick = now => {
    const progress = Math.min(1, Math.max(0, (now - startedAt) / SCORE_DURATION));
    const eased = 1 - Math.pow(1 - progress, 3);
    rowState.displayed = from + (target - from) * eased;
    rowState.score.textContent = formatScore(integer ? Math.round(rowState.displayed) : rowState.displayed);
    if (progress < 1) rowState.frame = view.requestAnimationFrame(tick);
    else {
      rowState.frame = null;
      rowState.displayed = target;
      rowState.score.textContent = formatScore(target);
      stopWatchingIfIdle(rowState.owner);
    }
  };
  rowState.frame = view.requestAnimationFrame(tick);
}

function finishScore(rowState, view) {
  if (rowState.frame != null) view?.cancelAnimationFrame(rowState.frame);
  rowState.frame = null;
  if (rowState.target === undefined) return;
  rowState.displayed = rowState.target;
  if (rowState.score) rowState.score.textContent = formatScore(rowState.target);
  stopWatchingIfIdle(rowState.owner);
}

function showDelta(rowState, difference, view) {
  removeDelta(rowState, view);
  if (!rowState.score || !difference) return;
  const delta = rowState.row.ownerDocument.createElement("span");
  delta.className = `ranking-delta${difference < 0 ? " is-negative" : ""}`;
  delta.setAttribute("aria-hidden", "true");
  delta.textContent = `${difference > 0 ? "+" : "−"}${formatScore(Math.abs(difference))}`;
  rowState.delta = delta;
  deltaContainer(rowState).appendChild(delta);
  if (typeof delta.animate === "function") {
    rowState.deltaAnimation = delta.animate([
      { opacity: 0, transform: "translateY(5px)", offset: 0 },
      { opacity: 1, transform: "translateY(0)", offset: 0.08 },
      { opacity: 1, transform: "translateY(0)", offset: 0.72 },
      { opacity: 0, transform: "translateY(-6px)", offset: 1 }
    ], { duration: DELTA_DURATION, easing: "ease-out" });
  }
  rowState.deltaTimer = view.setTimeout(() => removeDelta(rowState, view), DELTA_DURATION);
}

function deltaContainer(rowState) {
  return rowState.score.closest("[data-score-container]") || rowState.score.parentElement;
}

function removeDelta(rowState, view) {
  if (rowState.deltaTimer != null) view?.clearTimeout(rowState.deltaTimer);
  rowState.deltaTimer = null;
  rowState.deltaAnimation?.cancel();
  rowState.deltaAnimation = null;
  rowState.delta?.remove();
  rowState.delta = null;
  stopWatchingIfIdle(rowState.owner);
}

function cancelMove(rowState) {
  rowState.move?.cancel();
  rowState.move = null;
  stopWatchingIfIdle(rowState.owner);
}

function watchMotionPreference(state) {
  if (state.preferenceHandler || !state.media?.addEventListener || !hasAnimation(state)) return;
  state.preferenceHandler = event => {
    if (!event.matches) return;
    for (const rowState of state.rows.values()) {
      finishScore(rowState, state.view);
      cancelMove(rowState);
      removeDelta(rowState, state.view);
    }
    stopWatchingIfIdle(state);
  };
  state.media.addEventListener("change", state.preferenceHandler);
}

function stopWatchingIfIdle(state) {
  if (!state.preferenceHandler || hasAnimation(state)) return;
  state.media.removeEventListener("change", state.preferenceHandler);
  state.preferenceHandler = null;
}

function hasAnimation(state) {
  return [...state.rows.values()].some(rowState => rowState.frame != null || rowState.move || rowState.delta);
}

function formatScore(value) {
  return String(Number(Number(value).toFixed(2)));
}
