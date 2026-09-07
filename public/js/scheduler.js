/**
 * Look-ahead step scheduler with swing, probability, and armed stack layers.
 */

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.12;

/**
 * @typedef {object} PatternStep
 * @property {number | null} note
 * @property {number} [probability]
 */

/**
 * @typedef {object} LayerVoice
 * @property {number} ratio
 * @property {number} index
 * @property {number} cutoff
 * @property {number} feedback
 * @property {string} carrierType
 * @property {string} modType
 * @property {number} [ampAttack]
 * @property {number} [ampDecay]
 */

/**
 * @typedef {object} StackLayer
 * @property {PatternStep[]} steps
 * @property {boolean} armed
 * @property {LayerVoice | null} [voice]
 */

/**
 * @typedef {object} ScheduledVoice
 * @property {number} note
 * @property {LayerVoice | null} voice  null = use live Current UI voice
 */

/**
 * @typedef {object} SchedulerHooks
 * @property {(stepIndex: number, timeSec: number, voices: ScheduledVoice[], primaryNote: number | null) => void} onStep
 * @property {(stepIndex: number) => void} [onHighlight]
 */

/**
 * @param {AudioContext} audioCtx
 * @param {SchedulerHooks} hooks
 */
export function createScheduler(audioCtx, hooks) {
  let running = false;
  let bpm = 120;
  let swing = 0;
  /** @type {PatternStep[]} */
  let pattern = [];
  /** @type {StackLayer[]} */
  let stackLayers = [];
  /** Home pattern silenced while saved layers keep looping. */
  let patternMuted = false;
  let nextStepTime = 0;
  let stepCounter = 0;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timerId = null;

  function stepDurationSec() {
    return 60 / bpm / 4;
  }

  /**
   * @param {number} baseTime
   * @param {number} stepIndex
   */
  function swungTime(baseTime, stepIndex) {
    if (stepIndex % 2 === 1 && swing > 0) {
      return baseTime + stepDurationSec() * swing * 0.55;
    }
    return baseTime;
  }

  /**
   * @param {PatternStep | undefined} step
   * @returns {number | null}
   */
  function resolveNote(step) {
    const note = step?.note ?? null;
    if (note == null) return null;
    const probability = step?.probability ?? 1;
    return Math.random() < probability ? note : null;
  }

  function scheduleAhead() {
    if (!running || pattern.length === 0) return;

    while (nextStepTime < audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
      const stepIndex = stepCounter % pattern.length;
      const when = swungTime(nextStepTime, stepIndex);

      const primaryNote = patternMuted ? null : resolveNote(pattern[stepIndex]);
      /** @type {ScheduledVoice[]} */
      const voices = [];
      if (primaryNote != null) {
        voices.push({ note: primaryNote, voice: null });
      }

      for (const layer of stackLayers) {
        if (!layer.armed || !layer.steps?.length) continue;
        const layerNote = resolveNote(layer.steps[stepIndex % layer.steps.length]);
        if (layerNote != null) {
          voices.push({ note: layerNote, voice: layer.voice ?? null });
        }
      }

      hooks.onStep(stepIndex, when, voices, primaryNote);

      const delayMs = Math.max(0, (when - audioCtx.currentTime) * 1000);
      setTimeout(() => {
        if (running) hooks.onHighlight?.(stepIndex);
      }, delayMs);

      nextStepTime += stepDurationSec();
      stepCounter += 1;
    }
  }

  function clearTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      stepCounter = 0;
      nextStepTime = audioCtx.currentTime + 0.05;
      clearTimer();
      scheduleAhead();
      timerId = setInterval(scheduleAhead, LOOKAHEAD_MS);
    },

    stop() {
      running = false;
      clearTimer();
      hooks.onHighlight?.(-1);
    },

    isRunning() {
      return running;
    },

    setBpm(nextBpm) {
      bpm = Math.min(180, Math.max(60, Number(nextBpm) || 120));
    },

    setSwing(nextSwing) {
      swing = Math.min(1, Math.max(0, Number(nextSwing) || 0));
    },

    /**
     * @param {PatternStep[]} steps
     */
    setPattern(steps) {
      pattern = steps;
    },

    /**
     * @param {boolean} muted
     */
    setPatternMuted(muted) {
      patternMuted = Boolean(muted);
    },

    isPatternMuted() {
      return patternMuted;
    },

    /**
     * @param {StackLayer[]} layers
     */
    setStackLayers(layers) {
      stackLayers = Array.isArray(layers) ? layers : [];
    }
  };
}
