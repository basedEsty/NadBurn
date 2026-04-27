import { motion } from "framer-motion";
import { useMemo } from "react";
import { useAnimationPrefs } from "@/lib/animation-prefs";

interface FireParticlesProps {
  size?: number;
  count?: number;
  className?: string;
}

export function FireParticles({ size = 48, count = 14, className = "" }: FireParticlesProps) {
  const { effects: effectsEnabled } = useAnimationPrefs();
  const particles = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        delay: (i / count) * 1.6 + Math.random() * 0.3,
        offsetX: (Math.random() - 0.5) * size * 0.55,
        startX: (Math.random() - 0.5) * size * 0.25,
        hue: 270 + (Math.random() - 0.5) * 35,
        scale: 0.6 + Math.random() * 0.7,
        duration: 1.4 + Math.random() * 0.6,
      })),
    [count, size]
  );

  if (!effectsEnabled) {
    // Static fallback — keeps the silhouette and color story but skips the
    // ~15 framer-motion particles per instance, which adds up fast on pages
    // with several burners visible at once.
    return (
      <div
        className={`relative inline-block ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-0 rounded-full"
          style={{
            width: size * 0.6,
            height: size * 0.2,
            background:
              "radial-gradient(ellipse, hsla(270, 90%, 60%, 0.55), transparent 70%)",
            filter: "blur(6px)",
          }}
        />
        <div
          className="absolute left-1/2 -translate-x-1/2 rounded-full"
          style={{
            bottom: size * 0.05,
            width: size * 0.35,
            height: size * 0.35,
            background:
              "radial-gradient(circle, hsla(280, 95%, 75%, 0.95), hsla(270, 90%, 50%, 0) 70%)",
            filter: "blur(2px)",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative inline-block ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* base glow */}
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-0 rounded-full"
        style={{
          width: size * 0.6,
          height: size * 0.2,
          background:
            "radial-gradient(ellipse, hsla(270, 90%, 60%, 0.55), transparent 70%)",
          filter: "blur(6px)",
        }}
      />
      {/* core */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 rounded-full"
        style={{
          bottom: size * 0.05,
          width: size * 0.35,
          height: size * 0.35,
          background:
            "radial-gradient(circle, hsla(280, 95%, 75%, 0.95), hsla(270, 90%, 50%, 0) 70%)",
          filter: "blur(2px)",
        }}
        animate={{ scale: [0.85, 1.15, 0.85], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* rising particles */}
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `calc(50% + ${p.startX}px)`,
            bottom: 0,
            width: size * 0.13,
            height: size * 0.13,
            background: `radial-gradient(circle, hsla(${p.hue}, 95%, 75%, 1), hsla(${p.hue}, 90%, 45%, 0) 70%)`,
            filter: "blur(1px)",
          }}
          animate={{
            y: [0, -size * 0.95],
            x: [0, p.offsetX],
            opacity: [0, 1, 0],
            scale: [0.4, p.scale, 0.2],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}
