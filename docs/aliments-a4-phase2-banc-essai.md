# ALIMENTS A4 — PHASE 2 : caméra arrière + banc d'essai des moteurs de scan

**État : livré, moteur NON choisi.** Le départage attend le benchmark iPhone (§13).

---

## 1. Périmètre

**Fait** — couche caméra, extraction GTIN, interface `MoteurScan`, boucle de scan,
deux adaptateurs derrière la même interface, page de banc d'essai temporaire,
harnais de 26 tests, 16 contrôles négatifs, mesures de poids réelles, preuve
d'exécution en navigateur.

**Pas fait, et volontairement** — aucun scanner branché dans l'écran d'élève,
aucun appel à `/api/food-products` depuis le banc d'essai, aucune migration,
aucune modification du Service Worker, aucun favori/récent (A5), aucun mapping
A5, aucune Courses. **Aucun commit, aucun push, aucun merge.** La branche
`feat/aliments-a4-barcode-scanner` porte le travail en arbre de travail
seulement.

---

## 2. Architecture — quatre modules, une seule responsabilité chacun

| Fichier | Rôle | Dépendances |
|---|---|---|
| `lib/scan/gtin.ts` | forme du code-barres | **aucune** (feuille absolue) |
| `lib/scan/camera.ts` | ouvrir / identifier / **éteindre** la caméra | aucune (ni React, ni réseau, ni décodeur) |
| `lib/scan/moteur.ts` | interface `MoteurScan`, cadence, verrou, vocabulaire des formats | `gtin.ts` |
| `lib/scan/adaptateurs.ts` | les deux candidats, en `import()` dynamique | `moteur.ts` |

### 2.1 Caméra arrière — exigence, pas préférence

- `CONTRAINTE_ARRIERE = { video: { facingMode: { ideal: "environment" } } }`.
  **`ideal`, jamais `exact`** : `exact` lève `OverconstrainedError` sur tout
  appareil sans caméra arrière (Mac, iPad sur support) et transformerait une
  situation gérable en échec sec.
- Si le navigateur a quand même ouvert la frontale **et** qu'une caméra arrière
  est identifiable, une **seconde acquisition ciblée par `deviceId`** est tentée
  — **une seule fois**. Une boucle de bascule serait un scintillement et une
  consommation inutiles.
- Si cette seconde tentative échoue, la première session est **conservée** : une
  caméra frontale vaut mieux qu'un écran noir, et l'appelant le sait par
  `facingModeObtenu`.
- **Aucune question n'est jamais posée à l'utilisateur** (« avant / arrière »).
- `arreterCamera` utilise `getTracks()` (pas `getVideoTracks()`), est
  **idempotente**, encapsule chaque `stop()` dans un `try` — une piste déjà
  arrêtée ne doit pas empêcher d'arrêter les suivantes — et est branchée sur
  **six sorties** : détection, bouton fermer, changement de moteur, erreur
  critique, démontage, fermeture d'écran.
- Les motifs d'échec sont **distingués** (`permission_refusee`, `aucune_camera`,
  `camera_occupee`, `contrainte_impossible`, `contexte_non_securise`, `inconnu`)
  et lus sur `error.name` — jamais sur `error.message`, qui change d'un
  navigateur à l'autre.

### 2.2 GTIN — déplacé, pas dupliqué

`normaliserGtin` / `gtinEstValide` / `exigerGtin` vivaient dans
`lib/open-food-facts/contrat.ts`. Le scanner en a besoin **dans le navigateur**,
et importer `contrat.ts` côté client ferait entrer les adresses d'API d'Open
Food Facts dans le bundle — ce que trois garde-fous interdisent depuis A3.

Elles sont donc dans `lib/scan/gtin.ts`, et **`contrat.ts` les réexporte** : il
n'existe qu'une seule règle de GTIN dans le dépôt.

Ajout : **`lireGtin` — version NON levante**, pour la boucle de scan. Une caméra
passe devant des codes de rayon, des Code 128 de logistique, des QR de
promotion : les lire est normal, lever une exception trente fois par seconde
ferait de l'ordinaire un incident.

