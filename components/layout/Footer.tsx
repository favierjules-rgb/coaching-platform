import { Logo } from "@/components/ui/Logo";

export function Footer() {
  return (
    <footer className="border-t border-border bg-black py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 md:flex-row md:items-center">
        <Logo />
        <p className="text-xs text-muted-foreground">
          © 2026 Seth Préparation Physique — Tous droits réservés
        </p>
      </div>
    </footer>
  );
}
