import { playFmNote, midiToHz } from "./fmVoice.js";
import { createScheduler } from "./scheduler.js";
import { generatePattern, mutatePattern, pitchesForScale } from "./generator.js";
import { PRESETS, getPreset } from "./presets.js";
import { createVisualizer } from "./visualizer.js";
import { createHitField } from "./hitField.js";
import { bindFmPad } from "./gestures.js";
import { createLivingScore } from "./livingArt.js";

const AUDITION_MIDI = 60;
const PROB_CYCLE = [1, 0.75, 0.5, 0.25];

/**
 * @param {{ note: number | null, locked?: boolean, probability?: number }[]} steps
 */
function cloneSteps(steps) {
  return steps.map((step) => ({
    note: step.note,
    locked: Boolean(step.locked),
    probability: step.probability ?? 1
  }));
}

const ui = {
  startBtn: document.querySelector("#start-btn"),
  stopBtn: document.querySelector("#stop-btn"),
  playIndicator: document.querySelector("#play-indicator"),
  bpm: document.querySelector("#bpm"),
  bpmValue: document.querySelector("#bpm-value"),
  swing: document.querySelector("#swing"),
  swingValue: document.querySelector("#swing-value"),
  masterGain: document.querySelector("#master-gain"),
  masterGainValue: document.querySelector("#master-gain-value"),
  scope: document.querySelector("#scope"),
  fmPad: document.querySelector("#fm-pad"),
  auditionBtn: document.querySelector("#audition-btn"),
  toneExtrasBtn: document.querySelector("#tone-extras-btn"),
  toneExtrasClose: document.querySelector("#tone-extras-close"),
  tonePopover: document.querySelector("#tone-popover"),
  ratio: document.querySelector("#ratio"),
  ratioValue: document.querySelector("#ratio-value"),
  index: document.querySelector("#index"),
  indexValue: document.querySelector("#index-value"),
  cutoff: document.querySelector("#cutoff"),
  cutoffValue: document.querySelector("#cutoff-value"),
  feedback: document.querySelector("#feedback"),
  feedbackValue: document.querySelector("#feedback-value"),
  carrierType: document.querySelector("#carrier-type"),
  modType: document.querySelector("#mod-type"),
  stepGrid: document.querySelector("#step-grid"),
  genStatus: document.querySelector("#gen-status"),
  scale: document.querySelector("#scale"),
  tonic: document.querySelector("#tonic"),
  tonicValue: document.querySelector("#tonic-value"),
  density: document.querySelector("#density"),
  densityValue: document.querySelector("#density-value"),
  generateBtn: document.querySelector("#generate-btn"),
  mutateBtn: document.querySelector("#mutate-btn"),
  undoBtn: document.querySelector("#undo-btn"),
  livingCanvas: document.querySelector("#living-canvas"),
  livingStatus: document.querySelector("#living-status"),
  hitField: document.querySelector("#hit-field"),
  presetButtons: [...document.querySelectorAll("[data-preset]")]
};

/** @type {{ note: number | null, locked: boolean, probability: number }[]} */
let pattern = cloneSteps(PRESETS[0].steps);
let activeStepIndex = -1;
/** @type {{ note: number | null, locked: boolean, probability: number }[][]} */
const undoStack = [];
let lastPadAudition = 0;

const audioCtx = new AudioContext();
const masterGain = audioCtx.createGain();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 2048;
masterGain.gain.value = Number(ui.masterGain.value);
masterGain.connect(analyser);
analyser.connect(audioCtx.destination);

const visualizer = createVisualizer(analyser, ui.scope);
const hitField = createHitField(ui.hitField, () => ({
  ratio: Number(ui.ratio.value),
  index: Number(ui.index.value),
  carrierType: /** @type {OscillatorType} */ (ui.carrierType.value),
  modType: /** @type {OscillatorType} */ (ui.modType.value)
}));

/** @type {ReturnType<typeof createLivingScore> | null} */
let living = null;
let syncingFromLife = false;

