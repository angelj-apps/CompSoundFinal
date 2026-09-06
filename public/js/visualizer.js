/**
 * Simple time-domain visualizer for the master bus.
 */

/**
 * @param {AnalyserNode} analyser
 * @param {HTMLCanvasElement} canvas
 */
export function createVisualizer(analyser, canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { start() {}, stop() {} };
  }

  const buffer = new Uint8Array(analyser.fftSize);
  let raf = 0;
  let running = false;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 72;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function frame() {
    if (!running) return;
    analyser.getByteTimeDomainData(buffer);

    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 72;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0e0c0a";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#e8a54b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const slice = width / buffer.length;
    for (let i = 0; i < buffer.length; i += 1) {
      const v = buffer[i] / 128;
      const y = (v * height) / 2;
      const x = i * slice;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      resize();
      frame();
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      const width = canvas.clientWidth || 320;
      const height = canvas.clientHeight || 72;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#0e0c0a";
      ctx.fillRect(0, 0, width, height);
    }
  };
}
