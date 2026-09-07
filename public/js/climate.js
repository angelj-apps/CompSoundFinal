/**
 * Climate: the living score's world clock.
 * A season advances every few bars and sets a temperature target; temperature
 * eases toward it and is what actually drives drift, growth, palette and tone.
 */

/** Bars spent in each season before the next one takes over. */
const BARS_PER_SEASON = 4;
/** Fraction of the remaining gap closed per bar, so seasons glide. */
const TEMP_EASE = 0.25;

/**
 * @typedef {object} SeasonPalette
 * @property {[number, number, number]} mark
 * @property {[number, number, number]} soilTop
 * @property {[number, number, number]} soilBottom
 */

/**
 * @typedef {object} Season
 * @property {string} name
 * @property {number} tempTarget Where temperature glides while this season holds.
 * @property {number} drift Multiplier on the FM-derived drift step.
 * @property {number} damping Velocity retained per frame.
 * @property {number} wind Vertical bias; negative drifts pitch upward.
 * @property {number} sprout Per-bar chance a rest grows a note.
 * @property {number} wither Per-bar chance an unlocked note returns to rest.
 * @property {number} cutoffMul
 * @property {number} decayMul
 * @property {SeasonPalette} palette
 */

/** @type {Season[]} */
export const SEASONS = [
  {
    name: "Spring",
    tempTarget: 0.55,
    drift: 0.8,
    damping: 0.9,
    wind: -0.06,
    sprout: 0.12,
    wither: 0.02,
    cutoffMul: 1.15,
    decayMul: 0.95,
    palette: {
      mark: [176, 214, 118],
      soilTop: [18, 23, 16],
      soilBottom: [11, 14, 10]
    }
  },
  {
    name: "Summer",
    tempTarget: 0.95,
    drift: 1.35,
    damping: 0.93,
    wind: 0,
    sprout: 0.05,
    wither: 0.03,
    cutoffMul: 1.3,
    decayMul: 1.1,
    palette: {
      mark: [232, 165, 75],
      soilTop: [20, 17, 14],
      soilBottom: [12, 10, 8]
    }
  },
  {
    name: "Autumn",
    tempTarget: 0.4,
    drift: 1,
    damping: 0.9,
    wind: 0.06,
    sprout: 0.03,
    wither: 0.12,
    cutoffMul: 0.85,
    decayMul: 1.2,
    palette: {
      mark: [214, 106, 58],
      soilTop: [22, 15, 12],
      soilBottom: [13, 9, 8]
    }
  },
  {
    name: "Winter",
    tempTarget: 0.05,
    drift: 0.25,
    damping: 0.8,
    wind: 0,
    sprout: 0.01,
    wither: 0.05,
    cutoffMul: 0.6,
    decayMul: 1.35,
    palette: {
      mark: [150, 194, 224],
      soilTop: [15, 18, 22],
      soilBottom: [9, 11, 14]
    }
  }
];

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @param {number} t
 * @returns {[number, number, number]}
 */
function mixRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

/**
 * @param {number} temperature
 * @param {number} trend
 */
function labelFor(temperature, trend) {
  if (temperature >= 0.82) return "Hot";
  if (temperature <= 0.15) return "Frozen";
  if (trend > 0.02) return "Warming";
  if (trend < -0.02) return "Cooling";
  return "Mild";
}

/**
 * Neutral stand-in so the living score still drifts if climate is unavailable.
 * @type {ClimateFeel}
 */
export const NEUTRAL_CLIMATE = {
  drift: 1,
  damping: 0.92,
  wind: 0,
  sprout: 0,
  wither: 0,
  cutoffMul: 1,
  decayMul: 1,
  palette: SEASONS[1].palette,
  temperature: 0.5,
  seasonName: "Summer",
  label: "Mild"
};

/**
 * @typedef {object} ClimateFeel
 * @property {number} drift
 * @property {number} damping
 * @property {number} wind
 * @property {number} sprout
 * @property {number} wither
 * @property {number} cutoffMul
 * @property {number} decayMul
 * @property {SeasonPalette} palette
 * @property {number} temperature
 * @property {string} seasonName
 * @property {string} label
 */

/**
 * @param {{ getBias?: () => number, onSeasonChange?: (season: Season) => void }} [hooks]
 */
export function createClimate(hooks = {}) {
  let seasonIndex = 0;
  let previousIndex = SEASONS.length - 1;
  let bars = 0;
  let temperature = SEASONS[0].tempTarget;
  let trend = 0;
  // 0 = just switched season, 1 = fully settled into it. Drives colour blending.
  let blend = 1;

  function bias() {
    const value = Number(hooks.getBias?.() ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  function advanceBar() {
    bars += 1;
    if (bars % BARS_PER_SEASON === 0) {
      previousIndex = seasonIndex;
      seasonIndex = (seasonIndex + 1) % SEASONS.length;
      blend = 0;
      hooks.onSeasonChange?.(SEASONS[seasonIndex]);
    }

    const target = SEASONS[seasonIndex].tempTarget;
    const next = temperature + (target - temperature) * TEMP_EASE;
    trend = next - temperature;
    temperature = next;
    blend = Math.min(1, blend + TEMP_EASE);
  }

  /** @returns {ClimateFeel} */
  function feel() {
    const season = SEASONS[seasonIndex];
    const previous = SEASONS[previousIndex];
    const t = clamp(temperature + bias(), 0, 1);
    // Neutral midpoint: t = 0.5 reproduces the season's own baseline. Kept
    // narrow because damping and drift compound into the final velocity.
    const warmth = 0.7 + t * 0.6;

    return {
      drift: season.drift * warmth,
      damping: clamp(season.damping + (t - 0.5) * 0.03, 0.7, 0.96),
      wind: season.wind * warmth,
      sprout: season.sprout * (0.4 + t * 1.2),
      wither: season.wither * (1.4 - t * 0.8),
      cutoffMul: season.cutoffMul * (0.8 + t * 0.4),
      decayMul: season.decayMul * (1.15 - t * 0.3),
      palette: {
        mark: mixRgb(previous.palette.mark, season.palette.mark, blend),
        soilTop: mixRgb(previous.palette.soilTop, season.palette.soilTop, blend),
        soilBottom: mixRgb(previous.palette.soilBottom, season.palette.soilBottom, blend)
      },
      temperature: t,
      seasonName: season.name,
      label: labelFor(t, trend)
    };
  }

  return {
    advanceBar,
    feel,
    season() {
      return SEASONS[seasonIndex];
    },
    temperature() {
      return clamp(temperature + bias(), 0, 1);
    }
  };
}