const scheduler = createScheduler(audioCtx, {
  onStep(stepIndex, timeSec, note) {
    if (note != null) {
      playFmNote(audioCtx, masterGain, currentFmParams(midiToHz(note)), timeSec);
    }
    const delayMs = Math.max(0, (timeSec - audioCtx.currentTime) * 1000);
    setTimeout(() => {
      if (!scheduler.isRunning()) return;
      living?.onStep(stepIndex, note);
      hitField.onHit(stepIndex, note);
    }, delayMs);
  },
  onHighlight: highlightStep
});

scheduler.setBpm(Number(ui.bpm.value));
scheduler.setSwing(Number(ui.swing.value));
scheduler.setPattern(pattern);

living = createLivingScore(ui.livingCanvas, {
  getPattern: () => pattern,
  getPitches: () => pitchesForScale(Number(ui.tonic.value), ui.scale.value),
  getVoiceFeel: () => ({
    ratio: Number(ui.ratio.value),
    index: Number(ui.index.value),
    swing: Number(ui.swing.value)
  }),
  onPatternFromLife(nextPattern) {
    syncingFromLife = true;
    pattern = nextPattern;
    scheduler.setPattern(pattern);
    renderSteps();
    clearPresetSelection();
    setLivingStatus("Loop write-back — garden reshaped the pattern");
    setStatus("Living score wrote unlocked pitches back");
    syncingFromLife = false;
  },
  onPlant(stepIndex, note) {
    hitField.onPlant(stepIndex, note);
    setLivingStatus("Planted — resonance sparks");
  }
});

const fmPad = bindFmPad(ui.fmPad, {
  getRatioRange: () => ({
    min: Number(ui.ratio.min),
    max: Number(ui.ratio.max)
  }),
  getIndexRange: () => ({
    min: Number(ui.index.min),
    max: Number(ui.index.max)
  }),
  onChange({ ratio, index }, ending) {
    ui.ratio.value = String(Math.round(ratio * 4) / 4);
    ui.index.value = String(Math.round(index));
    syncReadouts();
    setStatus(`Pad · ratio ${Number(ui.ratio.value).toFixed(2)} · index ${ui.index.value}`);

    if (!scheduler.isRunning() && ending) {
      void auditionMidi(AUDITION_MIDI);
      return;
    }
    if (!scheduler.isRunning()) {
      const now = performance.now();
      if (now - lastPadAudition > 140) {
        lastPadAudition = now;
        void auditionMidi(AUDITION_MIDI);
      }
    }
  }
});

function setStatus(message) {
  ui.genStatus.textContent = message;
}

function setLivingStatus(message) {
  if (ui.livingStatus) ui.livingStatus.textContent = message;
}

function setPlaying(isPlaying) {
  document.body.classList.toggle("is-playing", isPlaying);
  ui.playIndicator.textContent = isPlaying ? "Playing" : "Idle";
  if (isPlaying) {
    visualizer.start();
    hitField.start();
    living?.start();
    setLivingStatus("Organism awake — blooming & drifting");
  } else {
    visualizer.stop();
    hitField.stop();
    living?.stop();
    setLivingStatus("Idle organism");
  }
}

function syncReadouts() {
  ui.bpmValue.textContent = ui.bpm.value;
  ui.swingValue.textContent = Number(ui.swing.value).toFixed(2);
  ui.masterGainValue.textContent = Number(ui.masterGain.value).toFixed(2);
  ui.ratioValue.textContent = Number(ui.ratio.value).toFixed(2);
  ui.indexValue.textContent = ui.index.value;
  ui.cutoffValue.textContent = `${ui.cutoff.value} Hz`;
  ui.feedbackValue.textContent = Number(ui.feedback.value).toFixed(2);
  ui.tonicValue.textContent = ui.tonic.value;
  ui.densityValue.textContent = Number(ui.density.value).toFixed(2);
}

function currentFmParams(carrierHz) {
  return {
    carrierHz,
    ratio: Number(ui.ratio.value),
    index: Number(ui.index.value),
    cutoff: Number(ui.cutoff.value),
    feedback: Number(ui.feedback.value),
    carrierType: /** @type {OscillatorType} */ (ui.carrierType.value),
    modType: /** @type {OscillatorType} */ (ui.modType.value)
  };
}

