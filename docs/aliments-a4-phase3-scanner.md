# ALIMENTS A4 — PHASE 3 : moteur définitif + scanner dans `AddFoodSheet`

**État : livré, non commité.** Moteur retenu : **`zxing-wasm`**, sur benchmark iPhone
physique. En attente de la Preview et du test terrain (§26 de la spécification).

---

## 1. La dépendance supprimée

`@zxing/library@0.23.0` — retirée **partout** :

| Endroit | Avant | Après |
|---|---|---|
| `package.json` → `dependencies` | présent | **absent** |
| `package-lock.json` | 3 entrées | **0 occurrence** |
| `node_modules/` | installé | **purgé** (`npm install` a retiré 3 paquets) |
| `npm ls @zxing/library` | résolu | **`(empty)`** |
| `lib/scan/adaptateurs.ts` | `fabriquerMoteurJs`, `FABRIQUES` | **supprimés** |
| `lib/scan/moteur.ts` | `MOTEURS`, `NomMoteur`, `chargerMoteur`, `DependancesMoteur` | **supprimés**, remplacés par `NOM_MOTEUR` |
| Build `.next` | chunk de 456 Ko | **aucune trace** — recherche de `@zxing/library` et `MultiFormatReader` dans tous les chunks : **False** |

Le test d'interopérabilité CJS/ESM qui n'existait que pour ce candidat a été supprimé
avec lui. Le contrôle négatif N17 (remettre la dépendance dans `package.json`) rend
`A4-UI6` rouge.

⚠️ **Sur ton Mac, lance `npm install`** : le lockfile ne mentionne plus le paquet, mais
`node_modules/@zxing/` y est encore.

---

## 2. Le moteur final

`zxing-wasm@3.1.2` (MIT), sous-chemin `/reader` — ni encodeur, ni build « full ».

**L'interface `MoteurScan` survit au benchmark, et c'est délibéré.** Elle a été écrite
en phase 2 pour que le choix reste ouvert ; le choix est fait, mais ce qu'elle protège
n'a pas disparu : la boucle, la caméra et l'écran ne connaissent qu'un `MoteurScan`, et
changer de décodeur un jour ne toucherait toujours qu'`adaptateurs.ts`. Le coût est de
douze lignes.

---

## 3. Les fichiers de benchmark supprimés

| Fichier | Sort |
|---|---|
| `app/dev/scan-benchmark/page.tsx` | supprimé |
| `components/dev/BancDEssaiScan.tsx` | supprimé |
| sélection de moteur (`zxing-wasm` / `zxing-js`) | supprimée |
| tableau de mesures (chargement, ms, images décodées, `facingMode`, torche, GTIN) | supprimé |
| `NEXT_PUBLIC_A4_BENCH` | **0 occurrence** dans le produit |

Aucun helper du banc n'a été conservé : les seules parties utiles — l'arrêt centralisé,
la boucle, les motifs d'échec — vivaient déjà dans `lib/scan/`, pas dans le banc.

**§25 — la variable peut être supprimée de Vercel Preview**, et n'est remplacée par
aucune variable de production. Les tests `A4-UI6` la vérifient absente du code.

Sur ton Mac, `device_bash` ne peut pas supprimer : les deux fichiers ont été **déplacés**
dans `_to_delete/a4-banc-essai/`. Git les voit comme supprimés (` D` dans `git status`) ;
tu peux jeter le dossier `_to_delete/`.

---

## 4. L'intégration dans `AddFoodSheet`

**Pas de troisième onglet** — confirmé et éprouvé (`A4-UI1` compte `role="tab"` : deux).

```
Ajouter un aliment
├─ RECHERCHER  ← onglet actif
│   [ Rechercher un aliment            ]   ← champ, inchangé
│   [ ⌗ SCANNER UN CODE-BARRES         ]   ← nouveau, juste sous le champ
│   Aliments / Produits …                  ← liste, inchangée
│   [ Rechercher aussi les produits    ]   ← action externe A3, inchangée
│   [ Saisir un aliment à la main      ]
└─ SAISIR À LA MAIN                        ← inchangé
```

Le scan est **une méthode de recherche**, pas une troisième façon d'ajouter : il aboutit
exactement au même endroit — la fiche produit et son étape quantité.

