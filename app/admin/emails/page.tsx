"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, MailX, RefreshCw, SkipForward } from "lucide-react";

import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatCard } from "@/components/admin/StatCard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatDateTime, matchesTextSearch } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getEmailLogs } from "@/lib/supabase/email-logs";
import type { EmailLog, EmailStatus, EmailType } from "@/types";

const emailTypeLabels: Record<EmailType, string> = {
  welcome: "Bienvenue",
  subscription_assigned: "Abonnement attribué",
  payment_succeeded: "Paiement réussi",
  payment_failed: "Paiement échoué",
  subscription_cancelled: "Abonnement annulé",
  program_assigned: "Programme attribué",
  nutrition_assigned: "Nutrition attribuée",
  document_assigned: "Document attribué",
  appointment_created: "Rendez-vous créé",
  appointment_cancelled: "Rendez-vous annulé",
  appointment_reminder: "Rappel de rendez-vous",
  password_reset: "Mot de passe oublié",
  account_expiry_warning: "Fin d'accès (avertissement)",
  coach_invite: "Invitation élève (coach)",
  collaborator_invite: "Invitation collaborateur (admin)",
  order_confirmation: "Confirmation de commande",
};

const emailStatusLabels: Record<EmailStatus, string> = {
  pending: "En cours",
  sent: "Envoyé",
  failed: "Échec",
  skipped: "Ignoré",
};

const emailStatusTone: Record<EmailStatus, "green" | "amber" | "muted" | "red" | "primary"> = {
  pending: "amber",
  sent: "green",
  failed: "red",
  skipped: "muted",
};

type StatusFilter = "tous" | EmailStatus;
type TypeFilter = "tous" | EmailType;

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "sent", label: "Envoyés" },
  { value: "failed", label: "Échecs" },
  { value: "skipped", label: "Ignorés" },
  { value: "pending", label: "En cours" },
];

// 16 types d'email : un select tokenisé (même langage que les filtres de
// /admin/documents) reste lisible là où 17 pastilles satureraient la ligne,
// surtout en mobile.
const typeFilterOptions: { value: TypeFilter; label: string }[] = [
  { value: "tous", label: "Tous les types" },
  ...(Object.keys(emailTypeLabels) as EmailType[]).map((value) => ({ value, label: emailTypeLabels[value] })),
];

function ResendButton({ logId, onResent }: { logId: string; onResent: () => void }) {
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    setResending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/emails/${logId}/resend`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Échec du renvoi.");
        setResending(false);
        return;
      }
      onResent();
    } catch {
      setError("Échec du renvoi.");
      setResending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 lg:items-end">
      <button
        type="button"
        onClick={handleResend}
        disabled={resending}
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RefreshCw size={13} aria-hidden="true" />
        {resending ? "Renvoi…" : "Renvoyer"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

function EmailLogRow({ log, onResent }: { log: EmailLog; onResent: () => void }) {
  // Passage multi-colonnes seulement à partir de xl (leçon de l'audit
  // 1024-1440 : avec la sidebar de 240 px, une grille 5 colonnes dès lg:
  // provoque des chevauchements). Chaque cellule est min-w-0 et les textes
  // longs (email, sujet) cassent proprement.
  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-6 shadow-soft transition-colors hover:border-border-strong xl:flex-row xl:items-center xl:justify-between">
      <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="min-w-0">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Destinataire</span>
          <span className="block break-words text-sm text-foreground">{log.recipientEmail}</span>
        </div>
        <div className="min-w-0">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Type</span>
          <span className="block text-sm text-foreground">{emailTypeLabels[log.emailType] ?? log.emailType}</span>
        </div>
        <div className="min-w-0">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Sujet</span>
          <span className="block break-words text-sm text-foreground">{log.subject}</span>
        </div>
        <div className="min-w-0">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Statut</span>
          <span className="mt-1 block">
            <StatusBadge label={emailStatusLabels[log.status] ?? log.status} tone={emailStatusTone[log.status] ?? "muted"} />
          </span>
          {log.errorMessage && (
            <span className="mt-1 block break-words text-xs text-destructive">{log.errorMessage}</span>
          )}
        </div>
        <div className="min-w-0">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Date</span>
          <span className="block text-sm text-foreground">{formatDateTime(log.sentAt ?? log.createdAt)}</span>
        </div>
      </div>
      {log.status === "failed" && (
        <div className="flex-none">
          <ResendButton logId={log.id} onResent={onResent} />
        </div>
      )}
    </div>
  );
}

export default function AdminEmailsPage() {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("tous");

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setLogs([]);
      setLoading(false);
      return;
    }
    const result = await getEmailLogs(supabase);
    setLogs(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      setLoading(true);
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setLogs([]);
          setLoading(false);
        }
        return;
      }
      const result = await getEmailLogs(supabase);
      if (!cancelled) {
        setLogs(result);
        setLoading(false);
      }
    }
    initialLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = logs.filter(
    (log) =>
      matchesTextSearch([log.recipientEmail, log.subject], query) &&
      (statusFilter === "tous" || log.status === statusFilter) &&
      (typeFilter === "tous" || log.emailType === typeFilter),
  );

  const sentCount = logs.filter((log) => log.status === "sent").length;
  const failedCount = logs.filter((log) => log.status === "failed").length;
  const skippedCount = logs.filter((log) => log.status === "skipped").length;

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">Emails</h1>
        <p className="mt-1 text-sm text-muted-foreground">Journal des emails transactionnels envoyés (Resend).</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={CheckCircle2} label="Envoyés" value={sentCount} tone="primary" />
        <StatCard icon={MailX} label="Échecs" value={failedCount} tone={failedCount > 0 ? "amber" : "default"} />
        <StatCard icon={SkipForward} label="Ignorés" value={skippedCount} />
      </div>

      <div className="mb-6 flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher par destinataire ou sujet..." />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <FilterButtons options={statusFilters} active={statusFilter} onChange={setStatusFilter} />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            aria-label="Filtrer par type d'email"
            className="min-h-[44px] max-w-full rounded-control border border-border bg-surface-soft px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {typeFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Chargement…
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-card border border-border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {logs.length === 0 ? "Aucun email envoyé pour le moment." : "Aucun email ne correspond à ces filtres."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((log) => (
            <EmailLogRow key={log.id} log={log} onResent={load} />
          ))}
        </div>
      )}
    </div>
  );
}
