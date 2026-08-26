"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, History } from "lucide-react";

import { decrireRegle, lireRegle, FUSEAU_PAR_DEFAUT } from "@/lib/notifications/recurrence";
import { Loader } from "@/components/ui/Loader";

/**
 * À VENIR, ET CE QUI EST DÉJÀ PARTI.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'HISTORIQUE NE SE MODIFIE PAS
 * ════════════════════════════════════════════════════════════════════════
 * Pause, modification et annulation portent sur la CAMPAGNE — donc sur ce
 * qui suivra. Aucun bouton de cet écran ne touche une occurrence déjà
 * envoyée : sinon « voici ce que j'ai envoyé lundi » finirait par afficher
 * le texte de mercredi.
 */

interface Campagne {
  id: string;
  titre: string;
  corps: string;
  destination: string;
  genreCible: "all" | "students";
  genreProgrammation: "now" | "once" | "recurring";
  recurrence: unknown;
  prochaineEcheance: string | null;
  active: boolean;
  statut: string;
  studentIds: string[];
}

interface LigneHistorique {
  id: string;
  campaignId: string;
  echeance: string;
  termineeLe: string | null;
  statut: string;
  envoyes: number;
  echoues: number;
  interrompus: number;
}

const TONS: Record<string, string> = {
  envoyee: "text-primary",
  partielle: "text-amber-400",
  echouee: "text-red-400",
  interrompue: "text-amber-400",
  annulee: "text-muted-foreground",
  en_cours: "text-muted-foreground",
  en_attente: "text-muted-foreground",
};

const LIBELLES: Record<string, string> = {
  en_attente: "programmée",
  en_cours: "en cours",
  envoyee: "envoyée",
  partielle: "partielle",
  echouee: "échouée",
  interrompue: "interrompue",
  annulee: "annulée",
};

function dateFr(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: FUSEAU_PAR_DEFAUT, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function quand(c: Campagne): string {
  if (c.genreProgrammation === "recurring") {
    const regle = lireRegle(c.recurrence);
    return regle ? decrireRegle(regle) : "Répétition";
  }
  if (c.genreProgrammation === "once") return `Le ${dateFr(c.prochaineEcheance)}`;
  return "Envoi immédiat";
}

export function NotificationCampaignList({ rafraichir }: { rafraichir: number }) {
  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [historique, setHistorique] = useState<LigneHistorique[]>([]);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async () => {
    try {
      const reponse = await fetch("/api/admin/notifications/campaigns");
      const corps = (await reponse.json()) as { campagnes?: Campagne[]; historique?: LigneHistorique[] };
      setCampagnes(corps.campagnes ?? []);
      setHistorique(corps.historique ?? []);
    } catch {
      setCampagnes([]);
      setHistorique([]);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    let annule = false;
    async function lancer() {
      if (annule) return;
      await charger();
    }
    void lancer();
    return () => {
      annule = true;
    };
  }, [charger, rafraichir]);

  async function agir(id: string, action: "pause" | "reprise" | "supprimer") {
    if (action === "supprimer") {
      await fetch(`/api/admin/notifications/campaigns/${id}`, { method: "DELETE" });
    } else {
      await fetch(`/api/admin/notifications/campaigns/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: action === "reprise" }),
      });
    }
    await charger();
  }

  const aVenir = campagnes.filter((c) => c.statut !== "annulee" && c.genreProgrammation !== "now");
  const bouton =
    "pressable rounded-control border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary";

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-bold uppercase text-foreground">
          <CalendarClock size={18} className="text-primary" aria-hidden="true" />À venir
        </h2>
        {chargement ? (
          <Loader libelle="Chargement…" variante="ligne" />
        ) : aVenir.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune notification programmée.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {aVenir.map((c) => (
              <li key={c.id} className="rounded-control border border-border bg-surface-soft/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{c.titre}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.genreCible === "all"
                        ? "Tous les élèves"
                        : `${c.studentIds.length} élève${c.studentIds.length > 1 ? "s" : ""}`}{" "}
                      · {quand(c)}
                      {c.prochaineEcheance && c.genreProgrammation === "recurring"
                        ? ` · prochaine : ${dateFr(c.prochaineEcheance)}`
                        : ""}
                    </p>
                    <p className={`mt-1 text-[11px] uppercase tracking-widest ${c.active ? "text-primary" : "text-muted-foreground"}`}>
                      {c.active ? "Actif" : "En pause"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={bouton} onClick={() => void agir(c.id, c.active ? "pause" : "reprise")}>
                      {c.active ? "Pause" : "Réactiver"}
                    </button>
                    <button type="button" className={bouton} onClick={() => void agir(c.id, "supprimer")}>
                      Supprimer
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-bold uppercase text-foreground">
          <History size={18} className="text-primary" aria-hidden="true" />
          Historique
        </h2>
        {historique.length === 0 ? (
          <p className="text-sm text-muted-foreground">Rien n&apos;a encore été envoyé.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {historique.map((h) => {
              const c = campagnes.find((x) => x.id === h.campaignId);
              return (
                <li key={h.id} className="rounded-control border border-border bg-surface-soft/40 p-3 text-xs">
                  <p className="text-sm text-foreground">{c?.titre ?? "Notification"}</p>
                  <p className="text-muted-foreground">
                    {c?.genreCible === "all" ? "Tous les élèves" : `${c?.studentIds.length ?? 0} élève(s)`} · prévu{" "}
                    {dateFr(h.echeance)} · envoyé {dateFr(h.termineeLe)}
                  </p>
                  <p className={TONS[h.statut] ?? "text-muted-foreground"}>
                    {LIBELLES[h.statut] ?? h.statut} · {h.envoyes} envoyé(s) / {h.echoues} échec(s)
                    {h.interrompus > 0 ? ` / ${h.interrompus} interrompu(s)` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
