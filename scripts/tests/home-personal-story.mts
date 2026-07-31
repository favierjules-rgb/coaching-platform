/**
 * Harnais de non-régression — section home « Mon histoire ».
 *
 * Vérifie ce qui compte vraiment et qui pourrait casser sans qu'on s'en
 * aperçoive : la place dans la page, l'ordre d'empilement mobile demandé,
 * l'absence de couleur (l'accent doit rester l'exclusivité de « Mon bilan
 * offert »), le comportement du compteur (une seule fois, valeur finale
 * rendue côté serveur, respect de prefers-reduced-motion) et l'absence de
 * toute largeur fixe.
 *
 * Lancement : npx tsx scripts/tests/home-personal-story.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { PersonalStory } from "../../components/sections/PersonalStory";

let réussis = 0;
let échecs = 0;
function test(nom: string, fn: () => void) {
  try {
    fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

const home = lire("../../app/page.tsx");
const sectionSource = lire("../../components/sections/PersonalStory.tsx");
const compteurSource = lire("../../components/sections/AnimatedCounter.tsx");
const css = lire("../../app/globals.css");
const htmlBrut = renderToString(createElement(PersonalStory));
/** React sépare deux nœuds texte voisins par `<!-- -->` : on les retire pour
 *  pouvoir tester le texte tel que l'utilisateur le lit (« 103+ »). */
const html = htmlBrut.replace(/<!-- -->/g, "");

/* ─── 1. Emplacement ─── */

test("1. la section est placée JUSTE APRÈS la newsletter", () => {
  const newsletter = home.indexOf("<Newsletter />");
  const histoire = home.indexOf("<PersonalStory />");
  assert.ok(newsletter > 0 && histoire > 0, "les deux sections doivent être montées");
  assert.ok(histoire > newsletter, "« Mon histoire » doit venir après la newsletter");
  const entre = home.slice(newsletter + "<Newsletter />".length, histoire);
  assert.ok(!/<[A-Z]/.test(entre), `aucune section ne doit s'intercaler (trouvé : ${entre.trim()})`);
});

test("2. ancre stable et décalage sous le header fixe", () => {
  assert.ok(html.includes('id="mon-histoire"'), "ancre #mon-histoire absente");
  assert.ok(html.includes("scroll-mt-24"), "décalage sous le header absent");
});

/* ─── 2. Contenu ─── */

test("3. label, titre, compteur et citation sont présents", () => {
  assert.ok(/Mon parcours/i.test(html), "label absent");
  assert.ok(/Mon histoire/i.test(html), "titre absent");
  assert.ok(html.includes("103"), "valeur du compteur absente");
  assert.ok(/élèves accompagn/i.test(html), "libellé du compteur absent");
  assert.ok(/ambitions sont devenues celles de mes/i.test(html), "citation finale absente");
});

test("4. aucune promesse de résultat ni prix dans la section", () => {
  assert.ok(!/garanti/i.test(html), "aucune promesse de résultat garanti");
  assert.ok(!/\d+\s*(€|euros)/i.test(html), "aucun prix ne doit être affiché ici");
});

/* ─── 3. Ordre mobile demandé : label, titre, compteur, photo, texte ─── */

