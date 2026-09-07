/**
 * Living Score: closed audiovisual loop.
 * Marks bloom with FM hits, drift while unlocked, and write pitch back each loop.
 * Season/temperature arrive via getClimate and scale how far the seeds roam.
 */

import { NEUTRAL_CLIMATE } from "./climate.js";

/**
 * @typedef {object} LivingMark
 * @property {number} stepIndex
 * @property {number} x
 * @property {number} y
 * @property {number | null} note
 * @property {boolean} locked
 * @property {number} energy
 * @property {number} vx
 * @property {number} vy
 */

/**
 * @typedef {object} LivingHooks
 * @property {() => { note: number | null, locked: boolean, probability?: number }[]} getPattern
 * @property {(pattern: { note: number | null, locked: boolean, probability: number }[], growth?: { sprouted: number, withered: number }) => void} onPatternFromLife
 * @property {() => number[]} getPitches
 * @property {() => { ratio: number, index: number, swing: number }} getVoiceFeel
 * @property {() => import("./climate.js").ClimateFeel} [getClimate]
 * @property {() => void} [onBar]
 * @property {(stepIndex: number, note: number | null) => void} [onPlant]
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {LivingHooks} hooks
 */
export function createLivingScore(canvas, hooks) {
  const ctx = canvas.getContext("2d");
  /** @type {LivingMark[]} */
  let marks = [];
  let running = false;
  let raf = 0;
  let lastTs = 0;
  let stepsSinceWrite = 0;
  let drawing = false;
  /** Skip write-back for this many steps after an external pattern sync (generate/preset). */
  let writeBackCooldown = 0;

  let stepsSinceBar = 0;

  const STEP_COUNT = 16;
  const WRITE_BACK_COOLDOWN_STEPS = STEP_COUNT * 2;
  /** Growth runs mid-bar so it never shares a step with write-back. */
  const GROWTH_STEP = STEP_COUNT / 2;
  const MIN_NOTES = 2;
  const MAX_NOTES = 13;

  function sizeCanvas() {
    if (!ctx) return { width: 320, height: 220 };
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 220;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width, height };
  }

  /**
   * @param {number | null} note
   * @param {number[]} pitches
   */
  function noteToY(note, pitches) {
    if (note == null || pitches.length === 0) return 0.88;
    let best = 0;
    let bestDist = Infinity;
    pitches.forEach((pitch, index) => {
      const dist = Math.abs(pitch - note);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    const t = best / Math.max(1, pitches.length - 1);
    // Keep sounding pitches above the rest bed so light drift doesn't erase them.
    return 0.1 + (1 - t) * 0.62;
  }

  /**
   * @param {number} y
   * @param {number[]} pitches
   */
  function yToNote(y, pitches) {
    if (pitches.length === 0) return null;
    if (y > 0.84) return null;
    const usable = Math.min(1, Math.max(0, (y - 0.1) / 0.62));
    const degree = Math.round((1 - usable) * (pitches.length - 1));
    return pitches[Math.min(pitches.length - 1, Math.max(0, degree))];
  }

  function columnCenterX(stepIndex) {
    return (stepIndex + 0.5) / STEP_COUNT;
  }

  /**
   * @param {{ note: number | null, locked: boolean, probability?: number }[]} pattern
   * @param {{ settle?: boolean }} [options] settle=true after generate/mutate/preset
   */
  function syncFromPattern(pattern, options = {}) {
    const pitches = hooks.getPitches();
    const settle = options.settle !== false;

    marks = pattern.map((step, stepIndex) => {
      const prev = marks.find((mark) => mark.stepIndex === stepIndex);
      const targetY = noteToY(step.note, pitches);
      const sameNote = prev != null && prev.note === step.note && step.note != null;

      // Keep drifted y only when the pitch itself did not change.
      // Rest → note (or note change) must snap to the new pitch height.
      let y = targetY;
      if (sameNote && prev && !step.locked) {
        y = prev.y;
      }

      return {
        stepIndex,
        x: prev && !step.locked ? prev.x : columnCenterX(stepIndex),
        y,
        note: step.note,
        locked: Boolean(step.locked),
        energy: step.note != null ? Math.max(prev?.energy ?? 0, 0.45) : 0,
        vx: 0,
        vy: 0
      };
    });

    if (settle) {
      // Let the new garden play through before the loop rewrites pitches.
      writeBackCooldown = WRITE_BACK_COOLDOWN_STEPS;
      stepsSinceWrite = 0;
    }

    draw();
  }

  /**
   * @param {number} stepIndex
   */
  function bloom(stepIndex) {
    const mark = marks[stepIndex];
    if (!mark || mark.note == null) return;
    const { index } = hooks.getVoiceFeel();
    const boost = 0.35 + Math.min(1, index / 800) * 0.65;
    mark.energy = Math.min(1.4, mark.energy + boost);
    draw();
  }

  function writeBackUnlocked() {
    if (writeBackCooldown > 0) return;

    const pitches = hooks.getPitches();
    const pattern = hooks.getPattern().map((step) => ({
      note: step.note,
      locked: Boolean(step.locked),
      probability: step.probability ?? 1
    }));

    let changed = false;
    marks.forEach((mark) => {
      if (mark.locked) return;
      // Only write back if the mark has drifted enough to change degree,
      // and keep notes out of the rest bed unless clearly parked there.
      const nextNote = yToNote(mark.y, pitches);
      if (nextNote !== pattern[mark.stepIndex].note) {
        pattern[mark.stepIndex] = {
          ...pattern[mark.stepIndex],
          note: nextNote
        };
        mark.note = nextNote;
        changed = true;
      }
      mark.x += (columnCenterX(mark.stepIndex) - mark.x) * 0.35;
    });

    if (changed) {
      hooks.onPatternFromLife(pattern);
    }
  }

  /**
   * Pitch for a fresh sprout: one scale step off the nearest neighbour so
   * growth stays in the melodic neighbourhood instead of jumping anywhere.
   * @param {{ note: number | null }[]} pattern
   * @param {number} stepIndex
   * @param {number[]} pitches
   */
  function sproutPitch(pattern, stepIndex, pitches) {
    /** @type {number | null} */
    let neighbour = null;
    for (let offset = 1; offset < STEP_COUNT && neighbour == null; offset += 1) {
      neighbour = pattern[stepIndex - offset]?.note ?? pattern[stepIndex + offset]?.note ?? null;
    }
    if (neighbour == null) {
      return pitches[Math.floor(Math.random() * pitches.length)];
    }

    let nearest = 0;
    pitches.forEach((pitch, index) => {
      if (Math.abs(pitch - neighbour) < Math.abs(pitches[nearest] - neighbour)) nearest = index;
    });
    const degree = nearest + (Math.random() < 0.5 ? -1 : 1);
    return pitches[Math.min(pitches.length - 1, Math.max(0, degree))];
  }

  /**
   * Seasonal growth: rests may sprout, unlocked notes may wither.
   * Note count is held between MIN_NOTES and MAX_NOTES so the garden can
   * neither empty out nor fill solid.
   */
  function growAndWither() {
    const climate = hooks.getClimate?.() ?? NEUTRAL_CLIMATE;
    if (climate.sprout <= 0 && climate.wither <= 0) return;

    const pitches = hooks.getPitches();
    if (pitches.length === 0) return;

    const pattern = hooks.getPattern().map((step) => ({
      note: step.note,
      locked: Boolean(step.locked),
      probability: step.probability ?? 1
    }));

    let noteCount = pattern.filter((step) => step.note != null).length;
    let sprouted = 0;
    let withered = 0;

    pattern.forEach((step, stepIndex) => {
      if (step.locked) return;
      const mark = marks[stepIndex];

      if (step.note == null) {
        if (noteCount >= MAX_NOTES || Math.random() >= climate.sprout) return;
        const note = sproutPitch(pattern, stepIndex, pitches);
        pattern[stepIndex] = { ...step, note };
        if (mark) {
          mark.note = note;
          mark.x = columnCenterX(stepIndex);
          mark.y = noteToY(note, pitches);
          mark.energy = Math.max(mark.energy, 0.5);
        }
        noteCount += 1;
        sprouted += 1;
        return;
      }

      if (noteCount <= MIN_NOTES || Math.random() >= climate.wither) return;
      pattern[stepIndex] = { ...step, note: null };
      if (mark) {
        mark.note = null;
        mark.energy = 0;
        mark.y = noteToY(null, pitches);
      }
      noteCount -= 1;
      withered += 1;
    });

    if (sprouted === 0 && withered === 0) return;
    hooks.onPatternFromLife(pattern, { sprouted, withered });
    draw();
  }

  /**
   * @param {number} dt
   */
  function drift(dt) {
    const { ratio, index, swing } = hooks.getVoiceFeel();
    const climate = hooks.getClimate?.() ?? NEUTRAL_CLIMATE;
    const driftScale = 0.04 + Math.min(1, (ratio - 0.25) / 8) * 0.08;
    const chaos = Math.min(1, index / 800);

    marks.forEach((mark) => {
      mark.energy = Math.max(0, mark.energy - dt * 1.8);
      if (mark.locked || mark.note == null) {
        mark.vx *= 0.8;
        mark.vy *= 0.8;
        return;
      }

      const wobble = (Math.random() - 0.5) * swing * 0.9;
      mark.vx += ((Math.random() - 0.5) * driftScale * climate.drift + wobble * 0.02) * chaos;
      mark.vy +=
        (Math.random() - 0.5) * driftScale * 0.7 * climate.drift * (0.35 + chaos) +
        climate.wind * dt;
      mark.vx *= climate.damping;
      mark.vy *= climate.damping;
      mark.x = Math.min(0.98, Math.max(0.02, mark.x + mark.vx * dt));
      // Soft clamp: unlocked notes stay in the pitch band unless dragged to rest.
      mark.y = Math.min(0.82, Math.max(0.08, mark.y + mark.vy * dt));
    });
  }

  function draw() {
    if (!ctx) return;
    const { width, height } = sizeCanvas();
    ctx.clearRect(0, 0, width, height);

    const { palette } = hooks.getClimate?.() ?? NEUTRAL_CLIMATE;
    const [markR, markG, markB] = palette.mark;

    // Soil
    const soil = ctx.createLinearGradient(0, 0, 0, height);
    soil.addColorStop(0, `rgb(${palette.soilTop.join(", ")})`);
    soil.addColorStop(1, `rgb(${palette.soilBottom.join(", ")})`);
    ctx.fillStyle = soil;
    ctx.fillRect(0, 0, width, height);

    // Rest bed
    ctx.fillStyle = "rgba(154, 144, 134, 0.1)";
    ctx.fillRect(0, height * 0.82, width, height * 0.18);

    // Columns
    ctx.strokeStyle = "rgba(58, 52, 46, 0.55)";
    ctx.lineWidth = 1;
    for (let i = 1; i < STEP_COUNT; i += 1) {
      const x = (i / STEP_COUNT) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    marks.forEach((mark) => {
      const px = mark.x * width;
      const py = mark.y * height;
      const base = mark.note == null ? 3 : 7 + mark.energy * 10;
      const alpha = mark.note == null ? 0.15 : 0.35 + mark.energy * 0.55;

      if (mark.note != null) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(${markR}, ${markG}, ${markB}, ${alpha * 0.35})`;
        ctx.arc(px, py, base * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      // Locked marks keep their own green so locking stays unambiguous.
      ctx.fillStyle = mark.locked
        ? `rgba(126, 200, 163, ${0.45 + mark.energy * 0.4})`
        : `rgba(${markR}, ${markG}, ${markB}, ${alpha})`;
      ctx.arc(px, py, base, 0, Math.PI * 2);
      ctx.fill();

      if (mark.locked) {
        ctx.strokeStyle = "rgba(126, 200, 163, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px - base - 2, py - base - 2, (base + 2) * 2, (base + 2) * 2);
      }
    });
  }

  function frame(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    drift(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTs = performance.now();
    stepsSinceWrite = 0;
    stepsSinceBar = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    draw();
  }

  /**
   * Called for every sequencer step (including rests) so write-back can count loops.
   * @param {number} stepIndex
   * @param {number | null} note
   */
  function onStep(stepIndex, note) {
    if (note != null) bloom(stepIndex);

    const settling = writeBackCooldown > 0;
    stepsSinceBar += 1;
    if (stepsSinceBar === GROWTH_STEP && !settling) growAndWither();
    if (stepsSinceBar >= STEP_COUNT) {
      stepsSinceBar = 0;
      // Season clock only turns while the transport runs.
      hooks.onBar?.();
    }

    if (settling) {
      writeBackCooldown -= 1;
      return;
    }
    stepsSinceWrite += 1;
    if (stepsSinceWrite >= STEP_COUNT) {
      stepsSinceWrite = 0;
      writeBackUnlocked();
    }
  }

  function plantAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const stepIndex = Math.min(STEP_COUNT - 1, Math.floor(x * STEP_COUNT));
    const pattern = hooks.getPattern();
    if (pattern[stepIndex]?.locked) return;

    const pitches = hooks.getPitches();
    const note = yToNote(y, pitches);
    const next = pattern.map((step, i) =>
      i === stepIndex
        ? { note, locked: false, probability: step.probability ?? 1 }
        : { note: step.note, locked: Boolean(step.locked), probability: step.probability ?? 1 }
    );

    const mark = marks[stepIndex];
    if (mark) {
      mark.x = x;
      mark.y = y;
      mark.note = note;
      mark.energy = Math.max(mark.energy, 0.6);
    }
    hooks.onPatternFromLife(next);
    hooks.onPlant?.(stepIndex, note);
    // Manual plant should not trigger the long settle cooldown.
    writeBackCooldown = Math.max(writeBackCooldown, STEP_COUNT);
    stepsSinceWrite = 0;
    draw();
  }

  /**
   * Second click on an existing mark clears it (rest) and drops its resonance spark.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {boolean}
   */
  function clearSparkAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const stepIndex = Math.min(STEP_COUNT - 1, Math.floor(x * STEP_COUNT));
    const pattern = hooks.getPattern();
    const step = pattern[stepIndex];
    if (!step || step.locked || step.note == null) return false;

    const mark = marks[stepIndex];
    if (!mark || mark.note == null) return false;

    // Hit the glowing mark, not just the whole column.
    const dx = (mark.x - x) * rect.width;
    const dy = (mark.y - y) * rect.height;
    if (Math.hypot(dx, dy) > 18) return false;

    const next = pattern.map((s, i) =>
      i === stepIndex
        ? { note: null, locked: false, probability: s.probability ?? 1 }
        : { note: s.note, locked: Boolean(s.locked), probability: s.probability ?? 1 }
    );

    mark.note = null;
    mark.energy = 0;
    mark.y = noteToY(null, hooks.getPitches());
    hooks.onPatternFromLife(next);
    hooks.onPlant?.(stepIndex, null);
    writeBackCooldown = Math.max(writeBackCooldown, STEP_COUNT);
    stepsSinceWrite = 0;
    draw();
    return true;
  }

  function toggleLockAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const stepIndex = Math.min(STEP_COUNT - 1, Math.floor(x * STEP_COUNT));
    const pattern = hooks.getPattern();
    const step = pattern[stepIndex];
    if (!step) return;

    const locked = !step.locked;
    const next = pattern.map((s, i) =>
      i === stepIndex
        ? { note: s.note, locked, probability: s.probability ?? 1 }
        : { note: s.note, locked: Boolean(s.locked), probability: s.probability ?? 1 }
    );

    const mark = marks[stepIndex];
    if (mark) mark.locked = locked;

    hooks.onPatternFromLife(next);
    draw();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (clearSparkAt(event.clientX, event.clientY)) {
      drawing = false;
      return;
    }
    drawing = true;
    plantAt(event.clientX, event.clientY);
  });

  window.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    plantAt(event.clientX, event.clientY);
  });

  window.addEventListener("pointerup", () => {
    drawing = false;
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    drawing = false;
    toggleLockAt(event.clientX, event.clientY);
  });

  syncFromPattern(hooks.getPattern());
  draw();

  return {
    syncFromPattern,
    onStep,
    start,
    stop,
    draw
  };
}
