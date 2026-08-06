import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * CLÉS DE PROFIL INTERNES — un profil technique par jour de la semaine.
 *
 * POURQUOI. Le schéma déployé impose qu'une journée (`nutrition_days`)
 * désigne un profil (`nutrition_plan_profiles`) par une clé étrangère
 * COMPOSITE `(plan_id, profile_key)`. Le coach, lui, ne doit plus jamais
 * voir, nommer, créer ni affecter un profil : il configure un JOUR.
 *
 * On concilie les deux en dérivant la clé du jour lui-même. Sept jours, sept
 * profils, une correspondance totale et sans ambiguïté :
 *
 *     monday → day_monday … sunday → day_sunday
 *
 * Conséquences voulues :
 *   - aucun doublon possible : la clé est une fonction du jour, pas une
 *     saisie ;
 *   - deux jours ne partagent JAMAIS un profil, donc modifier mardi ne peut
 *     pas déplacer lundi ;
 *   - la clé respecte `nutrition_plan_profiles_profile_key_check`
 *     (`^[a-z][a-z0-9_]{0,31}$`) — vérifié par un test.
 *
 * CES CLÉS NE SONT JAMAIS AFFICHÉES. Elles n'existent que dans la charge
 * utile envoyée à `save_nutrition_plan_v2`.
 */

/** `monday` → `day_monday`. Fonction totale, sans état. */
export function internalProfileKeyForDay(day: WeekdayKey): string {
  return `day_${day}`;
}

/** Les sept clés internes, dans l'ordre canonique lundi → dimanche. */
export const DAY_PROFILE_KEYS: readonly string[] = WEEKDAY_KEYS.map(internalProfileKeyForDay);

/**
 * Clé du profil PRINCIPAL de la charge utile : celui de lundi.
 *
 * La RPC s'en sert pour deux choses seulement : reconstituer le
 * `daily_target` de compatibilité, et servir de profil de repli à une
 * journée dont la charge utile n'indiquerait pas de profil — cas qui ne se
 * produit pas ici puisque les sept jours portent toujours le leur.
 */
export const MAIN_DAY_PROFILE_KEY: string = internalProfileKeyForDay("monday");

/** Une clé est-elle une clé interne de jour ? Utilisé par les tests et la reprise. */
export function isInternalDayProfileKey(profileKey: string): boolean {
  return DAY_PROFILE_KEYS.includes(profileKey);
}
