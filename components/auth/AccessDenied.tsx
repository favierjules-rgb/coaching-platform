import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { AuthCardLayout } from "@/components/shared/AuthCardLayout";

export function AccessDenied() {
  return (
    <AuthCardLayout outerClassName="gap-6 text-center" wrapLogo={false}>
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
    </AuthCardLayout>
  );
}
