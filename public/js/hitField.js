/**
 * Resonance field — visual effects from hits / plants.
 * Color follows MIDI pitch; burst shape follows carrier (+ mod accent).
 */

/**
 * @typedef {object} VoiceFeel
 * @property {number} ratio
 * @property {number} index
 * @property {OscillatorType} [carrierType]
 * @property {OscillatorType} [modType]
 */

/**
 * @typedef {object} FieldParticle
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} life
 * @property {number} maxLife
 * @property {number} size
 * @property {number} rotation
 * @property {number} spin
 * @property {"circle" | "diamond" | "square" | "streak" | "spark"} shape
 * @property {string} color
 * @property {string} [accent]
 */

/**
 * @typedef {object} FieldRipple
 * @property {number} x
 * @property {number} y
 * @property {number} radius
 * @property {number} maxRadius
 * @property {number} life
 * @property {"ring" | "box" | "star" | "arc"} style
 * @property {string} color
 * @property {number} rotation
 */

/**
 * @typedef {object} FieldBolt
 * @property {number} x0
 * @property {number} y0
 * @property {number} x1
 * @property {number} y1
 * @property {number} life
 * @property {string} color
 */

/**
 * @param {HTMLCanvasElement | null} canvas
 * @param {() => VoiceFeel} getVoiceFeel
 */
