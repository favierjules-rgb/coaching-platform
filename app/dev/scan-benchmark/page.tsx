import { notFound } from "next/navigation";

import { BancDEssaiScan } from "@/components/dev/BancDEssaiScan";

/**
 * BANC D'ESSAI DU SCANNER — TEMPORAIRE, PHASE 2 D'A4.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE PAGE EXISTE, ET POURQUOI ELLE DOIT DISPARAÎTRE
 * ────────────────────────────────────────────────────────────────────────────
 * Deux bibliothèques de décodage restent en lice, et la question qui les
 * départage — laquelle lit un EAN-13 assez vite sur un iPhone réel — ne se
 * répond pas depuis un conteneur Linux. Il faut un téléphone, un paquet de
 * céréales, et de la lumière.
 *
 * Cette page permet exactement cela : choisir un moteur, ouvrir la caméra
 * arrière, scanner, lire des chiffres. Rien de plus.
 *
 * ⚠️ ELLE N'EST PAS UNE FONCTIONNALITÉ. Elle sera retirée avec le candidat
 * perdant, avant l'écran définitif. Aucun lien ne pointe vers elle depuis
 * l'application.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI UN DRAPEAU, ET PAS SEULEMENT `NODE_ENV`
 * ────────────────────────────────────────────────────────────────────────────
 * Sur Vercel, une Preview est construite en `NODE_ENV=production` : se fier au
 * seul environnement rendrait la page invisible là où on veut précisément la
 * tester, ou visible là où on ne veut pas d'elle. Le drapeau explicite tranche :
 * `NEXT_PUBLIC_A4_BENCH=1` posé SUR L'ENVIRONNEMENT DE PREVIEW, et nulle part
 * ailleurs. En Production, la page rend un 404 — pas une page vide, un 404 :
 * son existence même ne se devine pas.
 */
export const dynamic = "force-dynamic";

export default function PageBancDEssaiScan() {
  const activé =
    process.env.NEXT_PUBLIC_A4_BENCH === "1" || process.env.NODE_ENV === "development";
  if (!activé) notFound();
  return <BancDEssaiScan />;
}
