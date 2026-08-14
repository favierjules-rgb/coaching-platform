/**
 * BANC DE MESURE RESPONSIVE — A5.9.
 *
 * Charge la VRAIE fiche élève (serveur Next en mode mock, aucun code modifié)
 * dans Chromium, à chaque largeur demandée, et rapporte :
 *   - clientWidth / scrollWidth du document ;
 *   - la liste des éléments dont le bord droit dépasse le viewport, avec leur
 *     chaîne d'ancêtres, leur largeur et leur min-content width.
 *
 * ⚠️ ON MESURE `scrollWidth` DU DOCUMENT, pas « ça a l'air bien ». Et on
 * remonte au PREMIER coupable dans l'arbre : signaler les cinquante descendants
 * d'un conteneur trop large ferait perdre la cause parmi ses conséquences.
 */
import pw from "/home/claude/.npm-global/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const URL_CIBLE = process.argv[2] ?? "http://localhost:3112/admin/eleves/adm-1";
const LARGEURS = process.argv[3]
  ? process.argv[3].split(",").map(Number)
  : [375, 390, 393, 430, 768, 1280, 1440, 1728, 1920];

const navigateur = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const largeur of LARGEURS) {
  const page = await navigateur.newPage({
    viewport: { width: largeur, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.goto(URL_CIBLE, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(600);

  // ⚠️ GARDE-FOU DU BANC LUI-MÊME. Une page 404 ne déborde jamais : mesurer
  // sans vérifier ce qu'on mesure produit des « 0 px » rassurants et faux.
  // Ce garde a rattrapé exactement cette erreur (dossier `__`, privé pour
  // Next, jamais routé — sept mesures pour rien).
  const attendu = process.argv[4];
  if (attendu) {
    const present = await page.evaluate((t) => document.body.textContent.includes(t), attendu);
    if (!present) {
      console.error(`\nBANC INVALIDE — « ${attendu} » absent de ${URL_CIBLE} à ${largeur} px.`);
      process.exit(2);
    }
  }

  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const vue = doc.clientWidth;

    // ⚠️ MESURER LE DOCUMENT NE SUFFIT PAS — ET C'EST TOUT LE PIÈGE.
    // `overflow-y: auto` force `overflow-x` à `auto` (spec CSS : dès qu'un axe
    // n'est pas `visible`, l'autre cesse de l'être). Un conteneur ainsi réglé
    // AVALE le débordement : il défile lui-même, et `documentElement
    // .scrollWidth` reste égal à `clientWidth`. L'utilisateur, lui, voit bien
    // une barre horizontale. On inspecte donc TOUS les conteneurs.
    const conteneurs = [];
    for (const el of document.querySelectorAll("html, body, main, div, section, ul, nav")) {
      const debord = el.scrollWidth - el.clientWidth;
      if (debord <= 1 || el.clientWidth === 0) continue;
      const st = getComputedStyle(el);
      const classes = typeof el.className === "string" ? el.className : "";
      // ⚠️ DISTINGUER LE DÉFILEMENT VOULU DU DÉFILEMENT SUBI.
      //
      // Le carrousel demande `overflow-x-auto` : qu'il défile est son travail.
      // `<main>` ne demande QUE `overflow-y-auto` — mais la spec CSS force
      // l'autre axe à `auto` dès qu'un axe cesse d'être `visible`. Il devient
      // donc un conteneur de défilement HORIZONTAL sans que personne l'ait
      // écrit, et il AVALE le débordement : la page ne montre aucune barre,
      // alors que le contenu, lui, slide latéralement. C'est exactement le
      // symptôme rapporté, et c'est ce qui rend une mesure limitée à
      // `documentElement` incapable de le voir.
      const voulu = classes.includes("overflow-x");
      if (voulu && el.getBoundingClientRect().right <= vue + 1) continue;

      // `overflow-x: hidden` CLIPPE : pas de barre, pas de glissement, aucun
      // symptôme pour l'utilisateur. Et un conteneur de quelques pixels — un
      // `sr-only`, une pastille — n'est pas un défaut de mise en page. On ne
      // retient que ce qui produit réellement un défilement visible.
      if (st.overflowX !== "auto" && st.overflowX !== "scroll") continue;
      if (el.clientWidth < 200) continue;
      conteneurs.push({
        tag: el.tagName.toLowerCase(),
        classe: (typeof el.className === "string" ? el.className : "").slice(0, 110),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        debord,
        overflowX: st.overflowX,
        overflowY: st.overflowY,
        voulu,
      });
    }
    conteneurs.sort((a, b) => b.debord - a.debord);
    const coupables = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right <= vue + 1 && rect.left >= -1) continue;
      // On ne retient que le PREMIER responsable : si un ancêtre déborde déjà,
      // cet élément n'est qu'un symptôme.
      // ⚠️ UN ENFANT DE CONTENEUR DÉFILANT N'EST PAS UN COUPABLE. Les sept
      // jours du carrousel sont HORS de la piste par construction : c'est ce
      // que fait un `overflow-x-auto`. Les signaler noierait la vraie cause
      // sous des dizaines de faux positifs.
      let contenu = false;
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") { contenu = true; break; }
      }
      if (contenu) continue;

      let ancetreDeborde = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const pr = p.getBoundingClientRect();
        if (pr.right > vue + 1 || pr.left < -1) { ancetreDeborde = true; break; }
      }
      if (ancetreDeborde) continue;

      const chemin = [];
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        chemin.unshift(p.tagName.toLowerCase() + (p.className && typeof p.className === "string"
          ? "." + p.className.trim().split(/\s+/).slice(0, 4).join(".")
          : ""));
      }
      coupables.push({
        tag: el.tagName.toLowerCase(),
        classe: typeof el.className === "string" ? el.className.slice(0, 160) : "",
        texte: (el.textContent ?? "").trim().slice(0, 60),
        gauche: Math.round(rect.left),
        droite: Math.round(rect.right),
        largeur: Math.round(rect.width),
        chemin: chemin.slice(-4).join(" > "),
      });
    }
    return {
      clientWidth: vue,
      scrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      depassement: doc.scrollWidth - vue,
      coupables: coupables.slice(0, 8),
      conteneurs: conteneurs.slice(0, 6),
    };
  });

  const pireConteneur = r.conteneurs[0]?.debord ?? 0;
  const verdict = r.depassement <= 1 && pireConteneur <= 1 ? "OK " : "DÉBORDE";
  console.log(
    `\n${verdict} ${String(largeur).padStart(4)} px │ clientWidth=${r.clientWidth} scrollWidth=${r.scrollWidth} (écart ${r.depassement} px)`,
  );
  for (const c of r.conteneurs) {
    console.log(
      `      ⤢ ${c.voulu ? "DÉFILEMENT VOULU" : "DÉFILEMENT SUBI  "} <${c.tag}> client=${c.clientWidth} scroll=${c.scrollWidth} (+${c.debord} px)  overflow-x:${c.overflowX}`,
    );
    console.log(`        classe: ${c.classe}`);
  }
  for (const c of r.coupables) {
    console.log(`      → <${c.tag}> l=${c.largeur} [${c.gauche}..${c.droite}]  "${c.texte}"`);
    console.log(`        classe: ${c.classe}`);
    console.log(`        chemin: ${c.chemin}`);
  }
  await page.close();
}

await navigateur.close();