test("5. ordre d'empilement mobile respecté", () => {
  const ordres = [...html.matchAll(/order-(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(ordres.length >= 4, `ordres explicites attendus, trouvés : ${ordres.join(", ")}`);
  const photo = sectionSource.slice(sectionSource.indexOf("histoire-photo"));
  assert.ok(/order-4/.test(photo.slice(0, 200)), "la photo doit être le 4e bloc en mobile");
  const compteur = sectionSource.slice(sectionSource.indexOf("histoire-compteur"));
  assert.ok(/order-3/.test(compteur.slice(0, 200)), "le compteur doit être le 3e bloc en mobile");
});

test("6. deux colonnes seulement à partir de lg, photo à gauche", () => {
  assert.ok(/lg:grid-cols-\[minmax\(0/.test(sectionSource), "grille lg en minmax(0, …), donc rétractable");
  const grille = sectionSource.indexOf("lg:grid-cols-");
  const photo = sectionSource.indexOf("histoire-photo");
  const contenu = sectionSource.indexOf("<SectionLabel>");
  assert.ok(photo > grille && photo < contenu, "la photo doit précéder le contenu dans le balisage");
  assert.ok(/lg:order-none/.test(sectionSource), "l'ordre mobile doit être neutralisé en desktop");
});

/* ─── 4. Responsive ─── */

test("7. aucune largeur fixe, rayons et rembourrages fluides", () => {
  assert.ok(!/w-\[\d{3,}px\]/.test(html), "aucune largeur fixe en pixels dans le rendu");
  assert.ok(!/style="[^"]*width:\s*\d+px/.test(html), "aucune largeur inline en pixels");
  assert.ok(html.includes("max-w-7xl") && html.includes("px-6"), "colonne centrée avec marges");
  assert.ok(/max-w-\[\d+ch\]/.test(sectionSource), "mesure du texte bornée en ch");
  const bloc = css.slice(css.indexOf(".histoire-photo {"));
  assert.ok(/border-radius:\s*clamp\(/.test(bloc), "rayon du cadre photo en clamp()");
});

/* ─── 5. Identité visuelle : monochrome strict ─── */

test("8. aucune couleur : l'accent reste réservé à « Mon bilan offert »", () => {
  assert.ok(
    !/(bg|text|border)-(blue|green|red|yellow|purple|pink|orange|indigo|teal|lime)-\d/.test(html),
    "aucune classe de couleur utilitaire",
  );
  assert.ok(!/bilan-/.test(sectionSource), "la section ne doit pas consommer les tokens du bilan");
  const blocHistoire = css.slice(css.indexOf("/*\n * Section « Mon histoire » — début"));
  assert.ok(!/--bilan-accent|#b4f327/.test(blocHistoire), "aucun accent coloré dans le CSS de la section");
  assert.ok(
    !/rgba\((?!255,\s*255,\s*255|0,\s*0,\s*0)/.test(blocHistoire),
    "seuls du blanc et du noir transparents sont admis",
  );
});

/* ─── 6. Compteur ─── */

test("9. le compteur s'anime une seule fois et jamais en boucle", () => {
  assert.ok(/observateur\.disconnect\(\)/.test(compteurSource), "l'observateur doit se déconnecter au déclenchement");
  assert.ok(!/setInterval|infinite/.test(compteurSource), "aucune animation permanente");
  assert.ok(/threshold/.test(compteurSource), "déclenchement à l'entrée dans le viewport");
});

test("10. le rendu serveur écrit la valeur FINALE, jamais zéro", () => {
  assert.ok(html.includes("103+"), "la valeur finale doit être présente dans le HTML serveur");
  assert.ok(!/>0\+</.test(html), "le HTML serveur ne doit pas contenir un compteur à zéro");
  assert.ok(/useState\(target\)/.test(compteurSource), "l'état initial est la valeur finale");
});

test("11. prefers-reduced-motion affiche directement la valeur finale", () => {
  assert.ok(
    /prefers-reduced-motion: reduce[\s\S]{0,220}return;/.test(compteurSource),
    "sortie anticipée sans animation quand le mouvement réduit est demandé",
  );
  assert.ok(/IntersectionObserver" \)|typeof IntersectionObserver === "undefined"/.test(compteurSource),
    "repli si IntersectionObserver est absent");
});

test("12. décélération, jamais de mouvement linéaire", () => {
  assert.ok(/easeOutCubic/.test(compteurSource), "courbe ease-out utilisée");
  assert.ok(/requestAnimationFrame/.test(compteurSource), "animation pilotée par rAF");
  assert.ok(/cancelAnimationFrame/.test(compteurSource), "frame annulée au démontage");
});

/* ─── 7. Accessibilité ─── */

test("13. accessibilité : image décrite, décor masqué, valeur lisible", () => {
  assert.ok(/alt="[^"]+"|aria-hidden/.test(html), "image décrite ou décor explicitement masqué");
  assert.ok(html.includes("sr-only"), "valeur finale exposée aux lecteurs d'écran");
  assert.ok(/aria-hidden="true"/.test(html), "le décompte animé est masqué aux technologies d'assistance");
  assert.ok(/<h2/.test(html), "un titre de niveau 2 structure la section");
});

/* ─── 8. Isolation ─── */

test("14. la section n'impacte aucune autre partie du site", () => {
  for (const voisine of ["Newsletter", "PublicPrograms", "FreeAssessment", "Transformations", "Hero"]) {
    const src = lire(`../../components/sections/${voisine}.tsx`);
    assert.ok(!src.includes("histoire"), `${voisine} ne doit pas dépendre de la nouvelle section`);
  }
  assert.ok(!/logique|supabase|fetch\(/i.test(sectionSource.replace(/\/\*[\s\S]*?\*\//g, "")),
    "aucune logique métier ni appel réseau dans la section");
});

test("15. photo remplaçable sans toucher au code, sans image cassée", () => {
  assert.ok(/const PORTRAIT = "/.test(sectionSource), "chemin du portrait centralisé dans une constante");
  assert.ok(/existsSync/.test(sectionSource), "repli si le fichier n'existe pas encore");
});

console.log(`\n${réussis} test(s) réussi(s), ${échecs} échec(s).`);
if (échecs > 0) process.exit(1);