Nouveaux modules :

| Fichier | Rôle |
|---|---|
| `components/student/ScannerCodeBarres.tsx` | l'écran caméra, et rien d'autre |
| `lib/scan/parcours.ts` | messages et portes de sortie — **fonctions pures, éprouvables** |
| `lib/nutrition/produits-client.ts` → `lireProduitParGtin` | le lookup A3 **avec son motif** |

---

## 5. L'UX du scanner

```
┌───────────────────────────────┐   Scanner un code-barres      [× Fermer]
│                               │
│         CAMÉRA EN DIRECT      │   ┌─────────────────────┐  ← cadre de visée
│                               │   └─────────────────────┘     horizontal
└───────────────────────────────┘
        Place le code-barres dans le cadre.
        [ 🔦 Allumer la lampe ]   ← seulement si la piste l'expose
```

**Ce qui n'est JAMAIS montré** : nom du moteur, images par seconde, images décodées,
`facingMode`, temps de chargement, et **pas même le GTIN lu**. Éprouvé par `A4-UI-SUP §7`,
qui dépouille le balisage HTML et cherche toute mesure chiffrée
(`/\d+\s*(ms|fps|Ko|Mo)\b/`).

**Le cadre est VISUEL, et seulement visuel** (§8). Aucun recadrage avant décodage :
`getImageData(0, 0, toile.width, toile.height)` — l'image entière. Le benchmark iPhone a
lu les codes en plein cadre ; rogner ferait perdre les codes légèrement décalés sans rien
accélérer de démontré. `pointer-events-none` et `aria-hidden` : il n'intercepte rien et
n'est pas lu par les lecteurs d'écran.

**Deux taps avant la caméra, et c'est voulu.** Ouvrir l'écran ne demande rien ; la
permission n'arrive qu'au tap sur « Ouvrir la caméra ». On aurait pu interroger
`navigator.permissions` pour ouvrir tout seul quand l'autorisation est déjà accordée —
Safari ne répond pas pour la caméra, la branche ne serait vraie que sur une partie des
appareils, et elle serait invérifiable par nos harnais. Un tap de plus, toujours le même
comportement, et une garantie qui se prouve.

---

## 6. Le cycle de vie de la caméra

Une seule fonction, `toutArrêter()`, et **l'ordre y compte** : la minuterie d'abord, les
pistes ensuite. L'inverse laisserait passer un dernier tour de boucle sur une piste morte
— c'est éprouvé par une assertion d'ordre, pas par un commentaire.

Elle coupe : la cadence (`clearInterval`), toutes les pistes (`arreterCamera`, qui
utilise `getTracks()` et non `getVideoTracks()`), l'élément vidéo (`srcObject = null`) et
le moteur (`detruire()` → `purgeZXingModule`).

Elle est appelée depuis **six sorties** : détection d'un GTIN, bouton « Fermer », échec
d'ouverture, échec de chargement du moteur, changement de vue, et **démontage**.

⚠️ **Le démontage est le rempart qui ne peut pas être oublié.** Le scanner n'est monté que
quand il est ouvert : fermer la feuille entière, changer d'onglet ou naviguer le démonte,
et son `useEffect` de nettoyage tourne. Il n'y a donc **pas de liste de sorties à tenir à
jour** — c'est la structure qui garantit l'arrêt, pas la vigilance.

**Réouverture (§20)** : `key={sessionScan}`, un compteur incrémenté à chaque ouverture.
React démonte l'ancien composant — donc son nettoyage tourne — et en monte un **neuf**.
Flux, moteur, verrou, erreur : tout repart de zéro **par construction**, sans une seule
ligne de remise à zéro à écrire ni à oublier.

---

## 7. La torche

Proposée **uniquement** si `track.getCapabilities().torch === true`, interrogé sur la
piste réellement obtenue — pas déduit de la plateforme. Ton test iPhone l'a vue exposée.

`basculerTorche` isole le `as never` nécessaire (`torch` n'est pas dans le type
`MediaTrackConstraintSet` de TypeScript) sur **une seule ligne**, et rend `false` sans
rien casser si la piste refuse. Dans ce cas **l'état n'est pas modifié** : un bouton qui
s'allume alors que la lampe reste éteinte ferait douter de tout le reste de l'écran.

