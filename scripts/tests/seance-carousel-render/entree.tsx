/**
 * HARNAIS — LE PARCOURS HORIZONTAL, DANS UN VRAI NAVIGATEUR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST RÉEL ICI
 * ════════════════════════════════════════════════════════════════════════
 * React et `createRoot`, `SessionFeedbackSection` tel quel avec ses hooks
 * et ses effets, `SessionCarousel`, `ExerciseFeedbackCard`,
 * `StudentCardioBlockCard`, `CardioBlockFeedbackForm`, la feuille de style
 * Tailwind RÉELLE du projet, et le moteur de disposition de Chromium.
 *
 * C'est ce dernier point qui compte : `scroll-snap-type`, la largeur d'une
 * carte et la hauteur du document ne sont PAS des chaînes de caractères
 * qu'on pourrait chercher dans un fichier. Ce sont des valeurs calculées.
 * Un test qui chercherait « snap-mandatory » dans le source prouverait
 * seulement que quelqu'un a tapé ces lettres.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI N'EST PAS RÉEL, ET POURQUOI CE N'EST PAS GÊNANT
 * ════════════════════════════════════════════════════════════════════════
 * Aucun Supabase (les variables d'environnement sont vides, donc
 * `createSupabaseBrowserClient()` rend `null`), aucun dépôt IndexedDB
 * injecté : la séance est montée sur le chemin `mock`, celui qui n'attend
 * aucune hydratation. La disposition, elle, est strictement la même — le
 * carrousel ne connaît ni le transport ni l'identité.
 */
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";

import { SessionFeedbackSection } from "@/components/student/SessionFeedbackSection";
import type { AdminCardioBlock, Exercise, TrainingBlock } from "@/types";

const ELEVE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SEANCE = "33333333-3333-4333-8333-111111111111";

function exercice(id: string, nom: string, order: number) {
  return {
    id,
    order,
    name: nom,
    sets: 2,
    reps: "10-15",
    restSeconds: 150,
    tempo: "2-0-X-1",
    recommendedLoad: "RIR 1",
    videoUrl: "",
    notes: "",
    muscleGroup: "Dos",
    recommendedRpe: "8",
  };
}

/** Trois blocs : muscu (3 exercices) → cardio → muscu (2 exercices). */
const BLOCKS: TrainingBlock[] = [
  {
    id: "11111111-aaaa-4aaa-8aaa-000000000001",
    category: "strength",
    position: 0,
    title: "Tirage",
    colorKey: "purple",
    exercises: [
      exercice("ex-1", "Tirage horizontal coudes ouverts à la poulie", 0),
      exercice("ex-2", "Tirage vertical prise neutre", 1),
      exercice("ex-3", "Rowing haltère unilatéral", 2),
    ],
  },
  {
    id: "22222222-bbbb-4bbb-8bbb-000000000002",
    category: "cardio",
    position: 1,
    title: "Retour au calme",
    colorKey: "blue",
    cardioType: "easy_run",
    prescriptions: [
      {
        id: "seg-1",
        order: 0,
        segmentType: "single",
        title: "Continu",
        intensityTargetType: "free",
        durationSeconds: 600,
        distanceMeters: 2000,
      },
    ],
  },
  {
    id: "33333333-cccc-4ccc-8ccc-000000000003",
    category: "strength",
    position: 2,
    title: "Bras",
    colorKey: "orange",
    exercises: [exercice("ex-4", "Curl incliné", 0), exercice("ex-5", "Extension poulie haute", 1)],
  },
] as TrainingBlock[];

/** Une séance d'UN SEUL exercice — pour prouver le cas limite (rail à une carte). */
const BLOCKS_SOLO: TrainingBlock[] = [
  {
    id: "44444444-dddd-4ddd-8ddd-000000000004",
    category: "strength",
    position: 0,
    title: null,
    colorKey: "gray",
    exercises: [exercice("solo-1", "Développé couché", 0)],
  },
] as TrainingBlock[];

/**
 * UNE SÉANCE VOLONTAIREMENT TROP HAUTE.
 *
 * Douze séries sur un seul exercice : la carte dépasse largement l'écran
 * d'un téléphone. C'est le seul moyen de prouver que la borne de hauteur
 * fait son travail — avec un exercice ordinaire, la carte tient dans le
 * viewport et la borne ne s'applique jamais, donc la retirer ne changerait
 * rien et le test serait vert quoi qu'il arrive.
 */
