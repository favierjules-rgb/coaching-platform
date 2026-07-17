"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
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

const typeFilters: { value: TypeFilter; label: string }[] = [
  { value: "tous", label: "Tous types" },
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
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleResend}
        disabled={resending}
        className="flex items-center gap-1.5 border border-primary px-3 py-1.5 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RefreshCw size={13} aria-hidden="true" />
        {resending ? "Renvoi…" : "Renvoyer"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

function EmailLogRow({ log, onResent }: { log: EmailLog; onResent: () => void }) {
  return (
    <div className="flex flex-col gap-4 border border-border bg-card p-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Destinataire</span>
          <span className="block text-sm text-foreground">{log.recipientEmail}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Type</span>
          <span className="block text-sm text-foreground">{emailTypeLabels[log.emailType] ?? log.emailType}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Sujet</span>
          <span className="block text-sm text-foreground">{log.subject}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Statut</span>
          <span className="mt-1 block">
            <StatusBadge label={emailStatusLabels[log.status] ?? log.status} tone={emailStatusTone[log.status] ?? "muted"} />
          </span>
          {log.errorMessage && <span className="mt-1 block text-xs text-red-400">{log.errorMessage}</span>}
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Date</span>
          <span className="block text-sm text-foreground">{formatDateTime(log.sentAt ?? log.createdAt)}</span>
        </div>
      </div>
      {log.status === "failed" && (
        <div className="flex-shrink-0">
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
        <div className="border border-border bg-card p-4">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Envoyés</span>
          <span className="font-heading text-2xl font-bold text-foreground">{sentCount}</span>
        </div>
        <div className="border border-border bg-card p-4">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Échecs</span>
          <span className="font-heading text-2xl font-bold text-foreground">{failedCount}</span>
        </div>
        <div className="border border-border bg-card p-4">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Ignorés</span>
          <span className="font-heading text-2xl font-bold text-foreground">{skippedCount}</span>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher par destinataire ou sujet..." />
        <FilterButtons options={statusFilters} active={statusFilter} onChange={setStatusFilter} />
        <FilterButtons options={typeFilters} active={typeFilter} onChange={setTypeFilter} />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun email ne correspond à ces filtres.</p>
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