⚠️ **Défaut trouvé pendant le déplacement** : après le déplacement, `estOffErreur`
rendait `false` sur un `GtinInvalide`, et la route de lookup aurait répondu
**503 au lieu de 400**. Corrigé par un `exigerGtin` traducteur dans `contrat.ts`,
qui relève l'erreur dans le vocabulaire fermé d'A3 (`INVALID_GTIN`).

### 2.3 La boucle — trois règles, aucune facultative

1. **Jamais deux décodages concurrents.** Une image arrivée pendant un décodage
   est **sautée**, pas mise en file : une file sur un flux vidéo ne se vide
   jamais, elle grandit, et on finit par décoder des images vieilles de plusieurs
   secondes.
2. **Le verrou est posé AVANT le retour.** Dès qu'un GTIN valide sort, plus une
   image n'est décodée. Un code reste visible une vingtaine d'images : sans
   verrou, ce sont vingt appels à `/api/food-products/{gtin}`.
3. **Une lecture rejetée n'arrête rien.** Le scan continue.

Cadence : **8 tentatives par seconde** (`INTERVALLE_MS = 125`). C'est une
**hypothèse à mesurer**, pas une vérité — le banc d'essai compte les images
décodées pour permettre de la comparer.

Formats : **quatre, et pas un de plus** — `ean_13`, `ean_8`, `upc_a`, `upc_e`.
**ITF-14 est volontairement exclu** : c'est un code de carton de regroupement,
pas d'unité consommateur ; le rendre lisible ferait scanner des palettes, avec
un chiffre indicateur différent — donc un autre produit chez Open Food Facts.

---

## 3. Les deux candidats — installés TEMPORAIREMENT

| | `zxing-wasm@3.1.2` | `@zxing/library@0.23.0` |
|---|---|---|
| Nature | ZXing-C++ compilé en WebAssembly | portage TypeScript pur |
| Licence | MIT | Apache-2.0 |
| Sous-chemin utilisé | `/reader` (ni encodeur, ni build « full ») | — |

⚠️ **Le perdant doit sortir de `package.json` et du lockfile avant le commit
final de la phase 2** (§8 de la spécification). Son adaptateur disparaîtra avec
lui.

`BarcodeDetector` natif reste **interdit tree-wide** comme moteur : il est banni
par un contrôle automatique (`A3-OFF-SUP`), banc d'essai compris.

---

## 4. §12 — LE `.wasm` EST SERVI PAR NOTRE DÉPLOIEMENT

### 4.1 Ce que fait la bibliothèque si on ne lui dit rien

`zxing-wasm@3.1.2` embarque un `locateFile` par défaut, relevé dans
`dist/es/share.js` :

```js
locateFile: (e, t) => {
  const n = e.match(/_(.+?)\.wasm$/);
  return n ? `https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.2/dist/${n[1]}/${e}` : t + e;
}
```

Autrement dit : **par défaut, ouvrir le scanner déclenche un appel réseau vers
jsDelivr**, depuis le téléphone de l'élève. Trois raisons de refuser :

1. **La CSP.** `connect-src` n'autorise que `'self'`, Supabase, Stripe et Vercel.
   Elle est en Report-Only aujourd'hui ; le jour du passage en mode bloquant
   (procédure écrite en fin de `next.config.ts`), le scanner cesserait de
   fonctionner, sans autre symptôme qu'un écran qui ne décode rien.
2. **La disponibilité.** Une panne de CDN deviendrait une panne de scanner, sur
   un chemin que nous ne déployons ni ne surveillons.
3. **La vie privée.** Chaque ouverture révélerait l'IP de l'élève à un tiers.

### 4.2 Ce qui a été fait

```ts
const URL_WASM_LECTEUR = new URL("zxing-wasm/reader/zxing_reader.wasm", import.meta.url).href;
const SURCHARGES_WASM = { locateFile: (f, p) => (f.endsWith(".wasm") ? URL_WASM_LECTEUR : p + f) };
```

