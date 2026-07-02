import type { ReactNode } from "react";

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline gap-4">
      <span className="font-heading text-xs font-semibold uppercase tracking-[0.3em] text-primary">
        {children}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
