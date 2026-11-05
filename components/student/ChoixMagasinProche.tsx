"use client";

import { useCallback, useEffect, useState } from "react";

import { RechercheDeCommerces } from "@/components/student/RechercheDeCommerces";
import { cleIdentiteOsm, type MagasinOsm } from "@/lib/nutrition/magasins-osm";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { lireMagasinChoisi, type MagasinChoisi } from "@/lib/supabase/magasins";

/**
 * COURSES C4.3a — « TROUVER UN MAGASIN PRÈS DE MOI ».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE COMPOSANT NE FAIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Il ne connaît ni Open Prices, ni son URL, ni son contrat, ni ses paramètres.
 * Il envoie une position à NOTRE route et reçoit une liste déjà filtrée. Un
 * appel direct depuis le navigateur enverrait la position de l'élève à un
 * tiers, avec son adresse IP, hors de toute borne et de toute limite de débit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LA POSITION VIT EN MÉMOIRE, LE TEMPS D'UN APPEL
 * ────────────────────────────────────────────────────────────────────────────
 * Elle n'est écrite dans AUCUN état React durable, aucun `localStorage`, aucun
 * `sessionStorage`, aucun cookie, aucune URL. Elle est lue, postée, et perdue.
 * Ce qui reste, c'est le magasin choisi — l'adresse d'un commerce, pas celle de
 * quelqu'un.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX GESTES AVANT LA PERMISSION, COMME LE SCANNER A4
 * ────────────────────────────────────────────────────────────────────────────
 * Ouvrir cet écran ne demande RIEN. La permission de géolocalisation n'est
 * demandée qu'au tap sur le bouton — même doctrine, même raison : un écran qui
 * réclame une autorisation à l'ouverture est un écran qu'on refuse par réflexe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ REPLIÉ PAR DÉFAUT — LE DÉFAUT PREVIEW QUE CELA CORRIGE
 * ────────────────────────────────────────────────────────────────────────────
 * Ce composant occupait le HAUT de l'écran Courses, avant même « RETOUR » et
 * « MA LISTE DE COURSES » : un bouton de géolocalisation, un champ ville et un
 * bouton de recherche accueillaient l'élève venu consulter sa liste. Trois
 * commandes permanentes pour un geste qu'on fait une fois par mois.
 *
 * Il est désormais monté DANS la zone PRIX OBSERVÉS — le seul endroit du
 * produit où le magasin a une conséquence — et n'y montre qu'une ligne :
 * le magasin choisi, et un bouton pour en changer. Les commandes complètes
 * n'apparaissent qu'après ce geste.
 *
 * ⚠️ ET LE REPLI MANUEL RESTE OFFERT D'EMBLÉE DANS LE PANNEAU. Le cacher
 * derrière un échec de géolocalisation ferait de celle-ci un passage obligé —
 * c'est la doctrine de C4.3b, et le panneau ne la change pas.
 */

/*
 * ⚠️ L'UNION DE TREIZE ÉTATS A QUITTÉ CE FICHIER, et avec elle le délai de
 * géolocalisation et les deux fonctions de recherche. Elles vivent dans
 * `lib/nutrition/recherche-commerces.ts` et `RechercheDeCommerces` : le mode et
 * la situation y sont deux questions séparées, et un chargement permanent y est
 * impossible par construction plutôt que par vigilance.
 *
 * Ce qui reste ici : la ligne repliée, et l'ÉCRITURE du choix.
 */

