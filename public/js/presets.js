/**
 * Musical seed patterns for a polished “performance mode” start.
 */

/**
 * @typedef {object} Step
 * @property {number | null} note
 * @property {boolean} locked
 * @property {number} [probability]
 */

/**
 * @typedef {object} Preset
 * @property {string} id
 * @property {string} label
 * @property {number} bpm
 * @property {number} ratio
 * @property {number} index
 * @property {number} [swing]
 * @property {number} [cutoff]
 * @property {string} [carrierType]
 * @property {string} [modType]
 * @property {string} scaleId
 * @property {number} tonicMidi
 * @property {Step[]} steps
 */

/** @param {(number | null)[]} notes */
function unlocked(notes) {
  return notes.map((note) => ({ note, locked: false, probability: 1 }));
}

/** @type {Preset[]} */
export const PRESETS = [
  {
    id: "pulse",
    label: "Pulse",
    bpm: 120,
    ratio: 2,
    index: 140,
    swing: 0.15,
    cutoff: 4200,
    carrierType: "sine",
    modType: "sine",
    scaleId: "minor-pentatonic",
    tonicMidi: 48,
    steps: unlocked([
      60, null, 67, null, 60, null, 63, null, 67, null, 60, null, 72, null, 67, null
    ])
  },
  {
    id: "sparse",
    label: "Sparse",
    bpm: 96,
    ratio: 1.5,
    index: 80,
    swing: 0.35,
    cutoff: 2800,
    carrierType: "triangle",
    modType: "sine",
    scaleId: "natural-minor",
    tonicMidi: 45,
    steps: unlocked([
      57, null, null, 60, null, null, 64, null, 57, null, null, 67, null, 60, null, null
    ])
  },
  {
    id: "climb",
    label: "Climb",
    bpm: 132,
    ratio: 3,
    index: 220,
    swing: 0.05,
    cutoff: 6200,
    carrierType: "sine",
    modType: "square",
    scaleId: "major-pentatonic",
    tonicMidi: 48,
    steps: unlocked([
      48, 52, 55, null, 55, 59, 62, null, 62, 67, 71, null, 71, 74, 79, null
    ])
  }
];

/**
 * @param {string} id
 * @returns {Preset | undefined}
 */
export function getPreset(id) {
  return PRESETS.find((preset) => preset.id === id);
}
