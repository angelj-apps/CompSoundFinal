/**
 * Saved melody stack: localStorage snapshots (steps + scene) you can loop live.
 */

const STORAGE_KEY = "fm-groovebox-melody-stack";
const MAX_SLOTS = 6;

/**
 * @typedef {object} MelodyStep
 * @property {number | null} note
 * @property {boolean} [locked]
 * @property {number} [probability]
 */

/**
 * Full instrument scene stored with each saved melody.
 * @typedef {object} MelodyScene
 * @property {number} bpm
 * @property {number} swing
 * @property {number} masterGain
 * @property {number} ratio
 * @property {number} index
 * @property {number} cutoff
 * @property {number} feedback
 * @property {string} carrierType
 * @property {string} modType
 * @property {string} scaleId
 * @property {number} tonicMidi
 * @property {number} density
 * @property {number} ampAttack
 * @property {number} ampDecay
 * @property {number} climateBias
 */

/**
 * @typedef {object} MelodyEntry
 * @property {string} id
 * @property {string} name
 * @property {MelodyStep[]} steps
 * @property {MelodyScene} scene
 * @property {boolean} armed
 */

/**
 * @param {MelodyStep[]} steps
 */
function cloneSteps(steps) {
  return steps.map((step) => ({
    note: step.note,
    locked: Boolean(step.locked),
    probability: step.probability ?? 1
  }));
}

/**
 * @param {Partial<MelodyScene> | null | undefined} scene
 * @returns {MelodyScene}
 */
export function normalizeScene(scene) {
  const s = scene && typeof scene === "object" ? scene : {};
  return {
    bpm: Number(s.bpm) || 120,
    swing: Number(s.swing) || 0,
    masterGain: Number.isFinite(Number(s.masterGain)) ? Number(s.masterGain) : 0.35,
    ratio: Number(s.ratio) || 2,
    index: Number(s.index) || 140,
    cutoff: Number(s.cutoff) || 4200,
    feedback: Number(s.feedback) || 0.08,
    carrierType: typeof s.carrierType === "string" ? s.carrierType : "sine",
    modType: typeof s.modType === "string" ? s.modType : "sine",
    scaleId: typeof s.scaleId === "string" ? s.scaleId : "minor-pentatonic",
    tonicMidi: Number(s.tonicMidi) || 48,
    density: Number(s.density) || 0.5,
    ampAttack: Number.isFinite(Number(s.ampAttack)) ? Number(s.ampAttack) : 0.008,
    ampDecay: Number.isFinite(Number(s.ampDecay)) ? Number(s.ampDecay) : 0.2,
    climateBias: Number.isFinite(Number(s.climateBias)) ? Number(s.climateBias) : 0
  };
}

/**
 * @param {MelodyScene} scene
 */
function cloneScene(scene) {
  return normalizeScene(scene);
}

/**
 * @returns {MelodyEntry[]}
 */
function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.id === "string" && Array.isArray(entry.steps))
      .slice(0, MAX_SLOTS)
      .map((entry, index) => ({
        id: entry.id,
        name: typeof entry.name === "string" && entry.name.trim() ? entry.name : `Melody ${index + 1}`,
        steps: cloneSteps(entry.steps),
        scene: normalizeScene(entry.scene),
        armed: Boolean(entry.armed)
      }));
  } catch {
    return [];
  }
}

/**
 * @param {MelodyEntry[]} entries
 */
function writeStorage(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota */
  }
}

export function createMelodyStack() {
  /** @type {MelodyEntry[]} */
  let entries = readStorage();

  function persist() {
    writeStorage(entries);
  }

  return {
    maxSlots: MAX_SLOTS,

    /**
     * @returns {MelodyEntry[]}
     */
    list() {
      return entries.map((entry) => ({
        ...entry,
        steps: cloneSteps(entry.steps),
        scene: cloneScene(entry.scene)
      }));
    },

    /**
     * Layers for the scheduler (armed flag + steps + voice scene).
     */
    layersForScheduler() {
      return entries.map((entry) => ({
        armed: entry.armed,
        steps: cloneSteps(entry.steps),
        scene: cloneScene(entry.scene)
      }));
    },

    /**
     * @param {MelodyStep[]} steps
     * @param {MelodyScene} scene
     * @param {string} [name]
     * @returns {{ ok: true, entry: MelodyEntry } | { ok: false, reason: string }}
     */
    add(steps, scene, name) {
      if (entries.length >= MAX_SLOTS) {
        return { ok: false, reason: `Stack full (${MAX_SLOTS} max)` };
      }
      const id = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const entry = {
        id,
        name: name?.trim() || `Melody ${entries.length + 1}`,
        steps: cloneSteps(steps),
        scene: cloneScene(scene),
        armed: false
      };
      entries = [...entries, entry];
      persist();
      return {
        ok: true,
        entry: {
          ...entry,
          steps: cloneSteps(entry.steps),
          scene: cloneScene(entry.scene)
        }
      };
    },

    /**
     * @param {string} id
     */
    remove(id) {
      entries = entries.filter((entry) => entry.id !== id);
      persist();
    },

    /**
     * @param {string} id
     * @param {boolean} playing
     * @returns {boolean}
     */
    setPlaying(id, playing) {
      const entry = entries.find((item) => item.id === id);
      if (!entry) return false;
      entry.armed = Boolean(playing);
      persist();
      return entry.armed;
    },

    /**
     * @param {string} id
     * @returns {boolean}
     */
    togglePlaying(id) {
      const entry = entries.find((item) => item.id === id);
      if (!entry) return false;
      entry.armed = !entry.armed;
      persist();
      return entry.armed;
    },

    /**
     * @param {string} id
     * @returns {boolean}
     */
    toggleArmed(id) {
      return this.togglePlaying(id);
    },

    /**
     * @param {string} id
     * @returns {MelodyEntry | null}
     */
    get(id) {
      const entry = entries.find((item) => item.id === id);
      if (!entry) return null;
      return {
        ...entry,
        steps: cloneSteps(entry.steps),
        scene: cloneScene(entry.scene)
      };
    }
  };
}
