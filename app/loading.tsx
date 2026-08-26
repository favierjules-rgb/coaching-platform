import { Loader } from "@/components/ui/Loader";

/**
 * L'ÉTAT DE CHARGEMENT GLOBAL.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UN SEUL FICHIER COUVRE PRESQUE TOUTE LA NAVIGATION
 * ════════════════════════════════════════════════════════════════════════
 * Next.js remonte au `loading.tsx` le plus proche pour envelopper le segment
 * en cours de chargement. Posé à la racine de `app/`, celui-ci sert donc de
 * filet à toutes les routes qui n'en déclarent pas un à elles — c'est-à-dire
 * à presque toutes.
 *
 * ⚠️ NE PAS LE CONFONDRE AVEC UN ÉTAT VIDE. Il ne s'affiche que PENDANT le
 * rendu serveur d'une page, jamais à la place d'un contenu absent. Une page
 * qui n'a rien à montrer doit le dire elle-même.
 *
 * ⚠️ `/programmes` GARDE SON PROPRE SQUELETTE. Un squelette qui dessine la
 * forme du contenu attendu vaut mieux qu'un indicateur seul quand on connaît
 * cette forme à l'avance — l'emblème y a simplement été ajouté, pour que le
 * signal soit le même partout.
 */
export default function ChargementGlobal() {
  return <Loader libelle="Chargement de la page…" />;
}
