/**
 * DÉBALLE UN EXPORT PAR DÉFAUT VU DEPUIS UN MODULE `.mts`.
 *
 * Les suites du dépôt n'importaient jusqu'ici que des exports NOMMÉS, et
 * pour une bonne raison : ceux-là traversent proprement. Un `export default`
 * ne traverse pas. tsx compile les fichiers `.ts`/`.tsx` en CommonJS ;
 * chargés depuis un module ESM (`.mts`), leur export par défaut se retrouve
 * emballé une fois de plus — `module.default` est alors l'objet du module,
 * et la valeur cherchée se trouve dans `module.default.default`.
 *
 * Écrire `.default.default` en clair fonctionnerait aujourd'hui et
 * cesserait au premier changement de configuration de modules. Le test
 * échouerait alors pour une raison sans aucun rapport avec ce qu'il
 * vérifie, ce qui est la pire façon d'échouer. On déballe donc jusqu'à
 * trouver, et on lève une erreur explicite si on ne trouve pas.
 *
 * Nécessaire pour les PAGES (`app/**\/page.tsx`) et les routes de métadonnées
 * (`app/manifest.ts`), que Next.js impose d'exporter par défaut.
 */
export function exportDefaut<T>(module: unknown, description: string): T {
  let valeur: unknown = module;
  for (let i = 0; i < 4; i += 1) {
    if (typeof valeur === "function") {
      return valeur as T;
    }
    if (typeof valeur !== "object" || valeur === null) {
      break;
    }
    valeur = (valeur as { default?: unknown }).default;
  }
  throw new Error(`${description} : export par défaut introuvable`);
}