Le scan ne dépend jamais de la lampe — éprouvé : la boucle de décodage ne lit pas une
seule fois `torche`. À la fermeture, aucun état de torche n'est maintenu : les pistes sont
rendues, la lampe s'éteint avec elles.

---

## 8. Le pipeline scanner → A3

```
image caméra
  → canvas → getImageData          (en mémoire, jamais transmise)
  → MoteurScan.decoder             (zxing-wasm, WebAssembly local)
  → rawValue : string
  → lireGtin  (normaliseur A3)
      ├─ invalide → le scan CONTINUE          (code de rayon, Code 128 logistique…)
      └─ valide   → VERROU posé immédiatement
                    → toutArrêter()  (cadence + pistes + vidéo + moteur)
                    → onGtin(gtin)
                        → setScanOuvert(false)   ← le scanner est DÉMONTÉ
                        → lireProduitParGtin(gtin)
                            → GET /api/food-products/{gtin}      ← UN seul appel
```

**Le verrou est posé avant le fetch**, et le scanner est démonté avant lui : un code
visible pendant trente images donne **un** lookup. Deux barrières indépendantes, pas une.

**Le scanner ne connaît pas Open Food Facts** — éprouvé : ni « openfoodfacts », ni
« api/v3 », ni « search-a-licious », ni « food_products » dans son source. Il produit un
GTIN ; la route d'A3 fait le reste.

### Les trois issues, et trois gestes différents

`hydraterProduit` rendait `null` pour tout échec. C'était suffisant tant que l'appelant
venait de **taper** sur un produit déjà affiché. Après un **scan**, l'élève est debout
devant un rayon et les confondre l'enverrait réessayer indéfiniment un produit qui
n'existe pas. Le motif est donc remonté par `lireProduitParGtin` — en lisant le **code
métier** de notre route, jamais le statut HTTP.

| Réponse A3 | Message | Actions, dans cet ordre |
|---|---|---|
| `PRODUCT_NOT_FOUND` | Produit introuvable. | Scanner un autre · Rechercher par nom · Saisir à la main |
| `PRODUCT_NUTRITION_INCOMPLETE` | Données nutritionnelles insuffisantes pour ce produit. | **Saisir à la main** · Scanner un autre · Rechercher par nom |
| tout le reste (429, 503, 502, 401, réseau) | Impossible de récupérer ce produit pour le moment. | Scanner un autre · Rechercher par nom · Saisir à la main |

L'ordre est une décision : pour un produit dont les valeurs manquent, l'emballage est
dans la main de l'élève, et rescanner le même code redonnerait exactement la même réponse.

**Aucune macro inconnue n'est remplacée par 0** : le produit n'est simplement pas
consommable par ce chemin. Le contrôle négatif N24 le prouve.

### La caméra

| Motif | Message | Actions |
|---|---|---|
| `NotAllowedError` | Accès à la caméra refusé. | Réessayer · Rechercher · Saisir |
| `NotFoundError` | Aucune caméra disponible. | Rechercher · Saisir |
| `NotReadableError` | La caméra n'est pas disponible pour le moment. | Réessayer · Rechercher · Saisir |
| `OverconstrainedError` | La caméra n'a pas pu démarrer avec les réglages demandés. | Réessayer · Rechercher · Saisir |
| `SecurityError` | Le scanner a besoin d'une connexion sécurisée. | Rechercher · Saisir |
| autre | La caméra n'a pas pu démarrer. | Réessayer · Rechercher · Saisir |

**« Réessayer » est un bouton, jamais une relance automatique.** Redemander la permission
tout seul transformerait un refus en harcèlement, et certains navigateurs finissent par
bloquer définitivement le site qui insiste — éprouvé : aucun `setTimeout`, aucune boucle,
aucun effet ne relance l'ouverture.

Il n'apparaît pas là où il serait un mensonge : sans caméra, l'appareil n'en aura pas plus
au second essai.

**Aucun cul-de-sac, prouvé par balayage EXHAUSTIF** : pour les six motifs de caméra et les
trois échecs de lookup, `recherche` et `manuel` sont toujours offerts. **Aucune fuite
technique** non plus : les quinze messages sont balayés contre `429`, `503`, `404`, `422`,
`OFF`, `Open Food Facts`, `timeout`, `Error`, `getUserMedia`, `GTIN`, `fetch`, `wasm`.