Le bundler reprend l'expression : le `.wasm` est **copié dans
`/_next/static/media/`** avec une empreinte de contenu, et l'expression est
remplacée à la compilation par ce chemin.

Cette solution a été **préférée à une copie dans `public/`** parce qu'elle rend
trois choses gratuitement :

- **même origine** — `connect-src 'self'` suffit, la CSP n'a pas à bouger ;
- **empreinte de contenu** — Next sert `/_next/static/` en `immutable` ;
- **le Service Worker le met déjà en cache** — sa règle `cacheDAbord` couvre
  `/_next/static/`, et **rien n'a eu à y être modifié**.

L'objet de surcharges est construit **une seule fois, au niveau du module** :
`prepareZXingModule` compare les surcharges par égalité de surface, et un
littéral reconstruit à chaque appel réinstancierait le WebAssembly à chaque
ouverture du scanner.

### 4.3 Ce qui a été MESURÉ (et non supposé)

Build de production réel (`next build`, Turbopack), puis `next start`, puis
navigateur Chromium piloté :

| Vérification | Résultat mesuré |
|---|---|
| Le `.wasm` est émis par le build | `.next/static/media/zxing_reader.0g-qr2_sqw379.wasm`, 1 065 866 o |
| Chemin demandé au runtime | `/_next/static/media/zxing_reader.0g-qr2_sqw379.wasm` — **même origine** |
| Statut | `200` |
| `Content-Type` | **`application/wasm`** → le chemin rapide `WebAssembly.instantiateStreaming` fonctionne |
| `Cache-Control` | `public, max-age=31536000, immutable` |
| `Permissions-Policy` | `camera=(self)` — déjà permissif, **rien à changer** |
| Appels à jsDelivr | **zéro** |
| Violation CSP | **aucune** |
| Service Worker | **non modifié** ; la règle `/_next/static/` le couvre |

**Contrôle négatif décisif (N12).** Surcharges retirées, rebuild complet, même
navigateur : la console rapporte, mot pour mot —

> `[Report Only] Refused to connect to 'https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.2/dist/reader/zxing_reader.wasm' because it violates the following Content Security Policy directive: "connect-src 'self' …"`

— et l'écran passe à l'état `erreur`, sans GTIN. La CSP actuelle **rapporte déjà**
ce que le mode bloquant **refuserait**.

### 4.4 Un point pour plus tard, pas pour maintenant

`script-src` contient aujourd'hui `'unsafe-eval'`, ce qui autorise la
compilation WebAssembly. **Le jour où la CSP sera resserrée** (retrait de
`'unsafe-eval'` avec des nonces), il faudra ajouter **`'wasm-unsafe-eval'`**,
sinon le scanner cassera. Rien n'a été modifié dans `next.config.ts` — c'est
hors périmètre de cette phase, et rien n'est cassé aujourd'hui.

---

## 5. Poids réels, mesurés sur le build de production

| Ressource | Brut | gzip -9 | **brotli -11** |
|---|---:|---:|---:|
| `zxing_reader.wasm` | 1 065 866 | 448 801 | **349 529** |
| glue `zxing-wasm` | 36 641 | 12 618 | **11 393** |
| **Total candidat A** | **1 102 507** | **461 419** | **≈ 361 Ko** |
| portage `@zxing/library` | 456 229 | 119 348 | **90 104** |
| **Total candidat B** | **456 229** | **119 348** | **≈ 90 Ko** |
| adaptateurs + runtime partagé | 11 045 | 4 439 | ≈ 4 Ko |

**Le candidat A pèse environ quatre fois plus au premier scan.** Ce n'est pas un
argument suffisant à lui seul : un décodage plus fiable en basse lumière vaut
250 Ko une fois par version. C'est précisément ce que le benchmark iPhone doit
départager.

### 5.1 Chargement paresseux — prouvé sur le manifeste

Les quatre chunks contenant `zxing` (445,5 / 35,8 / 9,0 / 1,8 Ko) sont
**référencés par AUCUNE page et pas par `rootMainFiles`** (6 fichiers, 446,7 Ko).
Ils ne sont atteints que par `import()` dynamique. Un élève qui n'ouvre jamais le
scanner n'en télécharge pas un octet.

