import { playFmNote, midiToHz, midiToNoteName } from "./fmVoice.js";
import { createScheduler } from "./scheduler.js";
import { generatePattern, mutatePattern, pitchesForScale } from "./generator.js";
import { PRESETS, getPreset } from "./presets.js";
import { createVisualizer } from "./visualizer.js";
import { createHitField } from "./hitField.js";
import { bindFmPad } from "./gestures.js";
import { createLivingScore } from "./livingArt.js";
import { createMelodyStack, normalizeScene } from "./melodyStack.js";
import { createClimate } from "./climate.js";

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
  ampAttack: document.querySelector("#amp-attack"),
  ampAttackValue: document.querySelector("#amp-attack-value"),
  ampDecay: document.querySelector("#amp-decay"),
  ampDecayValue: document.querySelector("#amp-decay-value"),
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
  seasonBadge: document.querySelector("#season-badge"),
  tempFill: document.querySelector("#temp-fill"),
  tempReadout: document.querySelector("#temp-readout"),
  climateBias: document.querySelector("#climate-bias"),
  climateBiasValue: document.querySelector("#climate-bias-value"),
  livingStatus: document.querySelector("#living-status"),
  hitField: document.querySelector("#hit-field"),
  melodyStackList: document.querySelector("#melody-stack-list"),
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
const hitField = createHitField(
  ui.hitField,
  () => ({
    ratio: Number(ui.ratio.value),
    index: Number(ui.index.value),
    carrierType: /** @type {OscillatorType} */ (ui.carrierType.value),
    modType: /** @type {OscillatorType} */ (ui.modType.value)
  }),
  {
    onDismissSpark(stepIndex) {
      const step = pattern[stepIndex];
      if (!step || step.locked || step.note == null) return;
      const next = pattern.map((s, i) =>
        i === stepIndex
          ? { note: null, locked: Boolean(s.locked), probability: s.probability ?? 1 }
          : { note: s.note, locked: Boolean(s.locked), probability: s.probability ?? 1 }
      );
      syncingFromLife = true;
      pattern = next;
      scheduler.setPattern(pattern);
      renderSteps();
      living?.syncFromPattern(pattern);
      syncingFromLife = false;
      clearPresetSelection();
      setLivingStatus("Cleared resonance spark");
      setStatus(`Step ${stepIndex + 1} → rest`);
    }
  }
);

const melodyStack = createMelodyStack();

const climate = createClimate({
  getBias: () => Number(ui.climateBias?.value ?? 0),
  onSeasonChange(season) {
    setLivingStatus(`${season.name}: the garden turns`);
  }
});

/** @type {ReturnType<typeof createLivingScore> | null} */
let living = null;
let syncingFromLife = false;

const scheduler = createScheduler(audioCtx, {
  onStep(stepIndex, timeSec, voices, primaryNote) {
    const voiceScale = voices.length > 1 ? 1 / Math.sqrt(voices.length) : 1;
    for (const scheduled of voices) {
      playFmNote(
        audioCtx,
        masterGain,
        {
          ...fmParamsFromVoice(scheduled.note, scheduled.voice),
          ampLevel: voiceScale
        },
        timeSec
      );
    }
    const delayMs = Math.max(0, (timeSec - audioCtx.currentTime) * 1000);
    setTimeout(() => {
      if (!scheduler.isRunning()) return;
      const livingNote = primaryNote ?? voices[0]?.note ?? null;
      living?.onStep(stepIndex, livingNote);
      for (const scheduled of voices) {
        hitField.onHit(stepIndex, scheduled.note, voiceFeelFrom(scheduled.voice));
      }
    }, delayMs);
  },
  onHighlight: highlightStep
});

scheduler.setBpm(Number(ui.bpm.value));
scheduler.setSwing(Number(ui.swing.value));
scheduler.setPattern(pattern);
scheduler.setStackLayers(melodyStack.layersForScheduler());