function genOptions() {
  return {
    scaleId: ui.scale.value,
    tonicMidi: Number(ui.tonic.value),
    density: Number(ui.density.value)
  };
}

function notePalette() {
  return [null, ...pitchesForScale(Number(ui.tonic.value), ui.scale.value)];
}

function updateUndoButton() {
  ui.undoBtn.disabled = undoStack.length === 0;
}

function pushUndo() {
  undoStack.push(cloneSteps(pattern));
  if (undoStack.length > 12) undoStack.shift();
  updateUndoButton();
}

async function ensureAudio() {
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
}

async function auditionMidi(midiNote) {
  await ensureAudio();
  visualizer.start();
  playFmNote(audioCtx, masterGain, currentFmParams(midiToHz(midiNote)));
}

function markPresetSelection(id) {
  ui.presetButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.preset === id);
  });
}

function clearPresetSelection() {
  ui.presetButtons.forEach((button) => button.classList.remove("is-selected"));
}

/**
 * @param {{ note: number | null, locked: boolean, probability: number }[]} nextPattern
 * @param {string} status
 * @param {{ keepPreset?: boolean, recordUndo?: boolean }} [options]
 */
function applyPattern(nextPattern, status, options = {}) {
  if (options.recordUndo) pushUndo();
  pattern = nextPattern;
  scheduler.setPattern(pattern);
  renderSteps();
  setStatus(status);
  if (!options.keepPreset) clearPresetSelection();
  if (!syncingFromLife) {
    living?.syncFromPattern(pattern);
    setLivingStatus(options.recordUndo ? "Garden reflowed from generate/mutate" : "Marks synced to pattern");
  }
}

function loadPreset(id) {
  const preset = getPreset(id);
  if (!preset) return;

  ui.bpm.value = String(preset.bpm);
  ui.ratio.value = String(preset.ratio);
  ui.index.value = String(preset.index);
  ui.swing.value = String(preset.swing ?? 0);
  ui.cutoff.value = String(preset.cutoff ?? 4200);
  ui.carrierType.value = preset.carrierType ?? "sine";
  ui.modType.value = preset.modType ?? "sine";
  ui.scale.value = preset.scaleId;
  ui.tonic.value = String(preset.tonicMidi);
  syncReadouts();
  fmPad.setFromValues(preset.ratio, preset.index);
  scheduler.setBpm(preset.bpm);
  scheduler.setSwing(Number(ui.swing.value));

  applyPattern(cloneSteps(preset.steps), `Loaded seed “${preset.label}”`, {
    keepPreset: true
  });
  markPresetSelection(preset.id);
  living?.syncFromPattern(pattern);
  setLivingStatus(`Seed “${preset.label}” planted in the garden`);
}

function cycleStepNote(index) {
  const palette = notePalette();
  const current = pattern[index].note;
  let paletteIndex = palette.findIndex((value) => value === current);
  if (paletteIndex < 0) {
    paletteIndex = current == null ? 0 : nearestInPalette(palette, current);
  }
  const next = palette[(paletteIndex + 1) % palette.length];
  const nextPattern = pattern.map((step, i) =>
    i === index ? { ...step, note: next } : step
  );
  applyPattern(
    nextPattern,
    next == null ? `Step ${index + 1} → rest` : `Step ${index + 1} → MIDI ${next}`
  );
  if (next != null) void auditionMidi(next);
}

function cycleStepProbability(index) {
  const current = pattern[index].probability ?? 1;
  let at = PROB_CYCLE.findIndex((value) => Math.abs(value - current) < 0.001);
  if (at < 0) at = 0;
  const next = PROB_CYCLE[(at + 1) % PROB_CYCLE.length];
  const nextPattern = pattern.map((step, i) =>
    i === index ? { ...step, probability: next } : step
  );
  applyPattern(nextPattern, `Step ${index + 1} play chance ${Math.round(next * 100)}%`);
}

