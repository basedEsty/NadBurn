import { Zap, Gauge, Battery, Check, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  getPerformanceLevel,
  setPerformanceLevel,
  useAnimationPrefs,
  type PerformanceLevel,
} from "@/lib/animation-prefs";

type Step = {
  level: PerformanceLevel;
  label: string;
  hint: string;
  Icon: typeof Zap;
};

const STEPS: Step[] = [
  {
    level: "high",
    label: "High",
    hint: "All animations on",
    Icon: Zap,
  },
  {
    level: "medium",
    label: "Medium",
    hint: "Background paused",
    Icon: Gauge,
  },
  {
    level: "low",
    label: "Low",
    hint: "Static — best for slow devices",
    Icon: Battery,
  },
];

export default function PerformanceMenu() {
  const prefs = useAnimationPrefs();
  const active = getPerformanceLevel(prefs);
  const current = STEPS.find((s) => s.level === active) ?? STEPS[0];
  const ActiveIcon = current.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Performance: ${current.label}`}
          title={`Performance · ${current.label}`}
          className="shrink-0 gap-1.5 border-white/10 bg-white/5 px-2.5 hover:bg-white/10 sm:px-3"
        >
          <ActiveIcon className="h-4 w-4 text-primary" />
          <span className="hidden text-xs font-medium uppercase tracking-wider sm:inline">
            {current.label}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56 border-white/10 bg-card text-white"
      >
        <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wider text-white/50">
          Performance
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/10" />
        {STEPS.map((step) => {
          const isActive = step.level === active;
          const Icon = step.Icon;
          return (
            <DropdownMenuItem
              key={step.level}
              onClick={() => setPerformanceLevel(step.level)}
              className="cursor-pointer focus:bg-white/10"
            >
              <Icon
                className={`mr-2 h-4 w-4 ${
                  isActive ? "text-primary" : "text-white/60"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight">{step.label}</p>
                <p className="text-xs text-white/50 leading-tight mt-0.5">
                  {step.hint}
                </p>
              </div>
              {isActive && <Check className="ml-2 h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
