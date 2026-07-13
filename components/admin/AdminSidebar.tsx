"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CreditCard,
  Dumbbell,
  FileText,
  LayoutDashboard,
  Library,
  Mail,
  MessageSquare,
  Settings,
  Users,
  Utensils,
  X,
} from "lucide-react";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { Logo } from "@/components/ui/Logo";

const adminLinks = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/eleves", label: "Élèves", icon: Users },
  { href: "/admin/programmes", label: "Programmes", icon: Dumbbell },
  { href: "/admin/exercices", label: "Exercices", icon: Library },
  { href: "/admin/calendrier", label: "Calendrier", icon: CalendarDays },
  { href: "/admin/nutrition", label: "Nutrition", icon: Utensils },
  { href: "/admin/documents", label: "Documents", icon: FileText },
  { href: "/admin/paiements", label: "Paiements", icon: CreditCard },
  { href: "/admin/emails", label: "Emails", icon: Mail },
  { href: "/admin/retours", label: "Retours élèves", icon: MessageSquare },
  { href: "/admin/parametres", label: "Paramètres", icon: Settings },
];

interface AdminSidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

export function AdminSidebar({ mobile = false, onNavigate }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-60 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center justify-between border-b border-border px-6">
        <Logo />
        {mobile && (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Fermer le menu"
            className="text-muted-foreground"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div className="border-b border-border px-6 py-3">
        <span className="text-[11px] uppercase tracking-widest text-primary">Espace admin</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {adminLinks.map(({ href, label, icon: Icon }) => {
          const active = href === "/admin" ? pathname === href : pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-4">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <ArrowLeft size={18} />
          Espace élève
        </Link>
        <SignOutButton
          onBeforeNavigate={onNavigate}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        />
      </div>
    </div>
  );
}