export function createHitField(canvas, getVoiceFeel) {
  if (!canvas) {
    return { start() {}, stop() {}, onHit() {}, onPlant() {} };
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { start() {}, stop() {}, onHit() {}, onPlant() {} };
  }

  /** @type {FieldParticle[]} */
  let particles = [];
  /** @type {FieldRipple[]} */
  let ripples = [];
  /** @type {FieldBolt[]} */
  let bolts = [];
  let running = false;
  let raf = 0;
  let lastTs = 0;
  let wash = 0;
  /** @type {{ color: string, accent: string, amount: number }} */
  let washTint = { color: "rgba(232,165,75,1)", accent: "rgba(126,200,163,1)", amount: 0 };
  let idleBurst = false;

  function sizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 180;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width, height };
  }

  /**
   * @param {number} midi
   * @param {number} height
   */
  function midiToY(midi, height) {
    const t = Math.min(1, Math.max(0, (midi - 36) / 36));
    return height * (0.82 - t * 0.62);
  }

  /**
   * @param {number} stepIndex
   * @param {number} width
   */
  function stepToX(stepIndex, width) {
    return ((stepIndex + 0.5) / 16) * width;
  }

  /**
   * Pitch-class color: each note gets its own hue; brightness from index.
   * @param {number} midi
   * @param {number} index
   * @param {number} alpha
   * @param {number} [satBoost]
   */
  function colorForNote(midi, index, alpha = 1, satBoost = 0) {
    const hue = ((midi * 30) % 360 + 360) % 360;
    const hot = Math.min(1, index / 520);
    const sat = Math.min(100, 62 + satBoost + hot * 22);
    const light = 48 + hot * 18;
    return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
  }

  /**
   * Secondary accent from modulator waveform family.
   * @param {OscillatorType | undefined} modType
   * @param {number} midi
   * @param {number} alpha
   */
  function accentForMod(modType, midi, alpha = 1) {
    const base = ((midi * 30) + 40) % 360;
    if (modType === "square") return `hsla(${(base + 180) % 360}, 80%, 58%, ${alpha})`;
    if (modType === "sawtooth") return `hsla(${(base + 90) % 360}, 85%, 55%, ${alpha})`;
    if (modType === "triangle") return `hsla(${(base + 48) % 360}, 70%, 62%, ${alpha})`;
    return `hsla(${(base + 20) % 360}, 55%, 68%, ${alpha})`;
  }

  function ensureAnimating() {
    if (running || idleBurst) return;
    idleBurst = true;
    lastTs = 0;
    raf = requestAnimationFrame(frame);
  }

  /**
   * @param {number} stepIndex
   * @param {number} note
   * @param {{ planted?: boolean }} [options]
   */
  function spawn(stepIndex, note, options = {}) {
    const { width, height } = sizeCanvas();
    const feel = getVoiceFeel();
    const carrier = feel.carrierType || "sine";
    const mod = feel.modType || "sine";
    const x = stepToX(stepIndex, width);
    const y = midiToY(note, height);
    const energy = Math.min(1.55, 0.4 + feel.index / 480);
    const planted = Boolean(options.planted);
    const primary = colorForNote(note, feel.index, 1, planted ? 8 : 0);
    const accent = accentForMod(mod, note, 1);

    wash = Math.min(1, wash + (planted ? 0.22 : 0.42) * energy);
    washTint = { color: primary, accent, amount: wash };

    // Core ripple(s) shaped by carrier
    if (carrier === "square") {
      ripples.push({
        x,
        y,
        radius: 6,
        maxRadius: 34 + energy * 78,
        life: 1,
        style: "box",
        color: primary,
        rotation: 0
      });
      ripples.push({
        x,
        y,
        radius: 3,
        maxRadius: 18 + energy * 40,
        life: 0.85,
        style: "box",
        color: accent,
        rotation: Math.PI / 4
      });
    } else if (carrier === "triangle") {
      ripples.push({
        x,
        y,
        radius: 5,
        maxRadius: 30 + energy * 72,
        life: 1,
        style: "star",
        color: primary,
        rotation: Math.random() * Math.PI
      });
      ripples.push({
        x,
        y,
        radius: 4,
        maxRadius: 22 + energy * 50,
        life: 0.9,
        style: "star",
        color: accent,
        rotation: Math.random() * Math.PI
      });
    } else if (carrier === "sawtooth") {
      ripples.push({
        x,
        y,
        radius: 4,
        maxRadius: 36 + energy * 88,
        life: 1,
        style: "arc",
        color: primary,
        rotation: -0.4
      });
      // directional bolts
      for (let i = 0; i < Math.round(3 + energy * 4); i += 1) {
        const ang = -0.35 + Math.random() * 0.7;
        const len = 40 + Math.random() * 70 * energy;
        bolts.push({
          x0: x,
          y0: y,
          x1: x + Math.cos(ang) * len,
          y1: y + Math.sin(ang) * len,
          life: 1,
          color: i % 2 ? accent : primary
        });
      }
    } else {
      ripples.push({
        x,
        y,
        radius: 5,
        maxRadius: 32 + energy * 80,
        life: 1,
        style: "ring",
        color: primary,
        rotation: 0
      });
      ripples.push({
        x,
        y,
        radius: 2,
        maxRadius: 16 + energy * 36,
        life: 0.75,
        style: "ring",
        color: accent,
        rotation: 0
      });
    }

    const count = planted
      ? Math.round(10 + energy * 14)
      : Math.round(16 + energy * 28);

    for (let i = 0; i < count; i += 1) {
      const useAccent = i % 3 === 0;
      /** @type {FieldParticle["shape"]} */
      let shape = "circle";
      let angle = Math.random() * Math.PI * 2;
      let speed = (0.55 + Math.random() * 2.6) * energy;
      let size = 1.2 + Math.random() * 3.2 * energy;
      let spin = (Math.random() - 0.5) * 6;

      if (carrier === "triangle") {
        shape = "diamond";
        angle = (Math.floor(Math.random() * 6) * Math.PI) / 3 + Math.random() * 0.2;
        speed *= 1.15;
        size *= 1.1;
      } else if (carrier === "square") {
        shape = Math.random() > 0.35 ? "square" : "spark";
        angle = (Math.floor(Math.random() * 8) * Math.PI) / 4;
        speed *= 0.95 + Math.random() * 0.4;
      } else if (carrier === "sawtooth") {
        shape = "streak";
        angle = -0.55 + Math.random() * 1.1;
        speed *= 1.35 + Math.random() * 0.5;
        size = 1.5 + Math.random() * 4.5 * energy;
        spin = 0;
      } else {
        shape = Math.random() > 0.7 ? "spark" : "circle";
        speed *= 0.85 + Math.random() * 0.3;
      }

      // Modulator adds jitter / second population
      if (mod === "square" && Math.random() > 0.55) {
        angle = (Math.floor(angle / (Math.PI / 2)) * Math.PI) / 2;
      }
      if (mod === "sawtooth") {
        speed *= 1.12;
      }
      if (mod === "triangle" && shape === "circle") {
        shape = "diamond";
      }

      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (carrier === "sawtooth" ? 0.15 : 0.45),
        life: 1,
        maxLife: 0.5 + Math.random() * (carrier === "sine" ? 0.9 : 0.65),
        size,
        rotation: Math.random() * Math.PI,
        spin,
        shape,
        color: useAccent ? accent : primary,
        accent
      });
    }

    // Extra note-orbit sparks for richer color pop
    const orbitN = Math.round(4 + energy * 6);
    for (let i = 0; i < orbitN; i += 1) {
      const a = (i / orbitN) * Math.PI * 2;
      particles.push({
        x: x + Math.cos(a) * 6,
        y: y + Math.sin(a) * 6,
        vx: Math.cos(a) * 0.9 * energy,
        vy: Math.sin(a) * 0.9 * energy,
        life: 1,
        maxLife: 0.35 + Math.random() * 0.35,
        size: 1.4 + Math.random() * 1.6,
        rotation: a,
        spin: 4,
        shape: "spark",
        color: colorForNote(note + i, feel.index, 1, 12),
        accent
      });
    }

    if (particles.length > 560) particles = particles.slice(-560);
    if (ripples.length > 36) ripples = ripples.slice(-36);
    if (bolts.length > 40) bolts = bolts.slice(-40);
    ensureAnimating();
  }

  /**
   * @param {FieldParticle} p
   * @param {number} alpha
   */
  function drawParticle(p, alpha) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = p.color;

    const s = p.size * Math.max(0.15, p.life);
    if (p.shape === "square") {
      ctx.fillRect(-s, -s, s * 2, s * 2);
    } else if (p.shape === "diamond") {
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.3);
      ctx.lineTo(s, 0);
      ctx.lineTo(0, s * 1.3);
      ctx.lineTo(-s, 0);
      ctx.closePath();
      ctx.fill();
    } else if (p.shape === "streak") {
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, 0);
      ctx.lineTo(s * 2.8, -s * 0.35);
      ctx.lineTo(s * 2.8, s * 0.35);
      ctx.closePath();
      ctx.fill();
    } else if (p.shape === "spark") {
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.6);
      ctx.lineTo(s * 0.35, 0);
      ctx.lineTo(0, s * 1.6);
      ctx.lineTo(-s * 0.35, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * @param {FieldRipple} ripple
   */
  function drawRipple(ripple) {
    const a = Math.max(0, ripple.life * 0.75);
    ctx.save();
    ctx.translate(ripple.x, ripple.y);
    ctx.rotate(ripple.rotation);
    ctx.strokeStyle = ripple.color;
    ctx.globalAlpha = a;
    ctx.lineWidth = 1.4 + ripple.life * 2.2;

    if (ripple.style === "box") {
      const r = ripple.radius;
      ctx.strokeRect(-r, -r, r * 2, r * 2);
    } else if (ripple.style === "star") {
      const r = ripple.radius;
      ctx.beginPath();
      for (let i = 0; i < 3; i += 1) {
        const ang = (i / 3) * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(ang) * r;
        const py = Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    } else if (ripple.style === "arc") {
      ctx.beginPath();
      ctx.arc(0, 0, ripple.radius, -0.9, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, ripple.radius * 0.7, Math.PI - 0.7, Math.PI + 0.7);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, ripple.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * @param {number} dt
   */
  function tick(dt) {
    const { width, height } = sizeCanvas();
    wash = Math.max(0, wash - dt * 0.48);
    washTint.amount = wash;

    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(12, 10, 8, 0.22)";
    ctx.fillRect(0, 0, width, height);

    if (wash > 0.02) {
      ctx.save();
      ctx.globalAlpha = wash * 0.28;
      ctx.fillStyle = washTint.color;
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.52, width * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = wash * 0.16;
      ctx.fillStyle = washTint.accent;
      ctx.beginPath();
      ctx.arc(width * 0.58, height * 0.48, width * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(58, 52, 46, 0.32)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 16; i += 1) {
      const gx = (i / 16) * width;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
    }

    bolts = bolts.filter((bolt) => {
      bolt.life -= dt * 2.2;
      if (bolt.life <= 0) return false;
      ctx.save();
      ctx.globalAlpha = bolt.life;
      ctx.strokeStyle = bolt.color;
      ctx.lineWidth = 1.2 + bolt.life * 2;
      ctx.beginPath();
      ctx.moveTo(bolt.x0, bolt.y0);
      const mx = (bolt.x0 + bolt.x1) / 2 + (Math.random() - 0.5) * 8;
      const my = (bolt.y0 + bolt.y1) / 2 + (Math.random() - 0.5) * 8;
      ctx.lineTo(mx, my);
      ctx.lineTo(bolt.x1, bolt.y1);
      ctx.stroke();
      ctx.restore();
      return true;
    });

    ripples = ripples.filter((ripple) => {
      ripple.life -= dt * 1.05;
      ripple.radius += (ripple.maxRadius - ripple.radius) * Math.min(1, dt * 4.2);
      ripple.rotation += dt * (ripple.style === "star" ? 1.8 : 0.4);
      if (ripple.life <= 0) return false;
      drawRipple(ripple);
      return true;
    });

    particles = particles.filter((p) => {
      p.life -= dt / p.maxLife;
      if (p.life <= 0) return false;
      const grav = p.shape === "streak" ? 6 : 18;
      p.vy += grav * dt;
      p.x += p.vx * 42 * dt;
      p.y += p.vy * 42 * dt;
      p.rotation += p.spin * dt;
      drawParticle(p, p.life);
      return true;
    });

    ctx.globalAlpha = 1;
  }

  function frame(ts) {
    if (!running && !idleBurst) return;
    const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000);
    lastTs = ts;
    tick(dt);

    if (
      !running &&
      particles.length === 0 &&
      ripples.length === 0 &&
      bolts.length === 0 &&
      wash <= 0.02
    ) {
      idleBurst = false;
      return;
    }

    raf = requestAnimationFrame(frame);
  }

  function clearIdle() {
    const { width, height } = sizeCanvas();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0c0a08";
    ctx.fillRect(0, 0, width, height);
  }

  return {
    start() {
      idleBurst = false;
      if (running) return;
      running = true;
      lastTs = 0;
      clearIdle();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      particles = [];
      ripples = [];
      bolts = [];
      wash = 0;
      idleBurst = false;
      clearIdle();
    },
    /**
     * @param {number} stepIndex
     * @param {number | null} note
     */
    onHit(stepIndex, note) {
      if (note == null) return;
      spawn(stepIndex, note, { planted: false });
    },
    /**
     * @param {number} stepIndex
     * @param {number | null} note
     */
    onPlant(stepIndex, note) {
      if (note == null) return;
      spawn(stepIndex, note, { planted: true });
    }
  };
}