---

## 6. Preuve d'exécution en navigateur (hors iPhone)

Une image EAN-13 a été **synthétisée** (encodeur pur, 95 modules, tables L/G/R et
parité du premier chiffre), rendue en vidéo Y4M, et injectée comme **fausse
caméra** dans Chromium (`--use-file-for-fake-video-capture`), contre le **build de
production** servi par `next start`.

| | `zxing-wasm` | `zxing-js` |
|---|---|---|
| GTIN lu | `3017620422003` | `3017620422003` |
| Format rendu | `ean_13` | `ean_13` |
| Images décodées avant verrouillage | 1 | 1 |
| Lectures rejetées | 0 | 0 |
| Requêtes réseau du moteur | 1 (le `.wasm`, même origine) | 0 |

Les deux moteurs décodent également les cinq GTIN réels testés hors navigateur
(Nutella, Coca-Cola, Nutella IT, Petit Beurre, Milka) — texte **et** validité de
la clé de contrôle.

⚠️ **Ces chiffres ne remplacent PAS le benchmark iPhone.** Une fausse caméra sert
une image parfaite, nette, immobile et parfaitement éclairée. Elle prouve que la
chaîne fonctionne ; elle ne dit rien de la vitesse ni de la robustesse sur un
capteur réel, en biais, dans un rayon de supermarché.

---

## 7. Défauts trouvés et corrigés pendant la phase

1. **Appel CDN par défaut** (§4) — corrigé, prouvé par contrôle négatif.
2. **`format` mal traduit.** `zxing-wasm` **accepte** `"EAN-13"` en entrée mais
   **renvoie** `"EAN13"` (sans tiret) — mesuré en décodant cinq EAN-13 de
   synthèse. La table de retour ne connaissait que la forme à tiret : le
   vocabulaire brut de la bibliothèque serait remonté jusqu'à l'écran. Les deux
   orthographes sont désormais traduites, et l'aller-retour est éprouvé.
3. **Interopérabilité CJS/ESM de `@zxing/library`.** Le paquet n'a pas de champ
   `exports` : un bundler prend le build ES (exportations nommées présentes),
   Node prend le CommonJS où `MultiFormatReader` n'est accessible que sous
   `default`. Sans traitement, `new MultiFormatReader()` lève
   « is not a constructor » — mesuré. Traité.
4. **API dépréciée.** `readBarcodesFromImageData` est marquée dépréciée dans la
   version installée ; remplacée par `readBarcodes`, entrée identique.
5. **`GtinInvalide` traduite trop tard** (§2.2) — 503 au lieu de 400. Corrigé.
6. **Garde-fou A3 devenu faux** (§8.2).

---

## 8. Tests

### 8.1 Harnais `npm run test:aliments-a4-scan` — **26/26**

`A4-SCAN1..20` + `REAR1..5` couvrant : aucune permission avant action, contrainte
arrière, frontale jamais choisie volontairement, motifs d'échec distingués,
seconde acquisition unique, GTIN chaîne et zéros de tête, lecture rejetée sans
lookup, verrou, non-concurrence, arrêt de toutes les pistes, six sorties d'arrêt,
aucune image ne quitte l'appareil, chargement paresseux, frontière avec A3.

Ajoutés en §12 : hébergement du `.wasm`, stabilité des surcharges, traduction des
formats, interopérabilité CJS/ESM.

### 8.2 Le garde-fou A3 qui est devenu faux — et pourquoi il n'a pas été supprimé

`A3-OFF-SUP` interdisait le mot `ZXing` dans **tout** l'arbre : juste tant que le
scanner n'existait pas, faux dès qu'A4 phase 2 l'a construit avec autorisation
explicite. **Quatrième occurrence du même motif** dans ce projet : le contrôle
parlait de l'arbre entier pour décrire le périmètre d'une phase.

La garantie n'a pas été abandonnée, elle a été **resserrée** : un décodeur n'a le
droit d'exister que dans `lib/scan/**` et le banc d'essai temporaire.
`BarcodeDetector` et `cgi/search.pl` restent interdits **partout**, banc d'essai
compris. Quatre contrôles négatifs vérifient que le resserrement n'a rien vidé.