---

## 9. `A4-SCAN` — **25/25**

Les 26 tests de phase 2, moins celui d'interopérabilité qui n'existait que pour le
candidat écarté. Les assertions qui lisaient le banc d'essai ont été **repointées sur
l'écran de production** — même exigence, sur le fichier qui compte désormais.

Couvre : aucune permission avant action, caméra arrière, frontale jamais choisie, motifs
distingués, seconde acquisition unique, GTIN chaîne et zéros de tête, lecture rejetée sans
lookup, verrou, non-concurrence, arrêt de toutes les pistes, six sorties, aucune image
transmise, chargement paresseux, `.wasm` same-origin, stabilité des surcharges, traduction
des formats.

## 10. `A4-UI` — **30/30** (`npm run test:aliments-a4-ui`)

Les 25 tests demandés au §22, plus cinq suppléments.

| | |
|---|---|
| A4-UI1 | bouton Scanner visible dans Rechercher, **deux onglets** |
| A4-UI2 | aucune permission avant tap (rendu + trois preuves de code) |
| A4-UI3 | le tap monte la vue caméra, avec son bouton volontaire |
| A4-UI4 | caméra `environment`, aucun sélecteur, aucune contrainte maison |
| A4-UI5 | `zxing-wasm` en `import()` dynamique, la feuille ne le nomme pas |
| A4-UI6 | plus aucune trace de `@zxing/library` — `package.json`, lockfile, code |
| A4-UI7 | un GTIN valide → **un** lookup, et c'est `/api/food-products/{gtin}` |
| A4-UI8 | double détection → **un** lookup |
| A4-UI9 | pistes arrêtées **avant** le lookup |
| A4-UI10 | produit trouvé → l'étape quantité **d'A3**, pas une seconde interface |
| A4-UI11/12 | unité `g` et unité `ml` respectées, et elles seules proposées |
| A4-UI13 | produit absent → trois portes de sortie |
| A4-UI14 | produit incomplet → **saisie manuelle en premier**, aucune macro à 0 |
| A4-UI15 | permission refusée → recherche et saisie préservées, aucune relance auto |
| A4-UI16/17 | fermer le scanner, ou la feuille, coupe la caméra (+ ordre d'arrêt) |
| A4-UI18 | réouverture propre par remontage (`key={sessionScan}`) |
| A4-UI19 | lampe seulement si la capacité est exposée, et le scan n'en dépend pas |
| A4-UI20 | aucune image ne quitte l'appareil |
| A4-UI21 | recherche texte A3 intacte, **et la frappe ne parle toujours à personne** |
| A4-UI22 | saisie manuelle A2 intacte, aucune densité |
| A4-UI23 | le produit scanné passe par `ajouter_aliment_produit` — **un seul chemin** |
| A4-UI24 | la RPC reçoit exactement `p_consumed_meal_id`, `p_product_id`, `p_quantity`, `p_unit` |
| A4-UI25 | rien n'est gardé côté client — ni `localStorage`, ni `sessionStorage`, ni `indexedDB` |
| SUP §7 | aucun chiffre technique à l'écran |
| SUP §8 | cadre visuel, aucun recadrage |
| SUP §21 | `playsInline`, `muted`, aucune largeur fixe, hauteur bornée, cibles 48 px |
| SUP | aucun cul-de-sac, aucune fuite technique (balayage exhaustif) |
| SUP | le dépouillement des commentaires n'a rien vidé |

⚠️ **Deux pièges rencontrés en écrivant ce harnais, tous deux de la même famille.**

1. Chercher `« ms »` dans le HTML rendu le trouve dans `items-center` et
   `transition-colors` : l'assertion serait rouge sans qu'aucun chiffre ne soit montré à
   personne. Corrigé en lisant le **texte** (balises retirées) et en cherchant une mesure
   chiffrée, pas deux lettres.
2. La fenêtre de 120 caractères après `useEffect(` attrapait la déclaration
   `async function ouvrir()` qui suit. Corrigé en découpant l'instruction exacte.

Ce sont les 7ᵉ et 8ᵉ occurrences du même motif dans ce projet : **une assertion « le mot X
ne doit pas apparaître » trouve X ailleurs que là où on le cherche.** Tout dépouillement
est désormais systématiquement doublé d'un contrôle négatif prouvant qu'il n'a rien vidé.

---

## 11. Contrôles négatifs — 8, tous discriminants, tous restaurés

| | Sabotage | Rouges attendus | Constaté |
|---|---|---|---|
| N17 | `@zxing/library` remis dans `package.json` | A4-UI6 | **A4-UI 1 rouge** |
| N18 | surcharges `locateFile` retirées (retour jsDelivr) | §12 | **A4-SCAN 2 rouges** |
| N19 | `facingMode: { ideal: "user" }` | A4-SCAN2/3 · REAR1/2 | **A4-SCAN 2 rouges** |
| N20 | vue scanner laissée montée pendant le lookup | A4-UI8 | **A4-UI 1 rouge** |
| N21 | `toutArrêter()` retiré à la détection | A4-UI9, A4-SCAN12/13 | **A4-UI 1 + A4-SCAN 1** |
| N22 | `fetch("/api/telemetrie", { body: toile.toDataURL() })` | A4-UI20, A4-SCAN15 | **A4-UI 1 + A4-SCAN 1** |
| N23 | `Number(gtin)` dans le normaliseur | A4-SCAN6/7 | **A4-UI 1 + A4-SCAN 2 + A3-OFF 1** |
| N24 | `PRODUCT_NUTRITION_INCOMPLETE` fondu dans « indisponible » | A4-UI14 | **A4-UI 1 rouge** |

Restauration vérifiée par `diff -r` sur `lib/scan/`, `AddFoodSheet.tsx`,
`ScannerCodeBarres.tsx`, `package.json` et le lockfile : **identiques**.

---

## 12. Le bundle final

Mesuré sur un `next build` de production, `.next` effacé au préalable.

**Chemin initial de l'écran nutrition — `nutrition/[planId]` :**

| | |
|---|---|
| chunks client | **11** |
| poids brut | **632,0 Ko** |
| poids brotli | **153,4 Ko** |
| chunks contenant le décodeur | **AUCUN** |

L'écran scanner lui-même (78,4 Ko brut / **16,4 Ko brotli**, partagé avec d'autres
composants élève) est bien dans ce chemin — c'est normal, c'est du JSX. Le **décodeur**,
lui, n'y est pas.

