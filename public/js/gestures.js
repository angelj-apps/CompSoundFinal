/**
 * Pointer gestures that replace “slider → number” as the main performance surface.
 */

/**
 * Place a radial glow origin under the pointer (percentages for CSS).
 * @param {HTMLElement} surface
 * @param {number} clientX
 * @param {number} clientY
 */
function setGlowOrigin(surface, clientX, clientY) {
  const rect = surface.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  surface.style.setProperty("--glow-x", `${(x * 100).toFixed(2)}%`);
  surface.style.setProperty("--glow-y", `${(y * 100).toFixed(2)}%`);
}

/**
 * FM timbre pad: X = ratio, Y = index (inverted so up = brighter).
 * @param {HTMLElement | null} el
 * @param {{
 *   getRatioRange: () => { min: number, max: number },
 *   getIndexRange: () => { min: number, max: number },
 *   onChange: (values: { ratio: number, index: number }, ending: boolean) => void
 * }} options
 */
export function bindFmPad(el, options) {
  if (!el) {
    console.error("FM pad element missing");
    return { setFromValues() {} };
  }

  const knob = el.querySelector(".pad-knob");
  let dragging = false;
  /** @type {number | null} */
  let activePointerId = null;

  function ranges() {
    return {
      ratio: options.getRatioRange(),
      index: options.getIndexRange()
    };
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {boolean} ending
   */
  function applyPointer(clientX, clientY, ending) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const { ratio, index } = ranges();
    const nextRatio = ratio.min + x * (ratio.max - ratio.min);
    const nextIndex = index.min + (1 - y) * (index.max - index.min);
    setGlowOrigin(el, clientX, clientY);
    placeKnob(x, y);
    options.onChange({ ratio: nextRatio, index: nextIndex }, ending);
  }

  function placeKnob(x, y) {
    if (!knob) return;
    knob.style.left = `${x * 100}%`;
    knob.style.top = `${y * 100}%`;
  }

  /**
   * @param {number} ratio
   * @param {number} index
   */
  function setFromValues(ratio, index) {
    const r = ranges().ratio;
    const i = ranges().index;
    const spanR = r.max - r.min || 1;
    const spanI = i.max - i.min || 1;
    const x = (ratio - r.min) / spanR;
    const y = 1 - (index - i.min) / spanI;
    placeKnob(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  }

  function onPointerMove(event) {
    if (!dragging) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    event.preventDefault();
    applyPointer(event.clientX, event.clientY, false);
  }

  function onPointerUp(event) {
    if (!dragging) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    el.classList.remove("is-pressed");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    applyPointer(event.clientX, event.clientY, true);
  }

  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    dragging = true;
    activePointerId = event.pointerId;
    el.classList.add("is-pressed");
    setGlowOrigin(el, event.clientX, event.clientY);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    applyPointer(event.clientX, event.clientY, false);
  });

  return { setFromValues };
}

