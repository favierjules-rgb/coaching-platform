import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-baseline gap-2">
      <span className="font-heading text-xl font-extrabold italic tracking-wide text-foreground">
        SETH
      </span>
      <span className="hidden text-[11px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
        Préparation Physique
      </span>
    </Link>
  );
}