### 8.3 Contrôles négatifs — 16, tous discriminants, tous restaurés

| | Sabotage | Rouges attendus | Constaté |
|---|---|---|---|
| N1 | caméra frontale demandée | `A4-SCAN2/REAR1`, `A4-SCAN3/REAR2` | rouge |
| N2 | verrou retiré | `A4-SCAN8`, `A4-SCAN9/10` | rouge |
| N3 | décodages concurrents autorisés | `A4-SCAN14` | rouge |
| N4 | une piste oubliée à l'arrêt | `A4-SCAN11/REAR5` | rouge |
| N5 | import statique du moteur | `A4-SCAN16` | rouge |
| N6 | `Number(gtin)` | `A4-SCAN6`, `A4-SCAN7` | rouge |
| N7 | image envoyée au réseau | `A4-SCAN15` | rouge |
| N8 | surcharges `locateFile` retirées | 2 tests §12 | rouge |
| N9 | orthographe canonique retirée de la table | traduction des formats | rouge |
| N10 | interop CJS/ESM retirée | interop | rouge |
| N11 | URL de CDN réintroduite dans le code | §12 | rouge |
| **N12** | **surcharges retirées, en NAVIGATEUR** | **appel jsDelivr + violation CSP + état `erreur`** | **constaté** |
| N13 | décodeur ZXing dans un écran d'élève | `A3-OFF-SUP` | rouge |
| N14 | `BarcodeDetector` dans la couche de scan | `A3-OFF-SUP` | rouge |
| N15 | `cgi/search.pl` dans la couche de scan | `A3-OFF-SUP` | rouge |
| N16 | ZXing **dans** la couche de scan | doit rester **vert** | vert |

⚠️ **Piège récurrent, sixième occurrence.** Les assertions « le mot X ne doit pas
apparaître » échouent sur la prose qui énonce la règle : les commentaires du §4
nomment `fastly.jsdelivr.net` pour expliquer pourquoi on le refuse. Le décapage
(`sansProse`) est systématique, **et un contrôle négatif prouve qu'il n'a pas
vidé le fichier** — sinon l'assertion passerait sur du vide.

---

## 9. Non-régression, outillage, dépôt

| | Résultat |
|---|---|
| Batterie complète | **89 suites, 2 072 tests verts, 31 rouges** |
| `tsc --noEmit` | **0 erreur** |
| `eslint` (arbre entier) | **0 erreur, 0 avertissement** |
| `git diff --check` | **propre** |
| `git status --short` | 4 modifiés, 4 non suivis — **exactement le delta A4 phase 2** |

### 9.1 Les 31 rouges — tous antérieurs, prouvés par exécution

- **24 rouges / 7 suites** — la baseline documentée en phase 4.1, prouvée rouge
  au commit `3ed5cfa` : `account-activation-provisioning` (16),
  `training-movement-patterns` (3), `previous-performance`, `set-rpe-feedback`,
  `prescribed-rpe`, `student-training-ui`, `student-feedback-video` (1 chacun).
- **7 rouges / 1 suite — `webhook-idempotency`, nouveaux dans le relevé mais pas
  dans le code.** Cause : `TypeError: supabase.rpc is not a function` — le faux
  client du harnais n'expose pas `.rpc`, que `cloneIndividualProgramCopy` appelle.
  **Prouvé antérieur par exécution** : la même suite, lancée sur l'instantané
  `/root/tete` (antérieur à A3 phase 4, donc bien avant A4), échoue sur les
  **sept mêmes tests**. Sans rapport avec A4 ; **non corrigé, car hors périmètre**.

**Aucune nouvelle régression.**

### 9.2 Une dérive de miroir, pas un défaut du dépôt

Le build en conteneur rend deux 404 sur `/brand/logo/logo-complet-blanc.svg`. Le
fichier **existe bien sur le Mac** (`public/brand/logo/logo-complet-blanc.svg`,
5 034 o) : c'est le miroir du conteneur qui ne contient pas `public/brand/`. Rien
à corriger.

