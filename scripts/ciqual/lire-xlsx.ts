/**
 * LECTEUR XLSX MINIMAL — sans aucune dépendance.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI PAS UNE BIBLIOTHÈQUE
 * ────────────────────────────────────────────────────────────────────────────
 * Ce lecteur ne sert qu'à UNE chose : régénérer le jeu de données Ciqual, à la
 * main, quand l'Anses publie un nouveau millésime — soit une fois tous les
 * quelques ANNÉES. Ajouter `xlsx` ou `exceljs` aux dépendances de toute
 * l'application pour cet usage-là ferait porter à la Production le poids d'un
 * outil hors ligne qu'elle n'exécute jamais.
 *
 * Un `.xlsx` est une archive ZIP de fichiers XML. Node sait déjà tout faire :
 * `zlib.inflateRawSync` pour la décompression, et une lecture de balises pour
 * le XML. Ce fichier tient en une page et se relit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE FAIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Il ne gère ni les formules, ni les styles, ni les dates, ni le ZIP64. Il
 * n'en a pas besoin : la table Ciqual est un tableau de CHAÎNES, ce qui a été
 * mesuré (292 653 cellules sur 292 656 sont des chaînes).
 *
 * La garantie de justesse ne vient PAS de ce code : elle vient du fait que sa
 * sortie est comparée à celle d'`openpyxl` sur le même fichier, et que le jeu
 * de données produit porte un SHA-256 figé dans le manifeste. Un lecteur qui
 * dériverait ferait rougir les tests A3-CIQ.
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/** Une entrée de l'archive, décompressée. */
function lireZip(archive: Buffer): Map<string, Buffer> {
  const fichiers = new Map<string, Buffer>();

  // On lit le RÉPERTOIRE CENTRAL, en fin d'archive, plutôt que d'avancer
  // en-tête par en-tête : c'est la seule façon fiable de connaître les
  // tailles quand un producteur utilise les descripteurs de données.
  let finRepertoire = -1;
  for (let i = archive.length - 22; i >= 0; i -= 1) {
    if (archive.readUInt32LE(i) === 0x06054b50) {
      finRepertoire = i;
      break;
    }
  }
  if (finRepertoire < 0) throw new Error("ZIP illisible : fin de répertoire central introuvable.");

  const nbEntrees = archive.readUInt16LE(finRepertoire + 10);
  let position = archive.readUInt32LE(finRepertoire + 16);

  for (let n = 0; n < nbEntrees; n += 1) {
    if (archive.readUInt32LE(position) !== 0x02014b50) {
      throw new Error(`ZIP illisible : entrée ${n} corrompue.`);
    }
    const methode = archive.readUInt16LE(position + 10);
    const tailleCompressee = archive.readUInt32LE(position + 20);
    const longueurNom = archive.readUInt16LE(position + 28);
    const longueurExtra = archive.readUInt16LE(position + 30);
    const longueurCommentaire = archive.readUInt16LE(position + 32);
    const decalageLocal = archive.readUInt32LE(position + 42);
    const nom = archive.toString("utf8", position + 46, position + 46 + longueurNom);

    // L'en-tête local redonne ses propres longueurs de nom et d'extra : elles
    // peuvent différer de celles du répertoire central.
    const nomLocal = archive.readUInt16LE(decalageLocal + 26);
    const extraLocal = archive.readUInt16LE(decalageLocal + 28);
    const debutDonnees = decalageLocal + 30 + nomLocal + extraLocal;
    const brut = archive.subarray(debutDonnees, debutDonnees + tailleCompressee);

    fichiers.set(nom, methode === 0 ? Buffer.from(brut) : inflateRawSync(brut));
    position += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }
  return fichiers;
}

/** Les cinq entités XML que produit Excel, et rien d'autre. */
function desechapper(texte: string): string {
  return texte
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    // `&amp;` EN DERNIER : le faire avant transformerait « &amp;lt; » en « < ».
    .replace(/&amp;/g, "&");
}

/**
 * La table des chaînes partagées. Un `<si>` peut contenir plusieurs `<t>`
 * quand Excel a découpé un texte en fragments de mise en forme : on les
 * concatène, sinon un libellé arriverait tronqué.
 */
function lireChainesPartagees(xml: string): string[] {
  const chaines: string[] = [];
  for (const si of xml.split("<si>").slice(1)) {
    const fin = si.indexOf("</si>");
    const contenu = fin >= 0 ? si.slice(0, fin) : si;
    let assemble = "";
    for (const m of contenu.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
      assemble += desechapper(m[1]);
    }
    chaines.push(assemble);
  }
  return chaines;
}

/** « BC » → 54. Les colonnes sont nommées en base 26 sans zéro. */
function indexColonne(reference: string): number {
  const lettres = reference.replace(/\d+$/, "");
  let index = 0;
  for (const c of lettres) index = index * 26 + (c.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * Les lignes d'une feuille, en chaînes. Les cellules absentes rendent `""` :
 * Excel n'écrit pas les cellules vides, et une ligne courte décalerait tout.
 */
export function lireFeuilleXlsx(chemin: string, nomFeuille: string): string[][] {
  const archive = lireZip(readFileSync(chemin));

  const lire = (nom: string): string => {
    const contenu = archive.get(nom);
    if (!contenu) throw new Error(`Entrée absente de l'archive : ${nom}`);
    return contenu.toString("utf8");
  };

  // feuille nommée → rId → cible
  const classeur = lire("xl/workbook.xml");
  const feuille = [...classeur.matchAll(/<sheet\s[^>]*\/?>/g)]
    .map((m) => m[0])
    .find((balise) => desechapper(/name="([^"]*)"/.exec(balise)?.[1] ?? "") === nomFeuille);
  if (!feuille) throw new Error(`Feuille introuvable : ${nomFeuille}`);
  const rId = /r:id="([^"]*)"/.exec(feuille)?.[1];
  const relations = lire("xl/_rels/workbook.xml.rels");
  const cible = [...relations.matchAll(/<Relationship\s[^>]*\/>/g)]
    .map((m) => m[0])
    .find((r) => r.includes(`Id="${rId}"`));
  const chemin_ = /Target="([^"]*)"/.exec(cible ?? "")?.[1];
  if (!chemin_) throw new Error(`Cible introuvable pour ${rId}`);
  const nomEntree = chemin_.startsWith("/") ? chemin_.slice(1) : `xl/${chemin_}`;

  const partagees = archive.has("xl/sharedStrings.xml")
    ? lireChainesPartagees(lire("xl/sharedStrings.xml"))
    : [];

  const lignes: string[][] = [];
  for (const brutLigne of lire(nomEntree).split("<row ").slice(1)) {
    const ligne: string[] = [];
    for (const m of brutLigne.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributs = m[1];
      const corps = m[2] ?? "";
      const reference = /r="([A-Z]+\d+)"/.exec(attributs)?.[1];
      if (!reference) continue;
      const type = /t="([^"]*)"/.exec(attributs)?.[1] ?? "n";

      let valeur = "";
      if (type === "inlineStr") {
        for (const t of corps.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) valeur += desechapper(t[1]);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(corps)?.[1];
        if (v !== undefined) {
          valeur = type === "s" ? (partagees[Number(v)] ?? "") : desechapper(v);
        }
      }

      const colonne = indexColonne(reference);
      while (ligne.length < colonne) ligne.push("");
      ligne[colonne] = valeur;
    }
    lignes.push(ligne);
  }
  return lignes;
}
