const ACTIVE_STATUSES = new Set(["actif"]);

export function StatusBadge({ status }: { status: string }) {
  const isActive = ACTIVE_STATUSES.has(status);

  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest ${
        isActive
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border text-muted-foreground"
      }`}
    >
      {status}
    </span>
  );
}
