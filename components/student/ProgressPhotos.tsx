import { Camera } from "lucide-react";

const slots = [
  { label: "Avant", pending: false },
  { label: "Actuelle", pending: false },
  { label: "Après", pending: true },
];

export function ProgressPhotos() {
  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      {slots.map((slot) => (
        <div
          key={slot.label}
          className="flex aspect-[3/4] flex-col items-center justify-center gap-2 border border-border bg-gradient-to-br from-zinc-900 to-black"
        >
          <Camera size={22} className="text-primary" />
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {slot.label}
          </span>
          {slot.pending && (
            <span className="text-[10px] text-muted-foreground">À venir</span>
          )}
        </div>
      ))}
    </div>
  );
}
