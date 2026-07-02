import type { DocumentStatus } from "@/types";

const statusStyles: Record<DocumentStatus, string> = {
  nouveau: "border-primary/40 bg-primary/10 text-primary",
  "consulté": "border-border text-muted-foreground",
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap border px-2.5 py-1 text-[10px] uppercase tracking-widest ${statusStyles[status]}`}
    >
      {status}
    </span>
  );
}