### 9.3 Fichiers transférés — vérifiés octet pour octet

11 fichiers, MD5 identiques des deux côtés :
`lib/scan/{gtin,camera,moteur,adaptateurs}.ts`,
`app/dev/scan-benchmark/page.tsx`, `components/dev/BancDEssaiScan.tsx`,
`scripts/tests/aliments-a4-scan.mts`, `scripts/tests/aliments-a3-off.mts`,
`lib/open-food-facts/contrat.ts`, `package.json`, `package-lock.json`.

---

## 10. Le banc d'essai

`/dev/scan-benchmark`, rendu **404** sauf si `NEXT_PUBLIC_A4_BENCH=1` (ou en
développement). Le drapeau est explicite, et non `NODE_ENV`, parce qu'une Preview
Vercel est construite en `NODE_ENV=production` : s'y fier rendrait la page
invisible là où on veut précisément la tester.

Il **mesure**, il n'ajoute rien au journal : aucun appel à `/api/food-products`,
aucune RPC, aucune écriture. Le GTIN lu est **affiché puis oublié**.

Il relève : chargement du moteur (ms), caméra prête (ms), **premier code valide
(ms)**, format, GTIN, `facingMode` réellement obtenu, seconde acquisition oui/non,
torche exposée oui/non, images décodées, lectures rejetées.

---

## 11. À FAIRE AVANT LE BENCHMARK

1. **`npm install`** sur le Mac — les deux paquets sont dans `package.json` et le
   lockfile, mais pas encore dans `node_modules`.
2. Déployer une **Preview Vercel** avec `NEXT_PUBLIC_A4_BENCH=1` **sur
   l'environnement Preview uniquement**.
3. Ouvrir `/dev/scan-benchmark` **sur iPhone, en HTTPS** (`getUserMedia` exige un
   contexte sécurisé).

---

## 12. PROTOCOLE DU BENCHMARK iPhone

Pour **chaque** des 5 produits, et pour **chacun** des 2 moteurs (10 mesures par
condition) :

| Condition | Ce qu'on cherche |
|---|---|
| Lumière normale, code à plat | le cas nominal |
| Faible lumière | la robustesse du binariseur |
| Code courbé (bouteille, sachet) | la déformation |
| Angle ~30° | la tolérance de perspective |
| Reflet / emballage brillant | le vrai tueur de scan en rayon |

Relever, pour chaque essai : **premier code valide (ms)**, images décodées,
lectures rejetées, et **si le code n'est jamais lu**, le noter comme échec.

Vérifier aussi, une fois par moteur :

- la caméra **arrière** s'ouvre sans question posée (`facingMode obtenu`) ;
- fermer la feuille **éteint le voyant** de la caméra ;
- le téléphone ne chauffe pas anormalement après 60 s de scan continu ;
- le premier chargement du `.wasm` sur réseau mobile (une fois, puis
  `immutable`).

---

## 13. ⏸ DÉCISION EN ATTENTE — je ne choisis pas le moteur

La phase 2 s'arrête ici, conformément au §22 : *« Arrête-toi avant de choisir
définitivement le moteur si le benchmark physique n'a pas encore été fait. »*

Ce que la phase 2 a établi, et qui n'est **pas** un choix :

- les deux candidats décodent correctement, derrière la **même** interface ;
- le candidat A coûte **≈ 361 Ko** au premier scan, le candidat B **≈ 90 Ko** ;
- si le candidat A gagne, **son `.wasm` est déjà servi par notre déploiement**,
  prouvé en build de production, sans toucher ni la CSP ni le Service Worker ;
- basculer d'un candidat à l'autre ne touche **aucune** ligne hors
  `adaptateurs.ts`.

**Attendu de Jules :** les mesures des 5 produits × 5 conditions × 2 moteurs.
Sur cette base, le moteur sera choisi, le perdant retiré de `package.json` et du
lockfile, son adaptateur supprimé, et la phase 3 (écran de scan définitif dans
`AddFoodSheet`) pourra commencer.
