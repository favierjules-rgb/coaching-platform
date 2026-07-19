import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { Logo } from "@/components/ui/Logo";

export function AccessDenied() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-12 text-center">
      <Logo />

      <div className="w-full max-w-md border border-border bg-card p-8">
        <ShieldAlert size={28} className="mx-auto mb-4 text-primary" />
        <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">
          Accès refusé
        </h1>
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
          Tu n&apos;as pas accès à cette section.
        </p>

        <div className="flex flex-col gap-2">
          <Link
            href="/dashboard"
            className="border border-primary bg-primary px-4 py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Retour au dashboard
          </Link>
          <SignOutButton className="flex items-center justify-center gap-2 border border-border px-4 py-3 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary" />
        </div>
      </div>
    </div>
  );
}