function nearestInPalette(palette, midi) {
  let best = 1;
  let bestDist = Infinity;
  palette.forEach((value, index) => {
    if (value == null) return;
    const dist = Math.abs(value - midi);
    if (dist < bestDist) {
      bestDist = dist;
      best = index;
    }
  });
  return best;
}

function toggleStepLock(index) {
  const nextPattern = pattern.map((step, i) =>
    i === index ? { ...step, locked: !step.locked } : step
  );
  const locked = nextPattern[index].locked;
  applyPattern(
    nextPattern,
    locked ? `Step ${index + 1} locked` : `Step ${index + 1} unlocked`
  );
}

function renderSteps() {
  ui.stepGrid.innerHTML = "";
  pattern.forEach((step, index) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "step";
    if (step.note != null) cell.classList.add("filled");
    if (step.locked) cell.classList.add("locked");
    if ((step.probability ?? 1) < 1) cell.classList.add("partial");
    if (index === activeStepIndex) cell.classList.add("active");
    cell.dataset.index = String(index);
    const lockMark = step.locked ? " L" : "";
    const prob =
      (step.probability ?? 1) < 1
        ? `<span class="prob">${Math.round((step.probability ?? 1) * 100)}%</span>`
        : "";
    cell.innerHTML = `<span class="idx">${index + 1}${lockMark}</span><span>${step.note ?? "·"}</span>${prob}`;
    cell.title = "Click: pitch · Right-click: lock · Shift-click: probability";
    cell.addEventListener("click", (event) => {
      if (event.shiftKey) cycleStepProbability(index);
      else cycleStepNote(index);
    });
    cell.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      toggleStepLock(index);
    });
    ui.stepGrid.appendChild(cell);
  });
}

function highlightStep(stepIndex) {
  activeStepIndex = stepIndex;
  ui.stepGrid.querySelectorAll(".step").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.index) === stepIndex);
  });
}

async function startTransport() {
  await ensureAudio();
  scheduler.setPattern(pattern);
  scheduler.setBpm(Number(ui.bpm.value));
  scheduler.setSwing(Number(ui.swing.value));
  scheduler.start();
  setPlaying(true);
  setStatus(`Playing · living score + resonance · ${ui.bpm.value} BPM`);
}

function stopTransport() {
  scheduler.stop();
  setPlaying(false);
  setStatus("Stopped");
}

function undoPattern() {
  const previous = undoStack.pop();
  updateUndoButton();
  if (!previous) return;
  pattern = previous;
  scheduler.setPattern(pattern);
  renderSteps();
  clearPresetSelection();
  setStatus("Undo — restored previous pattern");
  living?.syncFromPattern(pattern);
  setLivingStatus("Undo — garden restored");
}

