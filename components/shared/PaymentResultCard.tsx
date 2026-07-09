import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/ui/Logo";

interface PaymentResultCardProps {
  icon: LucideIcon;
  iconTone?: "primary" | "amber";
  title: string;
  message: string;
  children: ReactNode;
}

/** Coquille visuelle partagée /paiement/success et /paiement/cancel — mêmes styles que components/auth/AccessDenied.tsx. */
export function PaymentResultCard({ icon: Icon, iconTone = "primary", title, message, children }: PaymentResultCardProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-12 text-center">
      <Logo />

      <div className="w-full max-w-md border border-border bg-card p-8">
        <Icon size={28} className={`mx-auto mb-4 ${iconTone === "amber" ? "text-amber-400" : "text-primary"}`} aria-hidden="true" />
        <h1 className="mb-2 font-heading text-2xl font-extrabold uppercase text-foreground">{title}</h1>
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}
