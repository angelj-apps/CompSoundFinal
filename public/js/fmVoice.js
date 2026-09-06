/**
 * FM voice with separate carrier/mod waveforms, optional lowpass,
 * and light feedback into the modulator frequency.
 *
 * Core class technique: modulator → GainNode(index) → carrier.frequency
 */

/**
 * @param {number} midiNote
 * @returns {number}
 */
export function midiToHz(midiNote) {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

/**
 * @typedef {object} FmVoiceParams
 * @property {number} carrierHz
 * @property {number} ratio
 * @property {number} index
 * @property {number} [ampAttack]
 * @property {number} [ampDecay]
 * @property {number} [indexAttack]
 * @property {number} [indexDecay]
 * @property {OscillatorType} [carrierType]
 * @property {OscillatorType} [modType]
 * @property {number} [cutoff]
 * @property {number} [feedback]
 */

/**
 * @param {AudioContext} audioCtx
 * @param {AudioNode} destination
 * @param {FmVoiceParams} params
 * @param {number} [when]
 */
export function playFmNote(audioCtx, destination, params, when = audioCtx.currentTime) {
  const {
    carrierHz,
    ratio,
    index,
    ampAttack = 0.008,
    ampDecay = 0.2,
    indexAttack = 0.012,
    indexDecay = 0.18,
    carrierType = "sine",
    modType = "sine",
    cutoff = 5000,
    feedback = 0
  } = params;

  const start = Math.max(when, audioCtx.currentTime);
  const attack = Math.max(ampAttack, 0.005);
  const decay = Math.max(ampDecay, 0.05);
  const idxAttack = Math.max(indexAttack, 0.005);
  const idxDecay = Math.max(indexDecay, 0.05);
  const stopAt = start + Math.max(attack + decay, idxAttack + idxDecay) + 0.04;

  const carrier = audioCtx.createOscillator();
  const modulator = audioCtx.createOscillator();
  const modulationIndex = audioCtx.createGain();
  const ampEnv = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  const feedbackGain = audioCtx.createGain();

  carrier.type = carrierType;
  modulator.type = modType;
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(Math.max(cutoff, 120), start);

  carrier.frequency.setValueAtTime(carrierHz, start);
  modulator.frequency.setValueAtTime(carrierHz * ratio, start);

  const peakIndex = Math.max(index, 0.0001);
  modulationIndex.gain.setValueAtTime(0.0001, start);
  modulationIndex.gain.exponentialRampToValueAtTime(peakIndex, start + idxAttack);
  modulationIndex.gain.exponentialRampToValueAtTime(0.0001, start + idxAttack + idxDecay);

  // Mild carrier→modulator feedback (scaled Hz). Keep small for stability.
  feedbackGain.gain.setValueAtTime(Math.max(0, feedback) * carrierHz * 0.35, start);

  ampEnv.gain.setValueAtTime(0.0001, start);
  ampEnv.gain.exponentialRampToValueAtTime(1, start + attack);
  ampEnv.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);

  modulator.connect(modulationIndex);
  modulationIndex.connect(carrier.frequency);
  carrier.connect(feedbackGain);
  feedbackGain.connect(modulator.frequency);
  carrier.connect(filter);
  filter.connect(ampEnv);
  ampEnv.connect(destination);

  carrier.start(start);
  modulator.start(start);
  carrier.stop(stopAt);
  modulator.stop(stopAt);

  carrier.onended = () => {
    modulator.disconnect();
    modulationIndex.disconnect();
    feedbackGain.disconnect();
    carrier.disconnect();
    filter.disconnect();
    ampEnv.disconnect();
  };
}
