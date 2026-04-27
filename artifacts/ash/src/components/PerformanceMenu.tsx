import { Gauge } from "lucide-react";
import { Button } from "./ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";
import { Switch } from "./ui/switch";
import {
  setAnimationPref,
  useAnimationPrefs,
  type AnimationPrefs,
} from "@/lib/animation-prefs";

type ToggleRow = {
  key: keyof AnimationPrefs;
  label: string;
  hint: string;
};

const ROWS: ToggleRow[] = [
  {
    key: "background",
    label: "Background animation",
    hint: "Constellation, embers and aurora orbs",
  },
  {
    key: "cursor",
    label: "Custom cursor",
    hint: "Glowing arrow that follows your mouse",
  },
  {
    key: "effects",
    label: "Decorative effects",
    hint: "Flickering flames around buttons and titles",
  },
];

export default function PerformanceMenu() {
  const prefs = useAnimationPrefs();
  const allOn = prefs.background && prefs.cursor && prefs.effects;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Performance settings"
          title="Performance"
          className="text-white/80 hover:bg-white/10 hover:text-white"
        >
          <Gauge className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 border border-white/10 bg-zinc-950/95 p-4 text-white backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Performance</p>
            <p className="text-xs text-white/60">
              Disable animations on slower devices.
            </p>
          </div>
          <span
            className={`mt-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
              allOn
                ? "bg-violet-500/15 text-violet-300"
                : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {allOn ? "Full" : "Light"}
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {ROWS.map((row) => {
            const labelId = `pm-${row.key}-label`;
            const hintId = `pm-${row.key}-hint`;
            return (
              <div
                key={row.key}
                className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 transition-colors hover:bg-white/[0.05]"
              >
                <div className="min-w-0">
                  <p
                    id={labelId}
                    className="text-sm font-medium leading-tight text-white"
                  >
                    {row.label}
                  </p>
                  <p id={hintId} className="mt-0.5 text-xs text-white/50">
                    {row.hint}
                  </p>
                </div>
                <Switch
                  checked={prefs[row.key]}
                  onCheckedChange={(v) => setAnimationPref(row.key, v)}
                  aria-labelledby={labelId}
                  aria-describedby={hintId}
                />
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-snug text-white/40">
          Saved on this device. Disabling them all keeps the same look but
          stops every running animation.
        </p>
      </PopoverContent>
    </Popover>
  );
}