**Ce qui part au réseau seulement après le tap sur « Ouvrir la caméra » :**

| Ressource | Brut | **Brotli** |
|---|---:|---:|
| `zxing_reader.wasm` (`/_next/static/media/`) | 1 065 866 | **349 529** |
| glue `zxing-wasm` | 36 641 | **11 393** |
| adaptateur | 894 | **543** |
| **Total** | **1 103 401** | **≈ 361 Ko** |

**Preuve du chargement paresseux** : les chunks contenant `zxing` ne sont référencés par
**aucune page** ni par `rootMainFiles` (6 fichiers, 446,2 Ko) — sortie littérale du
manifeste : `AUCUN — atteints uniquement par import() dynamique`. La chaîne
`zxing_reader.wasm` ne vit que dans le chunk de glue, lui-même hors du graphe de la page :
charger l'écran nutrition ne **peut pas** déclencher le téléchargement.

**Preuve d'absence du candidat écarté** : recherche de `@zxing/library` et
`MultiFormatReader` dans tous les chunks de `.next/static` → **False**.

> La preuve d'EXÉCUTION du chargement paresseux — « le `.wasm` part au tap, et pas
> avant » — vient de la phase 2, en navigateur réel sur build de production. Le mécanisme
> (`await import()` dans `ouvrir()`) est inchangé. Ici, la preuve est **statique**, parce
> que l'écran nutrition exige une session authentifiée qu'un test sans navigateur ne peut
> pas produire honnêtement. Ton test terrain (§26) la complète.

---

## 13. Absence de jsDelivr — conservée

Le correctif de phase 2 est intact et re-vérifié :

```ts
const URL_WASM_LECTEUR = new URL("zxing-wasm/reader/zxing_reader.wasm", import.meta.url).href;
const SURCHARGES_WASM = { locateFile: (f, p) => (f.endsWith(".wasm") ? URL_WASM_LECTEUR : p + f) };
```

