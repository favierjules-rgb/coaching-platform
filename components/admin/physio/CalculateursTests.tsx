"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { Field } from "@/components/admin/AdminFormFields";
import {
  allureSecondesPar100m,
  allureSecondesParKm,
  formatMinutesSecondes,
  formatMinutesSecondesLarge,
  formatVitesse,
  secondesDepuisMinutesSecondes,
  vitesseDepuisTest400m,
  vmaDepuisTest6Minutes,
} from "@/lib/physiologie";
import type { EcriturePhysiologie } from "@/lib/supabase/physiologie";

/**
 * LES TESTS TERRAIN — course 6 min, natation 400 m, natation 6 min.
 *
 * ⚠️ AUCUN COEFFICIENT CORRECTEUR. La VMA d'un test de 6 minutes vaut
 * `distance × 0,01` ; la vitesse d'un 400 m vaut `1440 / temps`. Ce sont les
 * deux formules du modèle de référence, et il n'y a rien d'autre : ni
 * pondération d'âge, ni facteur de fatigue, ni correction de bassin.
 *
 * ⚠️ LE CALCUL NE S'ENREGISTRE PAS TOUT SEUL. Un test peut être raté, saisi à
 * tort, ou servir de simulation : écraser la VMA de référence à la volée
 * remplacerait une donnée validée par un brouillon. Le coach clique.
 *
 * ⚠️ QUAND IL ENREGISTRE, LA TRACE SUIT. `last_fitness_test_date` et
 * `fitness_test_protocol` existent depuis juillet 2026 et n'étaient jamais
 * écrites : elles portent désormais la date et le protocole, plutôt qu'une
 * nouvelle table inventée pour l'occasion.
 */

interface ResultatTest {
  readonly vitesseKmh: number;
  readonly libelleVitesse: string;
  readonly libelleAllure: string;
}

function resultatCourse(distanceMetres: number): ResultatTest | null {
  const vitesse = vmaDepuisTest6Minutes(distanceMetres);
  if (vitesse === null) return null;
  return {
    vitesseKmh: vitesse,
    libelleVitesse: `${formatVitesse(vitesse)} km/h`,
    libelleAllure: `${formatMinutesSecondes(allureSecondesParKm(vitesse))} /km`,
  };
}

function resultatNatation(vitesse: number | null): ResultatTest | null {
  if (vitesse === null) return null;
  return {
    vitesseKmh: vitesse,
    libelleVitesse: `${formatVitesse(vitesse)} km/h`,
    libelleAllure: `${formatMinutesSecondesLarge(allureSecondesPar100m(vitesse))} /100 m`,
  };
}

function CarteTest({
  titre,
  detail,
  children,
}: {
  readonly titre: string;
  readonly detail: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-soft/40 p-4">
      <div>
        <h5 className="text-xs font-bold uppercase tracking-widest text-foreground">{titre}</h5>
        <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
      </div>
      {children}
    </div>
  );
}

function Resultat({
  resultat,
  colonne,
  protocole,
  onEnregistrer,
}: {
  readonly resultat: ResultatTest | null;
  readonly colonne: string;
  readonly protocole: string;
  readonly onEnregistrer: (ecriture: EcriturePhysiologie) => Promise<{ ok: boolean; erreur: string | null }>;
}) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState(false);

  const valide = resultat;
  if (!valide) {
    return <p className="text-[11px] text-muted-foreground/70">Saisis une valeur valide pour voir le résultat.</p>;
  }

  const enregistrer = async () => {
    setEnCours(true);
    setErreur(null);
    const reponse = await onEnregistrer({
      colonnes: {
        [colonne]: valide.vitesseKmh,
        // Trace du test : colonnes existantes, aucune table nouvelle.
        last_fitness_test_date: new Date().toISOString().slice(0, 10),
        fitness_test_protocol: protocole,
      },
      sources: { [colonne]: "mesuree" },
    });
    setEnCours(false);
    if (!reponse.ok) {
      setErreur(reponse.erreur ?? "L'enregistrement a échoué.");
      return;
    }
    setEnregistre(true);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm tabular-nums text-foreground">
        {valide.libelleVitesse} <span className="text-muted-foreground">— {valide.libelleAllure}</span>
      </p>
      <button
        type="button"
        onClick={() => void enregistrer()}
        disabled={enCours}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
      >
        {enCours ? <Loader2 size={13} className="animate-spin" /> : enregistre ? <Check size={13} /> : null}
        {enregistre ? "Enregistré" : "Enregistrer comme référence"}
      </button>
      {erreur && (
        <p className="flex items-start gap-2 text-[11px] text-red-400">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {erreur}
        </p>
      )}
    </div>
  );
}

export function CalculateursTests({
  sport,
  onEnregistrer,
}: {
  readonly sport: "course" | "natation";
  readonly onEnregistrer: (ecriture: EcriturePhysiologie) => Promise<{ ok: boolean; erreur: string | null }>;
}) {
  const [distance6min, setDistance6min] = useState("");
  const [temps400, setTemps400] = useState("");

  const distance = Number(distance6min.replace(",", "."));
  const test6min = Number.isFinite(distance) && distance > 0 ? distance : null;
  const secondes400 = secondesDepuisMinutesSecondes(temps400);

  if (sport === "course") {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CarteTest titre="Test 6 minutes" detail="Distance parcourue en 6 minutes → VMA = distance × 0,01.">
          <Field
            label="Distance (m)"
            value={distance6min}
            onChange={setDistance6min}
            placeholder="ex : 1400"
          />
          <Resultat
            resultat={test6min === null ? null : resultatCourse(test6min)}
            colonne="vma_kmh"
            protocole="Test 6 minutes (course)"
            onEnregistrer={onEnregistrer}
          />
        </CarteTest>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <CarteTest titre="Test 400 m" detail="Temps sur 400 m → vitesse = 1440 / temps en secondes. Aucun coefficient.">
        <Field label="Temps (mm:ss)" value={temps400} onChange={setTemps400} placeholder="ex : 6:00" />
        <Resultat
          resultat={secondes400 === null ? null : resultatNatation(vitesseDepuisTest400m(secondes400))}
          colonne="vma_swim_kmh"
          protocole="Test 400 m (natation)"
          onEnregistrer={onEnregistrer}
        />
      </CarteTest>
      <CarteTest titre="Test 6 minutes" detail="Distance parcourue en 6 minutes → vitesse = distance × 0,01.">
        <Field label="Distance (m)" value={distance6min} onChange={setDistance6min} placeholder="ex : 400" />
        <Resultat
          resultat={test6min === null ? null : resultatNatation(vmaDepuisTest6Minutes(test6min))}
          colonne="vma_swim_kmh"
          protocole="Test 6 minutes (natation)"
          onEnregistrer={onEnregistrer}
        />
      </CarteTest>
    </div>
  );
}
