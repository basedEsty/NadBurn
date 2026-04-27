import { useEffect, useRef, useState } from "react";
import { useAnimationPrefs } from "@/lib/animation-prefs";

const TEXT_FIELD_SELECTOR =
  'input[type="text"], input[type="email"], input[type="password"], ' +
  'input[type="number"], input[type="search"], input[type="tel"], ' +
  'input[type="url"], input:not([type]), textarea, [contenteditable="true"]';

const INTERACTIVE_SELECTOR =
  'a, button, [role="button"], [data-clickable="true"], .cursor-pointer, ' +
  'input[type="submit"], input[type="button"], input[type="checkbox"], ' +
  'input[type="radio"], label[for], summary, select';

// Synchronous read — running this inside useState's initializer (instead
// of an effect) avoids a one-frame "no cursor" flash when the user toggles
// the custom cursor back on, since the CSS class is added immediately by
// setAnimationPref but the component would otherwise wait a render to mount.
function isFinePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: fine)").matches;
}

export default function CustomCursor() {
  const prefs = useAnimationPrefs();
  const arrowRef = useRef<HTMLDivElement | null>(null);
  const [hovering, setHovering] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [overText, setOverText] = useState(false);
  const [hidden, setHidden] = useState(true);
  const enabled = isFinePointer() && prefs.cursor;

  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: MouseEvent) => {
      const node = arrowRef.current;
      if (node) {
        node.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }
      setHidden(false);
      const target = e.target as Element | null;
      const isText = !!target?.closest(TEXT_FIELD_SELECTOR);
      setOverText(isText);
      setHovering(!isText && !!target?.closest(INTERACTIVE_SELECTOR));
    };

    const onLeave = () => setHidden(true);
    const onEnter = () => setHidden(false);
    const onDown = () => setPressed(true);
    const onUp = () => setPressed(false);

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("mouseenter", onEnter);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("mouseenter", onEnter);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [enabled]);

  if (!enabled) return null;

  const visible = !hidden && !overText;

  return (
    <div
      ref={arrowRef}
      className={`cursor-arrow ${visible ? "" : "is-hidden"} ${
        hovering ? "is-hovering" : ""
      } ${pressed ? "is-pressed" : ""}`}
      aria-hidden
    >
      {/* The halo is intentionally NOT a separate <circle> here — that would
          float offset from the arrow tip. Instead, the violet glow comes from
          the layered drop-shadow filters on .cursor-arrow in index.css, which
          trace the arrow's exact silhouette so the halo always wraps the
          shape itself. */}
      <svg
        width="26"
        height="28"
        viewBox="0 0 26 28"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="cur-arrow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="45%" stopColor="#f5d0fe" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <path
          d="M2 1 L2 19 L7.5 14.8 L11 22.5 L14.4 21.1 L10.9 13.6 L18 13.6 Z"
          fill="url(#cur-arrow)"
          stroke="#1a0f2e"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
