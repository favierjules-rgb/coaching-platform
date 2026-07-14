"use client";

import { useMemo, useState } from "react";
import type { NewsletterSubscriberRow } from "@/lib/newsletter/db";

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  subscribed: "Abonné",
  unsubscribed: "Désabonné",
  bounced: "Rejeté (bounce)",
  complained: "Plainte spam",
  sync_failed: "Échec de synchro",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

function toCsvValue(value: string | null): string {
  const safe = (value ?? "").replace(/"/g, '""');
  return `"${safe}"`;
}

export function NewsletterAdminTable({
  subscribers,
}: {
  subscribers: NewsletterSubscriberRow[];
}) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [resyncingId, setResyncingId] = useState<string | null>(null);
  const [rows, setRows] = useState(subscribers);
  const [error, setError] = useState<string | null>(null);

  const sources = useMemo(
    () => Array.from(new Set(rows.map((row) => row.source))).sort(),
    [rows]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
      return true;
    });
  }, [rows, statusFilter, sourceFilter]);

  async function handleResync(id: string) {
    setResyncingId(id);
    setError(null);
    try {
      const response = await fetch("/api/admin/newsletter/resync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        subscriber?: NewsletterSubscriberRow;
        error?: string;
      };
      if (!response.ok || !data.subscriber) {
        setError(data.error ?? "Échec de la resynchronisation.");
        return;
      }
      const updated = data.subscriber;
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } catch {
      setError("Erreur réseau lors de la resynchronisation.");
    } finally {
      setResyncingId(null);
    }
  }

  function handleExportCsv() {
    const header = [
      "email",
      "status",
      "source",
      "consent_at",
      "confirmed_at",
      "unsubscribed_at",
      "last_sync_status",
    ];
    const lines = [
      header.join(","),
      ...filteredRows.map((row) =>
        [
          toCsvValue(row.email),
          toCsvValue(row.status),
          toCsvValue(row.source),
          toCsvValue(row.consent_at),
          toCsvValue(row.confirmed_at),
          toCsvValue(row.unsubscribed_at),
          toCsvValue(row.last_sync_status),
        ].join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `newsletter-abonnes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          Statut
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="all">Tous</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-foreground">
          Source
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            className="border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="all">Toutes</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleExportCsv}
          className="ml-auto border border-border px-3 py-1.5 text-sm font-bold uppercase text-foreground transition hover:bg-foreground hover:text-background"
        >
          Exporter en CSV
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto border border-border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border bg-card">
            <tr>
              <th className="px-3 py-2 font-bold uppercase">Email</th>
              <th className="px-3 py-2 font-bold uppercase">Statut</th>
              <th className="px-3 py-2 font-bold uppercase">Source</th>
              <th className="px-3 py-2 font-bold uppercase">Consentement</th>
              <th className="px-3 py-2 font-bold uppercase">Confirmation</th>
              <th className="px-3 py-2 font-bold uppercase">Désinscription</th>
              <th className="px-3 py-2 font-bold uppercase">Synchro Brevo</th>
              <th className="px-3 py-2 font-bold uppercase">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Aucun abonné pour ces filtres.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2">{row.email}</td>
                  <td className="px-3 py-2">{STATUS_LABELS[row.status] ?? row.status}</td>
                  <td className="px-3 py-2">{row.source}</td>
                  <td className="px-3 py-2">{formatDate(row.consent_at)}</td>
                  <td className="px-3 py-2">{formatDate(row.confirmed_at)}</td>
                  <td className="px-3 py-2">{formatDate(row.unsubscribed_at)}</td>
                  <td className="px-3 py-2">{row.last_sync_status ?? "—"}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleResync(row.id)}
                      disabled={resyncingId === row.id}
                      className="border border-border px-2 py-1 text-xs font-bold uppercase text-foreground transition hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resyncingId === row.id ? "…" : "Resync"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
