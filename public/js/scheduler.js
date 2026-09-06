/**
 * Look-ahead step scheduler with swing and per-step play probability.
 */

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.12;

/**
 * @typedef {object} SchedulerHooks
 * @property {(stepIndex: number, timeSec: number, note: number | null) => void} onStep
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
  /** @type {{ note: number | null, probability?: number }[]} */
  let pattern = [];
  let nextStepTime = 0;
  let stepCounter = 0;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timerId = null;

  function stepDurationSec() {
    return 60 / bpm / 4;
  }

  /**
   * Delay odd 16ths into the pair (classic swing feel).
   * @param {number} baseTime
   * @param {number} stepIndex
   */
  function swungTime(baseTime, stepIndex) {
    if (stepIndex % 2 === 1 && swing > 0) {
      return baseTime + stepDurationSec() * swing * 0.55;
    }
    return baseTime;
  }

  function scheduleAhead() {
    if (!running || pattern.length === 0) return;

    while (nextStepTime < audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
      const stepIndex = stepCounter % pattern.length;
      const step = pattern[stepIndex];
      const note = step?.note ?? null;
      const probability = step?.probability ?? 1;
      const when = swungTime(nextStepTime, stepIndex);
      const plays = note != null && Math.random() < probability;

      hooks.onStep(stepIndex, when, plays ? note : null);

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
     * @param {{ note: number | null, probability?: number }[]} steps
     */
    setPattern(steps) {
      pattern = steps;
    }
  };
}
