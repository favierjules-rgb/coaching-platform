import type { TypeOsm } from "@/lib/nutrition/magasins-osm";

/**
 * COURSES C4.3c — LA COUVERTURE PRIX DU MAGASIN CHOISI, DITE EXPLICITEMENT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CE MODULE EXISTE POUR TUER UN `number | null` QUI MENTAIT
 * ════════════════════════════════════════════════════════════════════════════
 * Jusqu'ici, la question « quel magasin l'élève a-t-il choisi ? » se lisait à
 * travers `lireOpLocationIdDuMagasinChoisi(): number | null`, et ce `null`
 * portait DEUX faits incompatibles :
 *
 *   - l'élève n'a choisi AUCUN magasin — il faut l'inviter à en choisir un ;
 *   - l'élève a choisi un magasin RÉEL, mais Open Prices ne le connaît pas —
 *     il n'y a rien à choisir de plus, et rien n'est en panne.
 *
 * Tant que `op_location_id` était NOT NULL, le second cas ne pouvait pas
 * exister : tout magasin en base avait un pont. C4.3c le rend nullable —
 * OpenStreetMap devient l'annuaire, Open Prices reste la source de prix — et à
 * partir de cet instant, le second cas devient la SITUATION NORMALE. À Toulon,
 * mesuré : deux lieux Open Prices pour toute la ville, dont un marchand de
 * journaux. La grande majorité des supermarchés réels n'y sont pas.
 *
 * Laisser les deux cas partager un `null` obligerait C4.4, puis C4.6, puis
 * l'écran, à REDEVINER chacun de son côté lequel des deux s'applique — avec
 * une chance sur deux de se tromper, et aucune façon de s'en apercevoir. Le
 * type ci-dessous rend l'erreur impossible à écrire.
 *
 * ⚠️ CE MODULE NE PARLE À PERSONNE. Ni base, ni réseau, ni React.
 */

/**
 * Ce que l'on sait du magasin choisi — trois cas, jamais deux, jamais quatre.
 *
 * ⚠️ `magasin_ponte` PORTE SON `opLocationId` DANS SA BRANCHE, et lui seul. Le
 * compilateur refuse donc de lire un identifiant amont sans avoir d'abord
 * établi qu'il en existe un. C'est là toute la différence avec le `number |
 * null` qu'il remplace : la vérification n'est plus une politesse, elle est la
 * condition d'accès.
 *
 * ⚠️ L'IDENTITÉ OSM EST PRÉSENTE DANS LES DEUX BRANCHES « MAGASIN ». C'est elle
 * qui permet, plus tard, de retenter le pont sans redemander à l'élève de
 * choisir : `(osmType, osmId)` est l'entrée exacte de Open Prices
 * (`/api/v1/locations/osm/{type}/{id}`), et c'est la clé d'identité de `stores`.
 */
export type CouvertureMagasin =
  | { readonly etat: "aucun_magasin" }
  | {
      readonly etat: "magasin_sans_couverture_prix";
      readonly storeId: string;
      readonly osmType: TypeOsm;
      readonly osmId: number;
    }
  | {
      readonly etat: "magasin_ponte";
      readonly storeId: string;
      readonly osmType: TypeOsm;
      readonly osmId: number;
      readonly opLocationId: number;
    };

export type EtatCouverture = CouvertureMagasin["etat"];

/** L'absence de choix, écrite une fois — pour qu'elle ne soit pas réinventée. */
export const AUCUN_MAGASIN: CouvertureMagasin = { etat: "aucun_magasin" };

/**
 * ⚠️ AUCUN ACCESSEUR `opLocationIdOuNull()` N'EST FOURNI, ET C'EST DÉLIBÉRÉ.
 * Une telle fonction reconstituerait exactement le `number | null` que ce
 * module supprime, et le premier appelant pressé s'en servirait. Pour lire
 * l'identifiant amont, il faut passer par la branche — c'est le prix, et c'est
 * aussi tout l'intérêt.
 *
 * Ce qui suit n'est donc pas un accès déguisé : c'est un prédicat, qui répond
 * « oui / non » et ne rend aucune valeur.
 */
export function magasinChoisi(couverture: CouvertureMagasin): boolean {
  return couverture.etat !== "aucun_magasin";
}