const BLOCKS_LONG: TrainingBlock[] = [
  {
    id: "55555555-eeee-4eee-8eee-000000000005",
    category: "strength",
    position: 0,
    title: "Volume",
    colorKey: "gray",
    exercises: [{ ...exercice("long-1", "Squat", 0), sets: 12 }],
  },
] as TrainingBlock[];

let racine: Root | null = null;

const harnais = {
  async monter(variante: "complet" | "solo" | "long" = "complet") {
    racine?.unmount();
    document.getElementById("racine")!.innerHTML = "";
    racine = createRoot(document.getElementById("racine")!);
    racine.render(
      createElement(SessionFeedbackSection, {
        studentId: ELEVE,
        sessionId: SEANCE,
        programId: null,
        sessionRefLabel: "Haut du corps",
        blocks: variante === "solo" ? BLOCKS_SOLO : variante === "long" ? BLOCKS_LONG : BLOCKS,
        exercises: [] as Exercise[],
        cardioBlocks: [] as AdminCardioBlock[],
        sessionMuscleGroup: "Dos",
      }),
    );
    await new Promise((ok) => setTimeout(ok, 120));
  },

  /**
   * TOUT CE QUE LE MOTEUR DE DISPOSITION SAIT DU RAIL.
   *
   * Chaque valeur est LUE, jamais déduite d'une classe : `getComputedStyle`
   * pour le rattrapage, `getBoundingClientRect` pour les largeurs,
   * `scrollWidth`/`clientWidth` pour l'existence même d'un défilement.
   */
  mesures() {
    const rail = document.querySelector<HTMLElement>("[data-rail-seance]");
    if (!rail) return null;
    const cartes = Array.from(rail.children) as HTMLElement[];
    const styleRail = getComputedStyle(rail);
    const bouton = document.querySelector<HTMLElement>('button[type="submit"]');
    return {
      snapType: styleRail.scrollSnapType,
      overflowX: styleRail.overflowX,
      overscrollX: styleRail.overscrollBehaviorX,
      largeurRail: rail.clientWidth,
      hauteurRail: rail.clientHeight,
      largeurDefilable: rail.scrollWidth,
      scrollLeft: Math.round(rail.scrollLeft),
      nbCartes: cartes.length,
      kinds: cartes.map((c) => c.dataset.carteSeance ?? ""),
      snapAligns: cartes.map((c) => getComputedStyle(c).scrollSnapAlign),
      largeursCartes: cartes.map((c) => Math.round(c.getBoundingClientRect().width)),
      offsets: cartes.map((c) => c.offsetLeft - rail.offsetLeft),
      // La validation GLOBALE doit vivre HORS du rail.
      submitPresent: Boolean(bouton),
      submitDansRail: bouton ? rail.contains(bouton) : false,
      // Un second défilement vertical du document serait le défaut qu'on
      // refuse : on lit la hauteur réelle, pas une classe.
      hauteurDocument: document.documentElement.scrollHeight,
      hauteurFenetre: window.innerHeight,
      indicateur: document.querySelector<HTMLElement>("[aria-live='polite']")?.innerText.replace(/\s+/g, " ").trim() ?? "",
    };
  },

  /**
   * TOUS LES DÉFILEURS VERTICAUX DU DOCUMENT, RECENSÉS À LA MAIN.
   *
   * Un défileur, c'est un élément dont le contenu dépasse ET dont
   * `overflow-y` vaut `auto`/`scroll`. On les liste tous, en disant lesquels
   * vivent dans le rail : c'est la seule façon de distinguer « le contenu
   * d'une carte défile, comme prévu » de « un second défilement parasite est
   * apparu quelque part dans la page ».
   */
  defileursVerticaux() {
    const rail = document.querySelector<HTMLElement>("[data-rail-seance]");
    const tous = Array.from(document.querySelectorAll<HTMLElement>("*"));
    return tous
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 1
        );
      })
      .map((element) => ({
        balise: element.tagName,
        dansRail: rail ? rail.contains(element) : false,
        estUneCarte: Boolean((element.parentElement as HTMLElement | null)?.dataset.carteSeance),
        hauteur: Math.round(element.clientHeight),
      }));
  },

  /**
   * Amène le contenu de la carte visible tout en BAS de son défilement, et
   * rend l'état du piège : la carte est-elle en butée, et où en est la page ?
   */
  async carteEnButee() {
    const rail = document.querySelector<HTMLElement>("[data-rail-seance]")!;
    const carte = rail.children[0] as HTMLElement;
    const interne = carte.querySelector<HTMLElement>(":scope > div:last-child")!;
    interne.scrollTop = interne.scrollHeight;
    await new Promise((ok) => setTimeout(ok, 120));
    return {
      enButee: interne.scrollTop >= interne.scrollHeight - interne.clientHeight - 1,
      // `contain` est LA déclaration qui coupait le relais vers la page.
      overscrollY: getComputedStyle(interne).overscrollBehaviorY,
      scrollYPage: Math.round(window.scrollY),
      pageDefilable: document.documentElement.scrollHeight > window.innerHeight,
      // Coordonnées du centre de la carte, pour y poser un vrai doigt.
      centre: (() => {
        const r = interne.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })(),
    };
  },

  scrollYPage() {
    return Math.round(window.scrollY);
  },

  /**
   * LE LISERÉ DE BLOC — porté par la CARTE, pas par le bandeau.
   *
   * Tant qu'il vivait sur le bandeau, le trait coloré s'arrêtait après
   * l'en-tête. On lit donc où la bordure gauche est réellement posée, et
   * qu'elle couvre bien toute la hauteur de la carte.
   */
  lisere() {
    const rail = document.querySelector<HTMLElement>("[data-rail-seance]")!;
    return (Array.from(rail.children) as HTMLElement[]).map((carte) => {
      const bandeau = carte.firstElementChild as HTMLElement;
      const styleCarte = getComputedStyle(carte);
      return {
        largeurCarte: styleCarte.borderLeftWidth,
        couleurCarte: styleCarte.borderLeftColor,
        largeurBandeau: getComputedStyle(bandeau).borderLeftWidth,
        hauteurCarte: Math.round(carte.getBoundingClientRect().height),
        hauteurBandeau: Math.round(bandeau.getBoundingClientRect().height),
      };
    });
  },

  /** Largeur du document : le rail ne doit JAMAIS élargir la page. */
  largeurDocument() {
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
  },

  /** Déplace le rail à la main, puis rend la position atteinte. */
  async defilerVers(x: number) {
    const rail = document.querySelector<HTMLElement>("[data-rail-seance]")!;
    rail.scrollTo({ left: x, behavior: "auto" });
    await new Promise((ok) => setTimeout(ok, 250));
    return Math.round(rail.scrollLeft);
  },

  /** Les libellés visibles des contrôles d'une carte donnée (index 0-based). */
  contenuCarte(index: number) {
    const rail = document.querySelector<HTMLElement>("[data-rail-seance]")!;
    const carte = rail.children[index] as HTMLElement | undefined;
    if (!carte) return null;
    return {
      kind: carte.dataset.carteSeance ?? "",
      texte: carte.innerText.replace(/\s+/g, " ").trim(),
      placeholders: Array.from(carte.querySelectorAll("input")).map((i) => i.placeholder || i.type),
      ariaLabels: Array.from(carte.querySelectorAll("input, select, textarea")).map(
        (c) => c.getAttribute("aria-label") ?? "",
      ),
      boutons: Array.from(carte.querySelectorAll("button")).map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim()),
      selects: carte.querySelectorAll("select").length,
      textareas: carte.querySelectorAll("textarea").length,
    };
  },

  /** Clique sur ‹ ou › et rend la position du rail après l'animation. */
  async cliquerRail(direction: "Carte précédente" | "Carte suivante") {
    const bouton = document.querySelector<HTMLButtonElement>(`button[aria-label="${direction}"]`);
    if (!bouton || bouton.disabled) return null;
    bouton.click();
    await new Promise((ok) => setTimeout(ok, 700));
    const rail = document.querySelector<HTMLElement>("[data-rail-seance]")!;
    return Math.round(rail.scrollLeft);
  },

  /** Le type HTML des boutons du rail — un `submit` déguisé enverrait le retour. */
  typesBoutonsRail() {
    const rail = document.querySelector<HTMLElement>("[data-rail-seance]")!;
    const parent = rail.parentElement!;
    return Array.from(parent.querySelectorAll("button[aria-label^='Carte ']")).map((b) => b.getAttribute("type"));
  },

  /** Nombre de soumissions du formulaire observées depuis le montage. */
  soumissions: 0,
  espionnerSoumission() {
    const formulaire = document.querySelector("form");
    if (!formulaire) return false;
    formulaire.addEventListener("submit", (e) => {
      e.preventDefault();
      harnais.soumissions += 1;
    });
    harnais.soumissions = 0;
    return true;
  },
};

(window as unknown as { __harnais: typeof harnais }).__harnais = harnais;
