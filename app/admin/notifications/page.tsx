"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";

import { NotificationCampaignList } from "@/components/admin/NotificationCampaignList";
import { NotificationComposer } from "@/components/admin/NotificationComposer";
import { NotificationTestButton } from "@/components/admin/NotificationTestButton";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { Loader } from "@/components/ui/Loader";

/**
 * LE CENTRE DE NOTIFICATIONS.
 *
 * Le tableau de bord garde un bloc court — écrire un rappel et l'envoyer.
 * Tout ce qui demande de la place vit ici : programmation, répétitions, ce
 * qui est à venir, et ce qui est déjà parti.
 */
export default function AdminNotificationsPage() {
  const { state } = useAdminData();
  /*
   * ⚠️ LA SOURCE DÉPEND DE LA CONFIGURATION, PLUS DU NOMBRE DE LIGNES. Cette
   * liste remplit le SÉLECTEUR DE DESTINATAIRES du compositeur : pendant la
   * requête initiale, elle offrait les 7 élèves `@mail.mock` de
   * `data/admin.ts`. Choisir l'un d'eux et envoyer visait un identifiant qui
   * n'existe pas en base — un envoi dans le vide, à l'endroit précis où un
   * clic part vers de vraies personnes.
   *
   * Le repli mock survit pour le seul cas où il a un sens : Supabase non
   * configuré.
   */
  const supabaseActive = isSupabaseConfigured();
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseActive ? supabaseStudents.students : state.students;
  const [rafraichir, setRafraichir] = useState(0);

  /*
   * ⚠️ AUCUN DESTINATAIRE N'EST PROPOSÉ AVANT D'ÊTRE RÉEL. La garde est APRÈS
   * tous les hooks (règle des hooks).
   */
  if (supabaseActive && supabaseStudents.loading) {
    return <Loader libelle="Chargement des élèves…" variante="ligne" />;
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="flex items-center gap-3 font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          <BellRing size={26} className="text-primary" aria-hidden="true" />
          Notifications
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rappels poussés sur les appareils des élèves qui les ont activés.
        </p>
      </div>

      <div className="mb-8 rounded-card border border-border bg-card p-6 shadow-soft">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Nouvelle notification
        </h2>
        <NotificationComposer students={students} onEnvoyee={() => setRafraichir((n) => n + 1)} />
      </div>

      <div className="mb-8 rounded-card border border-border bg-card p-6 shadow-soft">
        <NotificationCampaignList rafraichir={rafraichir} />
      </div>

      <div className="mb-8">
        <NotificationTestButton students={students} />
      </div>
    </div>
  );
}
