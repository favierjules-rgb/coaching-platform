"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Apple,
  Dumbbell,
  FileText,
  LayoutDashboard,
  LogOut,
  User,
  X,
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";

const studentLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/entrainement", label: "Entraînement", icon: Dumbbell },
  { href: "/nutrition", label: "Nutrition", icon: Apple },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/profil", label: "Profil", icon: User },
];

interface StudentSidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

export function StudentSidebar({
  mobile = false,
  onNavigate,
}: StudentSidebarProps) {
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

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {studentLinks.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <LogOut size={18} />
          Déconnexion
        </Link>
      </div>
    </div>
  );
}
