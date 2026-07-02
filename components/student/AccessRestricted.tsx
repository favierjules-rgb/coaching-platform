import Link from "next/link";
import { Lock } from "lucide-react";

export function AccessRestricted() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <Lock size={32} className="text-primary" />
      <h1 className="font-heading text-2xl font-bold uppercase text-foreground">
        Espace réservé
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Cette section est réservée aux élèves connectés. Contacte ton coach
        pour obtenir un accès.
      </p>
      <Link
        href="/"
        className="mt-2 border border-primary px-6 py-3 text-sm uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
      >
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}