function wireControls() {
  ui.bpm.addEventListener("input", () => {
    syncReadouts();
    scheduler.setBpm(Number(ui.bpm.value));
  });

  ui.swing.addEventListener("input", () => {
    syncReadouts();
    scheduler.setSwing(Number(ui.swing.value));
  });

  ui.masterGain.addEventListener("input", () => {
    syncReadouts();
    masterGain.gain.value = Number(ui.masterGain.value);
  });

  ui.cutoff.addEventListener("input", syncReadouts);
  ui.feedback.addEventListener("input", syncReadouts);
  ui.tonic.addEventListener("input", () => {
    syncReadouts();
    living?.syncFromPattern(pattern);
  });
  ui.scale.addEventListener("change", () => {
    living?.syncFromPattern(pattern);
  });
  ui.density.addEventListener("input", syncReadouts);

  ui.auditionBtn.addEventListener("click", () => {
    void auditionMidi(AUDITION_MIDI).then(() => {
      setStatus(`Audition · pad index ${ui.index.value}`);
    });
  });

  const TONE_POS_KEY = "fm-groovebox-tone-pos";
  /** @type {{ left: number, top: number } | null} */
  let tonePopoverPos = null;

  try {
    const saved = sessionStorage.getItem(TONE_POS_KEY);
    if (saved) tonePopoverPos = JSON.parse(saved);
  } catch {
    tonePopoverPos = null;
  }

  function clampTonePopoverPos(left, top) {
    const el = ui.tonePopover;
    if (!el) return { left, top };
    const margin = 8;
    const width = el.offsetWidth || 340;
    const height = el.offsetHeight || 220;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(maxLeft, Math.max(margin, left)),
      top: Math.min(maxTop, Math.max(margin, top))
    };
  }

  function applyTonePopoverPos() {
    if (!ui.tonePopover || !tonePopoverPos) return;
    const pos = clampTonePopoverPos(tonePopoverPos.left, tonePopoverPos.top);
    tonePopoverPos = pos;
    ui.tonePopover.classList.add("is-placed");
    ui.tonePopover.style.left = `${pos.left}px`;
    ui.tonePopover.style.top = `${pos.top}px`;
    ui.tonePopover.style.bottom = "auto";
  }

  function setTonePopoverOpen(open) {
    if (!ui.tonePopover || !ui.toneExtrasBtn) return;
    ui.tonePopover.hidden = !open;
    ui.toneExtrasBtn.setAttribute("aria-expanded", open ? "true" : "false");
    ui.toneExtrasBtn.classList.toggle("is-selected", open);
    if (open && tonePopoverPos) applyTonePopoverPos();
  }

  function bindTonePopoverDrag() {
    const el = ui.tonePopover;
    const handle = document.querySelector("#tone-popover-drag");
    if (!el || !handle) return;

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("#tone-extras-close")) return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      // Switch to top/left coords immediately so drag doesn't jump from bottom anchoring.
      tonePopoverPos = { left: rect.left, top: rect.top };
      applyTonePopoverPos();
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      tonePopoverPos = clampTonePopoverPos(event.clientX - offsetX, event.clientY - offsetY);
      applyTonePopoverPos();
    });

    function endDrag(event) {
      if (!dragging) return;
      dragging = false;
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      if (tonePopoverPos) {
        try {
          sessionStorage.setItem(TONE_POS_KEY, JSON.stringify(tonePopoverPos));
        } catch {
          /* private mode */
        }
      }
    }

    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  bindTonePopoverDrag();

  window.addEventListener("resize", () => {
    if (tonePopoverPos && ui.tonePopover && !ui.tonePopover.hidden) applyTonePopoverPos();
  });

  ui.toneExtrasBtn?.addEventListener("click", () => {
    setTonePopoverOpen(ui.tonePopover.hidden);
  });

  ui.toneExtrasClose?.addEventListener("click", () => {
    setTonePopoverOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setTonePopoverOpen(false);
  });

  ui.startBtn.addEventListener("click", () => {
    void startTransport();
  });

  ui.stopBtn.addEventListener("click", stopTransport);

  ui.generateBtn.addEventListener("click", () => {
    const result = generatePattern(pattern, genOptions());
    const rewritten = result.steps.filter((step, i) => !pattern[i].locked).length;
    applyPattern(
      result.steps,
      `Generate (${result.meta.mode}) · markov ${result.meta.markovPicks} / weighted ${result.meta.weightedPicks} · dens ${result.meta.density.toFixed(2)} · ${rewritten} steps`,
      { recordUndo: true }
    );
  });

  ui.mutateBtn.addEventListener("click", () => {
    const result = mutatePattern(pattern, genOptions());
    applyPattern(result.steps, `Mutated ${result.changed} steps`, { recordUndo: true });
  });

  ui.undoBtn.addEventListener("click", undoPattern);

  ui.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      loadPreset(button.dataset.preset);
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;
    const tag = /** @type {HTMLElement} */ (event.target).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") {
      return;
    }
    event.preventDefault();
    if (scheduler.isRunning()) stopTransport();
    else void startTransport();
  });
}

wireControls();
loadPreset("pulse");
updateUndoButton();
setPlaying(false);
visualizer.stop();
setStatus("Living score ready — Start, then watch the garden breathe");