| Vérification | Résultat |
|---|---|
| `.wasm` émis par le build | `/_next/static/media/zxing_reader.0g-qr2_sqw379.wasm` |
| Origine | **la nôtre** |
| `Content-Type` | `application/wasm` |
| `Cache-Control` | `public, max-age=31536000, immutable` |
| CSP | `connect-src 'self'` suffit — **rien à changer** |
| Service Worker | **non modifié** ; sa règle `/_next/static/` le met en cache |
| `jsdelivr` / `unpkg` / `cdn.` dans `lib/scan/**` | **0** (hors prose, contrôle négatif à l'appui) |

Deux tests protègent l'invariant (`A4-SUP §12`), et **N18** les rend rouges dès que les
surcharges disparaissent. En phase 2, le même sabotage a fait rapporter au navigateur, mot
pour mot : `Refused to connect to 'https://fastly.jsdelivr.net/…' because it violates …
connect-src 'self'`.

**Un point pour plus tard, pas pour maintenant** : `script-src` contient `'unsafe-eval'`,
ce qui autorise la compilation WebAssembly. Le jour où la CSP sera resserrée, il faudra
ajouter `'wasm-unsafe-eval'`. `next.config.ts` n'a pas été touché.

---

## 14. Non-régression

| | |
|---|---|
| Batterie complète | **90 suites, 2 101 tests verts, 31 rouges** |
| `tsc --noEmit` | **0 erreur** |
| `eslint` (arbre entier) | **0 erreur, 0 avertissement** |
| `git diff --check` | **propre** |
| `git status --short` | 9 modifiés, 2 supprimés, 3 non suivis — le delta exact |

Suites clés : A1 16/16 · A2 42/42 · A3 19/19 · A3-OFF 23/23 · A3-SEARCH 36/36 ·
A3-UI 25/25 · **A4-SCAN 25/25** · **A4-UI 30/30**.

**Les 31 rouges sont EXACTEMENT ceux d'avant la phase 3** — mêmes suites, mêmes noms de
tests, même nombre :

- **24 / 7 suites** — la baseline prouvée rouge au commit `3ed5cfa` en phase 4.1 ;
- **7 / 1 suite** — `webhook-idempotency`, `TypeError: supabase.rpc is not a function`
  (le faux client du harnais n'expose pas `.rpc`), prouvé antérieur par exécution sur un
  instantané antérieur à A3 phase 4. Hors périmètre, non corrigé.

**Aucune nouvelle régression.**

### Un garde-fou A3 resserré, pas supprimé

`A3-OFF-SUP` exigeait qu'aucun scanner ne soit branché dans l'écran d'élève. C'était la
frontière de la phase 2 ; elle a été franchie par décision explicite. Le contrôle a été
resserré là où il reste vrai — un décodeur n'a le droit d'exister que dans `lib/scan/`,
et `BarcodeDetector` comme `cgi/search.pl` restent interdits **partout**. Quatre contrôles
négatifs vérifient que le resserrement n'a rien vidé.

De même, `A4-SCAN19/20` affirmait « aucun scanner n'est encore branché ». Réécrit pour
mesurer ce qui reste vrai : **le scan s'ajoute aux deux parcours d'A2 et d'A3, il ne les
remplace pas.**

---

## 15. À faire avant le test terrain

1. **`npm install`** sur le Mac — retire `node_modules/@zxing/`.
2. Déployer une **Preview Vercel**. `NEXT_PUBLIC_A4_BENCH` n'est plus nécessaire : tu
   peux la supprimer de l'environnement Preview.
3. Ouvrir l'espace nutrition **sur iPhone, en HTTPS**, et suivre le §26 :
   Nutella · galettes de maïs · produit liquide · fermer sans scanner (voyant caméra) ·
   permission refusée · ouvrir le scanner deux fois.

Le seul point que ni les harnais ni le conteneur ne peuvent trancher : **le voyant caméra
de l'iPhone s'éteint-il vraiment à la fermeture ?** Le code coupe toutes les pistes depuis
six sorties et le démontage, et c'est éprouvé — mais seul ton téléphone peut le confirmer.