export function ChoixMagasinProche({
  studentId,
  onMagasinChoisi,
}: {
  /** `null` tant que l'identité de l'élève n'est pas connue : on n'affiche rien. */
  studentId: string | null;
  onMagasinChoisi?: (magasin: { storeId: string; name: string }) => void;
}) {
  /**
   * ⚠️ FERMÉ AU DÉPART, ET FERMÉ APRÈS UN CHOIX. Un panneau qui resterait
   * ouvert après la sélection laisserait l'élève devant une liste de magasins
   * qu'il vient justement de quitter.
   */
  const [panneauOuvert, setPanneauOuvert] = useState(false);
  const [choixEnCours, setChoixEnCours] = useState<string | null>(null);
  const [echecDEcriture, setEchecDEcriture] = useState(false);
  const [choisi, setChoisi] = useState<MagasinChoisi | null>(null);
  /**
   * ⚠️ CETTE LECTURE NE DEMANDE AUCUNE PERMISSION. Elle lit le magasin déjà
   * choisi, sous la RLS de l'élève, avec la MÊME fonction que la route serveur
   * — `lireMagasinChoisi` de C4.3a. Rien n'est redéclaré ici, et surtout aucune
   * géolocalisation n'est déclenchée au montage : c'est le bouton qui décide.
   */
  useEffect(() => {
    if (studentId === null) return;
    let vivant = true;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    void lireMagasinChoisi(supabase, studentId).then((magasin) => {
      if (vivant) setChoisi(magasin);
    });
    return () => {
      vivant = false;
    };
  }, [studentId]);

  const choisir = useCallback(
    async (magasin: MagasinOsm) => {
      setChoixEnCours(cleIdentiteOsm(magasin));
      try {
        // ⚠️ UNE IDENTITÉ, ET RIEN D'AUTRE. Envoyer le nom, la marque ou les
        // coordonnées ferait du navigateur la source de vérité d'un catalogue
        // partagé : le serveur relit la fiche chez OpenStreetMap lui-même.
        //
        // ⚠️ ET SURTOUT PAS `opLocationId`. Le pont Open Prices est établi côté
        // serveur, par un appel exact ; le laisser partir d'ici permettrait de
        // rattacher son magasin aux prix d'un autre.
        const réponse = await fetch("/api/student/stores/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ osmType: magasin.osmType, osmId: magasin.osmId }),
        });
        if (!réponse.ok) {
          // ⚠️ L'ÉCHEC D'ÉCRITURE SE VOIT ICI, et pas dans l'écran de
          // recherche : c'est CE composant qui écrit, c'est donc lui qui
          // répond de son échec. Le taire laisserait l'élève croire que son
          // magasin est enregistré.
          setEchecDEcriture(true);
          return;
        }
        setEchecDEcriture(false);
        const données = (await réponse.json()) as {
          magasin?: { storeId: string; name: string; brand: string | null; city: string | null };
        };
        if (données.magasin) {
          setChoisi({ ...données.magasin, brand: données.magasin.brand ?? null });
          setPanneauOuvert(false);
          // ⚠️ LE CALLBACK EST APPELÉ EN DERNIER, ET IL COMPTE. C'est lui qui
          // fait relire les prix observés du NOUVEAU magasin : sans lui,
          // l'écran continuerait d'afficher les relevés de l'ancien.
          onMagasinChoisi?.({ storeId: données.magasin.storeId, name: données.magasin.name });
        }
      } finally {
        setChoixEnCours(null);
      }
    },
    [onMagasinChoisi],
  );

  return (
    <section aria-label="Magasin" className="flex flex-col gap-3">
      {/* ── LA LIGNE REPLIÉE — CE QUE L'ÉLÈVE VOIT 99 FOIS SUR 100 ───────────
          ⚠️ ELLE DIT TOUJOURS L'ÉTAT, MÊME QUAND IL EST VIDE. « aucun magasin
          choisi » est une information ; ne rien afficher laisserait croire que
          la question ne se pose pas, alors que c'est elle qui commande les
          prix observés juste en dessous. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm text-muted-foreground">
          Magasin&nbsp;:{" "}
          {choisi ? (
            <>
              <strong className="font-semibold text-foreground">{choisi.name}</strong>
              {choisi.city ? ` — ${choisi.city}` : ""}
            </>
          ) : (
            <span>aucun magasin choisi</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setPanneauOuvert((ouvert) => !ouvert)}
          aria-expanded={panneauOuvert}
          className="pressable min-h-[44px] rounded-control border border-border px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-info hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50"
        >
          {panneauOuvert ? "Fermer" : choisi ? "Changer" : "Choisir un magasin"}
        </button>
      </div>

      {echecDEcriture && (
        <p
          role="alert"
          className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Le magasin n&apos;a pas pu être enregistré. Réessaie dans un instant.
        </p>
      )}

      {/* ── LE PANNEAU — OUVERT SUR GESTE, ET SUR GESTE SEULEMENT ──────────── */}
      {panneauOuvert && (
        <div className="border-t border-border pt-3">
          {/*
            ⚠️ TOUT LE CONTENU DU PANNEAU A ÉTÉ DÉPLACÉ DANS
            `RechercheDeCommerces`, ET CE N'EST PAS UN SIMPLE RANGEMENT.

            Ce composant portait treize états dans une seule union — mode et
            situation mêlés — un champ ville sans suggestion, aucun réglage de
            rayon, et une liste sans carte. Les deux modes de recherche, leurs
            états visuels distincts, l'anti-rafale, le rayon et la carte vivent
            maintenant dans un composant qui ne fait que cela.

            ⚠️ CE QUI RESTE ICI EST CE QUI DOIT Y RESTER : la LIGNE REPLIÉE
            (« Magasin : … »), parce qu'elle appartient à la zone PRIX OBSERVÉS
            où le magasin a une conséquence, et l'ÉCRITURE du choix, parce
            qu'elle passe par `/select` qui relit la fiche chez la source. La
            recherche ne choisit pas, elle propose.
          */}
          <RechercheDeCommerces onChoisir={(magasin) => void choisir(magasin)} choixEnCours={choixEnCours} />
        </div>
      )}
    </section>
  );
}
