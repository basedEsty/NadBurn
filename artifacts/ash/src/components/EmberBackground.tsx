import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useAnimationPrefs } from '@/lib/animation-prefs';

// Particle counts scale down on phones / tablets so the canvas animation
// doesn't pin a single core on weaker devices. We pick the bucket once at
// mount based on inner width — picked thresholds match the Tailwind sm/md
// breakpoints. Constants are kept as plain numbers (not refs) because the
// animation loop reads them on every frame and any indirection would show
// up in the profiler.
function pickPerfBucket(): {
  NODE_COUNT: number;
  EMBER_COUNT: number;
  ORB_COUNT: number;
} {
  if (typeof window === "undefined") {
    return { NODE_COUNT: 70, EMBER_COUNT: 40, ORB_COUNT: 5 };
  }
  const w = window.innerWidth;
  if (w < 640) return { NODE_COUNT: 28, EMBER_COUNT: 16, ORB_COUNT: 2 };
  if (w < 1024) return { NODE_COUNT: 45, EMBER_COUNT: 26, ORB_COUNT: 3 };
  return { NODE_COUNT: 70, EMBER_COUNT: 40, ORB_COUNT: 5 };
}

const LINK_DISTANCE = 185;
const PULSE_INTERVAL = 1400;

type Node = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pulse: number;
  pulseSpeed: number;
};

type Pulse = {
  fromIdx: number;
  toIdx: number;
  progress: number;
  speed: number;
};

type Orb = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
  drift: number;
};

type Ember = {
  x: number;
  y: number;
  vy: number;
  vx: number;
  size: number;
  life: number;
  maxLife: number;
};

const EmberBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transitionRef = useRef<{ start: number; cx: number; cy: number } | null>(null);
  const [location] = useLocation();
  const { background: backgroundEnabled } = useAnimationPrefs();

  useEffect(() => {
    if (!backgroundEnabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Pick density once at mount based on viewport so phones don't try to
    // animate the desktop-grade particle field. Re-bucketing on resize
    // would re-seed the canvas mid-session, so we deliberately freeze it.
    const { NODE_COUNT, EMBER_COUNT, ORB_COUNT } = pickPerfBucket();

    let animationFrameId: number;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    let orbs: Orb[] = [];
    let embers: Ember[] = [];
    let lastPulseTime = 0;
    let startTime = performance.now();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const seedNodes = () => {
      nodes = Array.from({ length: NODE_COUNT }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        radius: Math.random() * 1.8 + 1.6,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: Math.random() * 0.02 + 0.01,
      }));
    };

    const seedOrbs = () => {
      orbs = Array.from({ length: ORB_COUNT }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.12,
        radius: Math.random() * 320 + 280,
        hue: 260 + Math.random() * 40, // violet → magenta
        drift: Math.random() * Math.PI * 2,
      }));
    };

    seedNodes();
    seedOrbs();

    const spawnPulse = () => {
      if (nodes.length < 2) return;
      const fromIdx = Math.floor(Math.random() * nodes.length);
      const from = nodes[fromIdx];
      const neighbors: number[] = [];
      for (let i = 0; i < nodes.length; i++) {
        if (i === fromIdx) continue;
        const dx = nodes[i].x - from.x;
        const dy = nodes[i].y - from.y;
        if (Math.hypot(dx, dy) < LINK_DISTANCE) neighbors.push(i);
      }
      if (!neighbors.length) return;
      const toIdx = neighbors[Math.floor(Math.random() * neighbors.length)];
      pulses.push({
        fromIdx,
        toIdx,
        progress: 0,
        speed: Math.random() * 0.018 + 0.012,
      });
    };

    const spawnEmber = () => {
      embers.push({
        x: Math.random() * canvas.width,
        y: canvas.height + 6,
        vy: -(Math.random() * 0.6 + 0.3),
        vx: (Math.random() - 0.5) * 0.4,
        size: Math.random() * 1.6 + 0.8,
        life: 0,
        maxLife: Math.random() * 600 + 400,
      });
    };

    const animate = (time: number) => {
      const t = (time - startTime) / 1000; // seconds

      // Animated base gradient — mostly slate gray / near-black, with only a
      // subtle violet whisper at the bottom that breathes in and out. The
      // overall palette stays gray/black so purple reads as a hint, not a
      // primary color.
      const breathe = (Math.sin(t * 0.18) + 1) / 2; // 0..1
      const bottomR = Math.floor(14 + breathe * 8);  // 14..22
      const bottomG = Math.floor(13 + breathe * 5);  // 13..18
      const bottomB = Math.floor(18 + breathe * 14); // 18..32
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, '#040406');
      gradient.addColorStop(0.65, `rgba(${bottomR - 4}, ${bottomG - 2}, ${bottomB - 6}, 1)`);
      gradient.addColorStop(1, `rgb(${bottomR}, ${bottomG}, ${bottomB})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Drifting radial "aurora" orbs — large, soft, additive blends.
      ctx.globalCompositeOperation = 'lighter';
      for (const o of orbs) {
        o.drift += 0.003;
        const drx = Math.cos(o.drift) * 30;
        const dry = Math.sin(o.drift * 0.8) * 22;
        o.x += o.vx;
        o.y += o.vy;
        if (o.x < -o.radius) o.x = canvas.width + o.radius;
        if (o.x > canvas.width + o.radius) o.x = -o.radius;
        if (o.y < -o.radius) o.y = canvas.height + o.radius;
        if (o.y > canvas.height + o.radius) o.y = -o.radius;

        const cx = o.x + drx;
        const cy = o.y + dry;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, o.radius);
        // Desaturated, soft violet — reads as a gray glow with a faint purple
        // tint rather than a saturated bloom.
        grad.addColorStop(0, `hsla(${o.hue}, 35%, 50%, 0.08)`);
        grad.addColorStop(0.45, `hsla(${o.hue + 10}, 25%, 35%, 0.035)`);
        grad.addColorStop(1, 'hsla(270, 30%, 25%, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, o.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // Route-transition shockwave: when the route changes the page kicks
      // off a 1.2s "scatter and reform" pass that radiates an impulse from
      // the click point (or screen center) and then has nodes drift toward
      // a fresh randomized layout — making it feel like the constellation
      // physically rearranged as you walked into the next room.
      const tr = transitionRef.current;
      if (tr) {
        const elapsed = (time - tr.start) / 1000;
        const duration = 1.2;
        if (elapsed > duration) {
          transitionRef.current = null;
        } else {
          const phase = elapsed / duration;
          for (const n of nodes) {
            const dx = n.x - tr.cx;
            const dy = n.y - tr.cy;
            const dist = Math.hypot(dx, dy) || 1;
            // Outward push that decays over the transition.
            const push = (1 - phase) * 0.9;
            n.vx += (dx / dist) * push * 0.35;
            n.vy += (dy / dist) * push * 0.35;
            // Mild damping so they don't fly forever.
            n.vx *= 0.97;
            n.vy *= 0.97;
          }
          // Bonus ember burst from the impact point.
          if (Math.random() < 0.6) {
            embers.push({
              x: tr.cx + (Math.random() - 0.5) * 80,
              y: tr.cy + (Math.random() - 0.5) * 40,
              vx: (Math.random() - 0.5) * 1.4,
              vy: -(Math.random() * 1.2 + 0.4),
              size: Math.random() * 2 + 1,
              life: 0,
              maxLife: Math.random() * 280 + 220,
            });
          }
        }
      }

      // update node positions
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.pulse += n.pulseSpeed;
        if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
      }

      // links between nearby nodes — brighter and slightly thicker so the
      // constellation reads clearly over the dark base.
      ctx.lineWidth = 1.1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DISTANCE) {
            const alpha = (1 - dist / LINK_DISTANCE) * 0.55;
            ctx.strokeStyle = `rgba(192, 132, 252, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // spawn pulses on interval
      if (time - lastPulseTime > PULSE_INTERVAL) {
        for (let k = 0; k < 3; k++) spawnPulse();
        lastPulseTime = time;
      }

      // pulses traveling along edges
      pulses = pulses.filter((p) => {
        const from = nodes[p.fromIdx];
        const to = nodes[p.toIdx];
        if (!from || !to) return false;
        p.progress += p.speed;
        if (p.progress >= 1) return false;
        const x = from.x + (to.x - from.x) * p.progress;
        const y = from.y + (to.y - from.y) * p.progress;
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = 'rgba(192, 132, 252, 0.9)';
        ctx.fillStyle = 'rgba(216, 180, 254, 0.95)';
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return true;
      });

      // nodes with breathing pulse — bigger glow halo so they pop.
      for (const n of nodes) {
        const pulseScale = 1 + Math.sin(n.pulse) * 0.3;
        ctx.save();
        ctx.shadowBlur = 22;
        ctx.shadowColor = 'rgba(192, 132, 252, 1)';
        ctx.fillStyle = 'rgba(220, 190, 255, 1)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius * pulseScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Floating sparks rising from the bottom — recolored from warm ember
      // orange to soft lavender so they fit the gray/black + purple-hint
      // palette on every page.
      while (embers.length < EMBER_COUNT) spawnEmber();
      ctx.globalCompositeOperation = 'lighter';
      embers = embers.filter((e) => {
        e.life += 1;
        e.x += e.vx + Math.sin((e.life + e.x) * 0.02) * 0.15;
        e.y += e.vy;
        if (e.life > e.maxLife || e.y < -10) return false;
        const fade =
          e.life < 60
            ? e.life / 60
            : 1 - Math.max(0, (e.life - 60) / (e.maxLife - 60));
        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = `rgba(168, 130, 220, ${0.55 * fade})`;
        ctx.fillStyle = `rgba(216, 200, 240, ${0.8 * fade})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return true;
      });
      ctx.globalCompositeOperation = 'source-over';

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [backgroundEnabled]);

  // Trigger a constellation shockwave on every route change.
  useEffect(() => {
    if (!backgroundEnabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    transitionRef.current = { start: performance.now(), cx, cy };
  }, [location, backgroundEnabled]);

  if (!backgroundEnabled) {
    // Render a static gradient that matches the canvas's resting palette
    // (deep slate-black with a soft violet whisper at the bottom). This
    // way the page never goes flat-black when the user opts out — and the
    // GPU/CPU stays idle.
    return (
      <div
        aria-hidden
        className="fixed inset-0 w-full h-full pointer-events-none z-0"
        style={{
          background:
            "linear-gradient(to bottom, #040406 0%, #0c0a14 65%, #15111c 100%)",
        }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
    />
  );
};

export default EmberBackground;
