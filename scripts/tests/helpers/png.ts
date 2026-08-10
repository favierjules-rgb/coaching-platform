import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/**
 * LECTEUR PNG MINIMAL — juste assez pour REGARDER une icône.
 *
 * Pourquoi ne pas se contenter de l'en-tête (largeur × hauteur) : parce
 * qu'une icône peut avoir la bonne taille et être fausse. Le vrai risque de
 * ce chantier est géométrique — une icône « maskable » dont l'emblème
 * dépasse la zone de sécurité se fera couper les pointes par le lanceur
 * Android, et personne ne s'en apercevra avant de l'avoir sur un téléphone.
 * Vérifier cela demande de savoir où sont les pixels clairs. D'où ces
 * quarante lignes, plutôt qu'une dépendance.
 *
 * Volontairement limité à ce que produit la génération d'icônes : 8 bits par
 * canal, couleur vraie (type 2 : RVB), sans entrelacement. Tout autre format
 * lève une erreur plutôt que de renvoyer des pixels approximatifs.
 */

export interface ImagePng {
  largeur: number;
  hauteur: number;
  /** [r, v, b] à cette position. */
  pixel(x: number, y: number): [number, number, number];
}

/** Filtre PNG : reconstitue une ligne à partir de la précédente. */
function defiltrer(type: number, ligne: Buffer, precedente: Buffer, octetsParPixel: number): void {
  for (let i = 0; i < ligne.length; i += 1) {
    const a = i >= octetsParPixel ? ligne[i - octetsParPixel] : 0; // gauche
    const b = precedente[i]; // dessus
    const c = i >= octetsParPixel ? precedente[i - octetsParPixel] : 0; // diagonale
    switch (type) {
      case 0:
        break;
      case 1:
        ligne[i] = (ligne[i] + a) & 0xff;
        break;
      case 2:
        ligne[i] = (ligne[i] + b) & 0xff;
        break;
      case 3:
        ligne[i] = (ligne[i] + ((a + b) >> 1)) & 0xff;
        break;
      case 4: {
        // Paeth : on garde celui des trois voisins dont la somme prédite
        // s'écarte le moins.
        const p = a + b - c;
        const da = Math.abs(p - a);
        const db = Math.abs(p - b);
        const dc = Math.abs(p - c);
        const predit = da <= db && da <= dc ? a : db <= dc ? b : c;
        ligne[i] = (ligne[i] + predit) & 0xff;
        break;
      }
      default:
        throw new Error(`Filtre PNG inconnu : ${type}`);
    }
  }
}

export function lirePng(chemin: string): ImagePng {
  const donnees = readFileSync(chemin);
  if (donnees.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${chemin} n'est pas un PNG`);
  }

  const largeur = donnees.readUInt32BE(16);
  const hauteur = donnees.readUInt32BE(20);
  const profondeur = donnees[24];
  const typeCouleur = donnees[25];
  const entrelacement = donnees[28];
  if (profondeur !== 8 || typeCouleur !== 2 || entrelacement !== 0) {
    throw new Error(
      `${chemin} : format non géré (profondeur ${profondeur}, type ${typeCouleur}, entrelacement ${entrelacement})`,
    );
  }

  const morceaux: Buffer[] = [];
  let position = 8;
  while (position < donnees.length) {
    const longueur = donnees.readUInt32BE(position);
    const type = donnees.toString("ascii", position + 4, position + 8);
    if (type === "IDAT") {
      morceaux.push(donnees.subarray(position + 8, position + 8 + longueur));
    }
    position += 12 + longueur;
  }

  const brut = inflateSync(Buffer.concat(morceaux));
  const octetsParPixel = 3;
  const parLigne = largeur * octetsParPixel;
  const pixels = Buffer.alloc(hauteur * parLigne);
  let precedente = Buffer.alloc(parLigne);

  for (let y = 0; y < hauteur; y += 1) {
    const depart = y * (parLigne + 1);
    const filtre = brut[depart];
    const ligne = Buffer.from(brut.subarray(depart + 1, depart + 1 + parLigne));
    defiltrer(filtre, ligne, precedente, octetsParPixel);
    ligne.copy(pixels, y * parLigne);
    precedente = ligne;
  }

  return {
    largeur,
    hauteur,
    pixel(x: number, y: number) {
      const decalage = y * parLigne + x * octetsParPixel;
      return [pixels[decalage], pixels[decalage + 1], pixels[decalage + 2]];
    },
  };
}
