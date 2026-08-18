import { z } from "zod";

import { RAYON_KM_MAX, RAYON_KM_MIN } from "@/lib/nutrition/magasin-proche";

/**
 * COURSES C4.3a — les corps de requête de la découverte des magasins.
 *
 * ⚠️ DEUX SCHÉMAS, DEUX INTENTIONS DIFFÉRENTES, ET C'EST LE POINT.
 *
 * Chercher transporte une POSITION — la donnée la plus sensible de tout le
 * chantier. Choisir ne transporte qu'un IDENTIFIANT : tout le reste du magasin
 * est relu chez la source par le serveur. Un schéma qui accepterait un nom ou
 * une enseigne au moment du choix ferait du navigateur la source de vérité du
 * catalogue partagé — et n'importe qui pourrait y écrire ce qu'il veut.
 *
 * Les deux sont `.strict()` : toute clé inconnue est un 400, jamais un champ
 * ignoré en silence.
 */

/**
 * ⚠️ UN POST, PAS UN GET, ET LA RAISON EST LA CONFIDENTIALITÉ. Une position en
 * chaîne de requête se retrouve dans les journaux d'accès, l'historique du
 * navigateur et l'en-tête `Referer` de la page suivante. Dans un corps, elle ne
 * survit à rien.
 */
export const magasinsProchesBodySchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
    /**
     * ⚠️ LE MAXIMUM VIENT DE NOTRE MODULE PUR, PAS D'UN NOMBRE RECOPIÉ ICI.
     * L'amont n'impose aucune borne supérieure — la nôtre est donc la seule, et
     * elle doit être définie à un seul endroit.
     */
    rayonKm: z.number().finite().min(RAYON_KM_MIN).max(RAYON_KM_MAX).optional(),
  })
  .strict();

export type MagasinsProchesBody = z.infer<typeof magasinsProchesBodySchema>;

/**
 * ⚠️ UN ENTIER, ET RIEN D'AUTRE.
 *
 * Pas de `name`, pas de `brand`, pas de `lat`, pas de `osmId` : le `.strict()`
 * transforme toute tentative de décrire le magasin en 400. Le serveur relit la
 * fiche chez Open Prices et n'écrit que ce qu'il a relu.
 */
export const choixMagasinBodySchema = z
  .object({
    /**
     * ⚠️ `.safe()` EN PLUS DE `.int()` — c'est la même règle que le module pur.
     * Un entier au-delà de 2⁵³−1 a DÉJÀ été arrondi par `JSON.parse` quand ce
     * schéma le voit : le refuser est le seul moyen de ne pas écrire dans le
     * référentiel partagé une identité qui n'est celle d'aucun magasin.
     */
    opLocationId: z.number().int().safe().positive(),
  })
  .strict();

export type ChoixMagasinBody = z.infer<typeof choixMagasinBodySchema>;
