export interface ChannelStyle {
  bg: string;
  border: string;
  text: string;
  dot: string;
  hex: string;
}

export const DEFAULT_CHANNEL_STYLE: ChannelStyle = {
  bg: "bg-brand-500/10",
  border: "border-brand-500/20",
  text: "text-brand-600",
  dot: "bg-brand-500",
  hex: "#6366f1",
};

export const CHANNEL_COLORS: Record<string, ChannelStyle> = {
  "Pop Up":        { bg: "bg-blue-500/15",    border: "border-blue-500/30",    text: "text-blue-600",    dot: "bg-blue-500",    hex: "#3b82f6" },
  XPanel:          { bg: "bg-purple-500/15",  border: "border-purple-500/30",  text: "text-purple-600",  dot: "bg-purple-500",  hex: "#a855f7" },
  Whatsapp:        { bg: "bg-emerald-500/15", border: "border-emerald-500/30", text: "text-emerald-600", dot: "bg-emerald-500", hex: "#10b981" },
  "Push in/out":   { bg: "bg-amber-400/15",   border: "border-amber-400/30",   text: "text-amber-600",   dot: "bg-amber-400",   hex: "#fbbf24" },
  "Push in":       { bg: "bg-amber-400/15",   border: "border-amber-400/30",   text: "text-amber-600",   dot: "bg-amber-400",   hex: "#fbbf24" },
  "Push out":      { bg: "bg-amber-400/15",   border: "border-amber-400/30",   text: "text-amber-600",   dot: "bg-amber-400",   hex: "#fbbf24" },
  Email:           { bg: "bg-pink-500/15",    border: "border-pink-500/30",    text: "text-pink-600",    dot: "bg-pink-500",    hex: "#ec4899" },
  SMS:             { bg: "bg-slate-100",      border: "border-slate-200",      text: "text-slate-600",   dot: "bg-slate-400",   hex: "#94a3b8" },
};

export function getChannelColor(actionKey: string): ChannelStyle {
  return CHANNEL_COLORS[actionKey] ?? DEFAULT_CHANNEL_STYLE;
}