living = createLivingScore(ui.livingCanvas, {
  getPattern: () => pattern,
  getPitches: () => pitchesForScale(Number(ui.tonic.value), ui.scale.value),
  getVoiceFeel: () => ({
    ratio: Number(ui.ratio.value),
    index: Number(ui.index.value),
    swing: Number(ui.swing.value)
  }),
  getClimate: () => climate.feel(),
  onBar() {
    climate.advanceBar();
    syncClimateReadout();
  },
  onPatternFromLife(nextPattern, growth) {
    syncingFromLife = true;
    pattern = nextPattern;
    scheduler.setPattern(pattern);
    renderSteps();
    clearPresetSelection();
    if (growth) {
      const parts = [];
      if (growth.sprouted) parts.push(`${growth.sprouted} sprouted`);
      if (growth.withered) parts.push(`${growth.withered} withered`);
      setLivingStatus(`${climate.season().name}: ${parts.join(" · ")}`);
      setStatus(`Season growth: ${parts.join(" · ")}`);
    } else {
      setLivingStatus("Loop write-back: garden reshaped the pattern");
      setStatus("Living score wrote unlocked pitches back");
    }
    syncingFromLife = false;
  },
  onPlant(stepIndex, note) {
    hitField.onPlant(stepIndex, note);
    setLivingStatus(note == null ? "Cleared spark" : "Planted: resonance sparks");
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

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Season badge, temperature meter and bias readout.
 * Temperature only moves on bar lines, so the CSS transition does the gliding.
 */
function syncClimateReadout() {
  const feel = climate.feel();
  if (ui.seasonBadge) ui.seasonBadge.textContent = feel.seasonName;
  if (ui.tempFill) {
    ui.tempFill.style.width = `${Math.round(feel.temperature * 100)}%`;
    ui.tempFill.style.backgroundColor = `rgb(${feel.palette.mark.join(", ")})`;
  }
  if (ui.tempReadout) {
    ui.tempReadout.textContent = `${feel.label} · ${feel.temperature.toFixed(2)}`;
  }
  if (ui.climateBiasValue && ui.climateBias) {
    ui.climateBiasValue.textContent = Number(ui.climateBias.value).toFixed(2);
  }
}

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
    setLivingStatus("Organism awake: blooming & drifting");
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
  ui.ampAttackValue.textContent = Number(ui.ampAttack.value).toFixed(3);
  ui.ampDecayValue.textContent = Number(ui.ampDecay.value).toFixed(2);
  ui.ratioValue.textContent = Number(ui.ratio.value).toFixed(2);
  ui.indexValue.textContent = ui.index.value;
  ui.cutoffValue.textContent = `${ui.cutoff.value} Hz`;
  ui.feedbackValue.textContent = Number(ui.feedback.value).toFixed(2);
  ui.tonicValue.textContent = `${midiToNoteName(Number(ui.tonic.value))} · ${ui.tonic.value}`;
  ui.densityValue.textContent = Number(ui.density.value).toFixed(2);
}

/**
 * Climate tint, but only while the garden is actually running. A stopped
 * instrument auditions exactly as its sliders read.
 */
function climateTint() {
  if (!scheduler.isRunning()) return { cutoffMul: 1, decayMul: 1 };
  const feel = climate.feel();
  return { cutoffMul: feel.cutoffMul, decayMul: feel.decayMul };
}

function currentFmParams(carrierHz) {
  const feel = climateTint();
  const ampAttack = Number(ui.ampAttack.value);
  // Climate tints the Home voice without ever writing back to the sliders.
  const ampDecay = clamp(Number(ui.ampDecay.value) * feel.decayMul, 0.05, 1.2);
  return {
    carrierHz,
    ratio: Number(ui.ratio.value),
    index: Number(ui.index.value),
    cutoff: clamp(Number(ui.cutoff.value) * feel.cutoffMul, 200, 8000),
    feedback: Number(ui.feedback.value),
    carrierType: /** @type {OscillatorType} */ (ui.carrierType.value),
    modType: /** @type {OscillatorType} */ (ui.modType.value),
    ampAttack,
    ampDecay,
    // Keep FM index envelope in step with the amp envelope.
    indexAttack: Math.max(0.005, ampAttack * 1.2),
    indexDecay: Math.max(0.05, ampDecay * 0.9)
  };
}

/**
 * Snapshot of Home: FM pad + tone extras + tempo/level + generate.
 */
function captureScene() {
  return normalizeScene({
    bpm: Number(ui.bpm.value),
    swing: Number(ui.swing.value),
    masterGain: Number(ui.masterGain.value),
    ratio: Number(ui.ratio.value),
    index: Number(ui.index.value),
    cutoff: Number(ui.cutoff.value),
    feedback: Number(ui.feedback.value),
    carrierType: ui.carrierType.value,
    modType: ui.modType.value,
    scaleId: ui.scale.value,
    tonicMidi: Number(ui.tonic.value),
    density: Number(ui.density.value),
    ampAttack: Number(ui.ampAttack.value),
    ampDecay: Number(ui.ampDecay.value),
    climateBias: Number(ui.climateBias?.value ?? 0)
  });
}

/**
 * @param {import("./melodyStack.js").MelodyScene} scene
 * @param {{ applyTransport?: boolean }} [options]
 */
function applyScene(scene, options = {}) {
  const next = normalizeScene(scene);
  const applyTransport = options.applyTransport !== false;

  if (applyTransport) {
    ui.bpm.value = String(next.bpm);
    ui.swing.value = String(next.swing);
    ui.masterGain.value = String(next.masterGain);
    masterGain.gain.value = next.masterGain;
    scheduler.setBpm(next.bpm);
    scheduler.setSwing(next.swing);
  }

  ui.ratio.value = String(next.ratio);
  ui.index.value = String(next.index);
  ui.cutoff.value = String(next.cutoff);
  ui.feedback.value = String(next.feedback);
  ui.carrierType.value = next.carrierType;
  ui.modType.value = next.modType;
  ui.scale.value = next.scaleId;
  ui.tonic.value = String(next.tonicMidi);
  ui.density.value = String(next.density);
  ui.ampAttack.value = String(next.ampAttack);
  ui.ampDecay.value = String(next.ampDecay);
  if (ui.climateBias) ui.climateBias.value = String(next.climateBias);
  syncReadouts();
  syncClimateReadout();
  fmPad.setFromValues(next.ratio, next.index);
}

/**
 * @param {number} midiNote
 * @param {import("./scheduler.js").LayerVoice | null} voice
 */
function fmParamsFromVoice(midiNote, voice) {
  if (!voice) return currentFmParams(midiToHz(midiNote));
  const ampAttack = voice.ampAttack ?? Number(ui.ampAttack.value);
  const ampDecay = voice.ampDecay ?? Number(ui.ampDecay.value);
  return {
    carrierHz: midiToHz(midiNote),
    ratio: voice.ratio,
    index: voice.index,
    cutoff: voice.cutoff,
    feedback: voice.feedback,
    carrierType: /** @type {OscillatorType} */ (voice.carrierType),
    modType: /** @type {OscillatorType} */ (voice.modType),
    ampAttack,
    ampDecay,
    indexAttack: Math.max(0.005, ampAttack * 1.2),
    indexDecay: Math.max(0.05, ampDecay * 0.9)
  };
}

/**
 * Resonance styling for one scheduled voice. Saved layers keep their own look.
 * @param {{ ratio: number, index: number, carrierType: string, modType: string } | null | undefined} voice
 * @returns {{ ratio: number, index: number, carrierType: OscillatorType, modType: OscillatorType } | null}
 */
function voiceFeelFrom(voice) {
  if (!voice) return null;
  return {
    ratio: voice.ratio ?? Number(ui.ratio.value),
    index: voice.index ?? Number(ui.index.value),
    carrierType: /** @type {OscillatorType} */ (voice.carrierType || ui.carrierType.value),
    modType: /** @type {OscillatorType} */ (voice.modType || ui.modType.value)
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

function syncStackToScheduler() {
  scheduler.setStackLayers(
    melodyStack.layersForScheduler().map((layer) => ({
      armed: layer.armed,
      steps: layer.steps,
      voice: layer.scene
        ? {
            ratio: layer.scene.ratio,
            index: layer.scene.index,
            cutoff: layer.scene.cutoff,
            feedback: layer.scene.feedback,
            carrierType: layer.scene.carrierType,
            modType: layer.scene.modType,
            ampAttack: layer.scene.ampAttack,
            ampDecay: layer.scene.ampDecay
          }
        : null
    }))
  );
}

/** Home working tab id in the stack UI. */
const HOME_TAB_ID = "home";
/** @type {string} */
let activeMelodyTab = HOME_TAB_ID;
let homeMuted = false;

function selectHomeTab() {
  activeMelodyTab = HOME_TAB_ID;
  renderMelodyStack();
}

function loadSavedMelody(id) {
  const saved = melodyStack.get(id);
  if (!saved) return;
  applyScene(saved.scene, { applyTransport: true });
  applyPattern(cloneSteps(saved.steps), `Editing “${saved.name}”`, { selectTab: id });
}

function renderMelodyStack() {
  const list = ui.melodyStackList;
  if (!list) return;
  list.innerHTML = "";

  // Default working tab: saves always come from the live editor.
  const homeLi = document.createElement("li");
  homeLi.className = `melody-stack-item melody-stack-home${
    activeMelodyTab === HOME_TAB_ID ? " is-active" : ""
  }`;
  homeLi.dataset.id = HOME_TAB_ID;

  const homePlayBtn = document.createElement("button");
  homePlayBtn.type = "button";
  homePlayBtn.className = `stack-transport ghost${homeMuted ? "" : " is-playing"}`;
  homePlayBtn.setAttribute("aria-label", homeMuted ? "Play Home melody" : "Pause Home melody");
  homePlayBtn.title = homeMuted ? "Play Home melody" : "Pause Home melody";
  homePlayBtn.innerHTML = homeMuted
    ? '<span class="stack-icon" aria-hidden="true">▶</span>'
    : '<span class="stack-icon" aria-hidden="true">❚❚</span>';
  homePlayBtn.addEventListener("click", () => {
    homeMuted = !homeMuted;
    scheduler.setPatternMuted(homeMuted);
    renderMelodyStack();
    if (homeMuted) {
      setStatus("Home paused: saved layers keep looping");
    } else {
      setStatus("Home playing");
      if (!scheduler.isRunning()) void startTransport();
    }
  });

  const homeBtn = document.createElement("button");
  homeBtn.type = "button";
  homeBtn.className = "ghost stack-name";
  homeBtn.textContent = "Home";
  homeBtn.title = "Home: working melody on the grid / living score";
  homeBtn.setAttribute("aria-current", activeMelodyTab === HOME_TAB_ID ? "true" : "false");
  homeBtn.addEventListener("click", () => {
    selectHomeTab();
    setStatus("Home: draw, tweak FM/tempo/generate, then Save");
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "ghost compact-btn stack-save-btn";
  saveBtn.id = "save-melody-btn";
  saveBtn.textContent = "Save";
  saveBtn.title = "Save Home melody + FM + tempo + generate settings";
  saveBtn.addEventListener("click", () => {
    saveHomeMelody();
  });

  const spacer = document.createElement("span");
  spacer.className = "stack-spacer";
  spacer.setAttribute("aria-hidden", "true");

  homeLi.append(homePlayBtn, homeBtn, saveBtn, spacer);
  list.append(homeLi);

  melodyStack.list().forEach((entry) => {
    const playing = entry.armed;
    const selected = activeMelodyTab === entry.id;
    const li = document.createElement("li");
    li.className = `melody-stack-item${playing ? " is-playing" : ""}${selected ? " is-active" : ""}`;
    li.dataset.id = entry.id;

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = `stack-transport ghost${playing ? " is-playing" : ""}`;
    playBtn.setAttribute("aria-label", playing ? `Pause ${entry.name}` : `Play ${entry.name}`);
    playBtn.title = playing ? "Pause loop" : "Play loop with Home";
    playBtn.innerHTML = playing
      ? '<span class="stack-icon" aria-hidden="true">❚❚</span>'
      : '<span class="stack-icon" aria-hidden="true">▶</span>';
    playBtn.addEventListener("click", () => {
      const nowPlaying = melodyStack.togglePlaying(entry.id);
      syncStackToScheduler();
      renderMelodyStack();
      if (nowPlaying) {
        setStatus(`Looping “${entry.name}” with Home`);
        if (!scheduler.isRunning()) void startTransport();
      } else {
        setStatus(`Paused “${entry.name}”`);
      }
    });

    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "ghost stack-name";
    nameBtn.textContent = entry.name;
    nameBtn.title = `Edit “${entry.name}”`;
    nameBtn.setAttribute("aria-label", `Edit ${entry.name}`);
    nameBtn.setAttribute("aria-current", selected ? "true" : "false");
    nameBtn.addEventListener("click", () => {
      loadSavedMelody(entry.id);
    });

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "ghost stack-icon-btn";
    loadBtn.setAttribute("aria-label", `Load ${entry.name} to edit`);
    loadBtn.title = "Load to edit";
    loadBtn.innerHTML = '<span class="stack-icon" aria-hidden="true">↺</span>';
    loadBtn.addEventListener("click", () => {
      loadSavedMelody(entry.id);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "ghost stack-icon-btn";
    delBtn.setAttribute("aria-label", `Delete ${entry.name}`);
    delBtn.title = "Delete saved melody";
    delBtn.innerHTML = '<span class="stack-icon" aria-hidden="true">🗑</span>';
    delBtn.addEventListener("click", () => {
      const wasSelected = activeMelodyTab === entry.id;
      melodyStack.remove(entry.id);
      if (wasSelected) activeMelodyTab = HOME_TAB_ID;
      syncStackToScheduler();
      renderMelodyStack();
      setStatus(`Removed “${entry.name}”`);
    });

    li.append(playBtn, nameBtn, loadBtn, delBtn);
    list.append(li);
  });
}

function saveHomeMelody() {
  const result = melodyStack.add(pattern, captureScene());
  if (!result.ok) {
    setStatus(result.reason);
    return;
  }
  activeMelodyTab = HOME_TAB_ID;
  syncStackToScheduler();
  renderMelodyStack();
  setStatus(
    `Saved Home (notes · FM · tempo · generate) as “${result.entry.name}” (${melodyStack.list().length}/${melodyStack.maxSlots})`
  );
}

/**
 * @param {{ note: number | null, locked: boolean, probability: number }[]} nextPattern
 * @param {string} status
 * @param {{ keepPreset?: boolean, recordUndo?: boolean, selectTab?: string }} [options]
 */
function applyPattern(nextPattern, status, options = {}) {
  if (options.recordUndo) pushUndo();
  pattern = nextPattern;
  scheduler.setPattern(pattern);
  renderSteps();
  setStatus(status);
  if (!options.keepPreset) clearPresetSelection();
  activeMelodyTab = options.selectTab ?? HOME_TAB_ID;
  renderMelodyStack();
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
    next == null
      ? `Step ${index + 1} → rest`
      : `Step ${index + 1} → ${midiToNoteName(next)} (${next})`
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
    const pitchLabel = step.note == null ? "·" : midiToNoteName(step.note);
    cell.innerHTML = `<span class="idx">${index + 1}${lockMark}</span><span class="pitch">${pitchLabel}</span>${prob}`;
    cell.title =
      step.note == null
        ? "Rest · Click: pitch · Right-click: lock · Shift-click: probability"
        : `${pitchLabel} (MIDI ${step.note}) · Click: pitch · Right-click: lock · Shift-click: probability`;
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
  setStatus("Undo: restored previous pattern");
  living?.syncFromPattern(pattern);
  setLivingStatus("Undo: garden restored");
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

  ui.ampAttack.addEventListener("input", syncReadouts);
  ui.ampDecay.addEventListener("input", syncReadouts);

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
  ui.climateBias?.addEventListener("input", syncClimateReadout);

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
renderMelodyStack();
syncStackToScheduler();
syncClimateReadout();
updateUndoButton();
setPlaying(false);
visualizer.stop();
setStatus("Living score ready: Start, then watch the garden breathe");
