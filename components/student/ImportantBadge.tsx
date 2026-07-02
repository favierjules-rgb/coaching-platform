import { Star } from "lucide-react";

export function ImportantBadge() {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary">
      <Star size={11} className="fill-primary" />
      Important
    </span>
  );
}
