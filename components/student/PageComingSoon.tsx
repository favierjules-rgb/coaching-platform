import type { LucideIcon } from "lucide-react";

interface PageComingSoonProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function PageComingSoon({
  icon: Icon,
  title,
  description,
}: PageComingSoonProps) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          {title}
        </h1>
      </div>
      <div className="flex flex-col items-start gap-4 border border-border bg-card p-10">
        <Icon size={28} className="text-primary" />
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <span className="font-heading text-xs uppercase tracking-[0.3em] text-primary">
          Bientôt disponible
        </span>
      </div>
    </div>
  );
}
