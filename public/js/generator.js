/**
 * Constrained pattern generation / mutation with visible Markov vs weighted mode.
 */

/**
 * @typedef {object} Step
 * @property {number | null} note
 * @property {boolean} locked
 * @property {number} [probability]
 */

/** @type {Record<string, number[]>} */
const SCALE_INTERVALS = {
  "minor-pentatonic": [0, 3, 5, 7, 10],
  "major-pentatonic": [0, 2, 4, 7, 9],
  "natural-minor": [0, 2, 3, 5, 7, 8, 10]
};

/**
 * @typedef {object} GenerateResult
 * @property {Step[]} steps
 * @property {{ mode: "markov" | "weighted", markovPicks: number, weightedPicks: number, density: number }} meta
 */

function intervalsFor(scaleId) {
  return SCALE_INTERVALS[scaleId] ?? SCALE_INTERVALS["minor-pentatonic"];
}

/**
 * @param {number} tonicMidi
 * @param {string} scaleId
 * @param {number} [octaves]
 */
export function pitchesForScale(tonicMidi, scaleId, octaves = 2) {
  const intervals = intervalsFor(scaleId);
  const root = Math.round(tonicMidi);
  /** @type {number[]} */
  const pitches = [];
  for (let octave = 0; octave < octaves; octave += 1) {
    for (const interval of intervals) {
      const midi = root + octave * 12 + interval;
      if (midi >= 24 && midi <= 84) pitches.push(midi);
    }
  }
  return pitches;
}

function nearestPitchIndex(pitches, midi) {
  let best = 0;
  let bestDist = Infinity;
  pitches.forEach((pitch, index) => {
    const dist = Math.abs(pitch - midi);
    if (dist < bestDist) {
      bestDist = dist;
      best = index;
    }
  });
  return best;
}

function weightedRandomPitch(pitches, scaleId) {
  const degreeCount = intervalsFor(scaleId).length;
  const weights = pitches.map((_, index) => {
    const degree = index % degreeCount;
    if (degree === 0) return 3;
    if (degree === Math.floor(degreeCount / 2)) return 2;
    return 1;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  let pick = Math.random() * total;
  for (let i = 0; i < pitches.length; i += 1) {
    pick -= weights[i];
    if (pick <= 0) return pitches[i];
  }
  return pitches[pitches.length - 1];
}

function buildTransitionTable(steps, pitches) {
  /** @type {Map<number, Map<number, number>>} */
  const table = new Map();
  const indices = steps
    .map((step) => step.note)
    .filter((note) => note != null)
    .map((note) => nearestPitchIndex(pitches, /** @type {number} */ (note)));

  for (let i = 0; i < indices.length - 1; i += 1) {
    const from = indices[i];
    const to = indices[i + 1];
    if (!table.has(from)) table.set(from, new Map());
    const row = table.get(from);
    row.set(to, (row.get(to) ?? 0) + 1);
  }
  return table;
}

function sampleTransition(row, pitches, scaleId) {
  if (!row || row.size === 0) {
    return { note: weightedRandomPitch(pitches, scaleId), usedMarkov: false };
  }
  let total = 0;
  for (const count of row.values()) total += count;
  let pick = Math.random() * total;
  for (const [toIndex, count] of row) {
    pick -= count;
    if (pick <= 0) return { note: pitches[toIndex], usedMarkov: true };
  }
  return { note: pitches[pitches.length - 1], usedMarkov: true };
}

function preserveMeta(step, note) {
  return {
    note,
    locked: false,
    probability: step.probability ?? 1
  };
}

/**
 * @param {Step[]} steps
 * @param {{ scaleId: string, tonicMidi: number, density?: number }} options
 * @returns {GenerateResult}
 */
export function generatePattern(steps, options) {
  const { scaleId, tonicMidi, density = 0.5 } = options;
  const pitches = pitchesForScale(tonicMidi, scaleId);
  if (pitches.length === 0) {
    return {
      steps: steps.map((step) => ({ ...step })),
      meta: { mode: "weighted", markovPicks: 0, weightedPicks: 0, density }
    };
  }

  const transitions = buildTransitionTable(steps, pitches);
  const hasMarkov = transitions.size > 0;
  let previousIndex = null;
  let markovPicks = 0;
  let weightedPicks = 0;

  const nextSteps = steps.map((step, index) => {
    if (step.locked) return { ...step };

    const onDownbeat = index % 4 === 0;
    const localDensity = onDownbeat ? Math.min(1, density + 0.2) : density;
    if (Math.random() > localDensity) {
      previousIndex = null;
      return preserveMeta(step, null);
    }

    let note;
    let usedMarkov = false;
    if (previousIndex != null && transitions.has(previousIndex)) {
      const sample = sampleTransition(transitions.get(previousIndex), pitches, scaleId);
      note = sample.note;
      usedMarkov = sample.usedMarkov;
    } else {
      note = weightedRandomPitch(pitches, scaleId);
    }

    if (usedMarkov) markovPicks += 1;
    else weightedPicks += 1;

    previousIndex = nearestPitchIndex(pitches, note);
    return preserveMeta(step, note);
  });

  return {
    steps: nextSteps,
    meta: {
      mode: hasMarkov && markovPicks > 0 ? "markov" : "weighted",
      markovPicks,
      weightedPicks,
      density
    }
  };
}

/**
 * @param {Step[]} steps
 * @param {{ scaleId: string, tonicMidi: number, probability?: number }} options
 */
export function mutatePattern(steps, options) {
  const { scaleId, tonicMidi, probability = 0.35 } = options;
  const pitches = pitchesForScale(tonicMidi, scaleId);
  let changed = 0;

  const nextSteps = steps.map((step) => {
    if (step.locked || Math.random() > probability || pitches.length === 0) {
      return { ...step };
    }

    changed += 1;

    if (step.note == null) {
      return preserveMeta(step, weightedRandomPitch(pitches, scaleId));
    }

    const roll = Math.random();
    if (roll < 0.25) {
      return preserveMeta(step, null);
    }

    const index = nearestPitchIndex(pitches, step.note);
    const delta = Math.random() < 0.5 ? -1 : 1;
    const nudged = pitches[(index + delta + pitches.length) % pitches.length];
    return preserveMeta(step, nudged);
  });

  return { steps: nextSteps, changed };
}
