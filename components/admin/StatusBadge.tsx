type Tone = "green" | "amber" | "muted" | "red" | "primary";

const toneClass: Record<Tone, string> = {
  green: "border-success/50 text-success",
  amber: "border-warning/50 text-warning",
  muted: "border-border text-muted-foreground",
  red: "border-destructive/50 text-destructive",
  primary: "border-primary text-primary",
};

export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-widest ${toneClass[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function studentStatusTone(status: string): Tone {
  if (status === "actif") return "green";
  if (status === "pause") return "amber";
  return "muted";
}

export function contentStatusTone(status: string): Tone {
  if (status === "actif" || status === "publié") return "green";
  if (status === "brouillon") return "amber";
  return "muted";
}

export function feedbackStatusTone(status: string): Tone {
  if (status === "important") return "red";
  if (status === "traité") return "green";
  return "amber";
}
