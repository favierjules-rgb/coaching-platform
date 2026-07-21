-- Migration additive (chantier conformité juridique/RGPD, Lot E-bis
-- technique — correctif verrou concurrent/garanties DB réelles, juillet
-- 2026) : ferme la fenêtre de course résiduelle du dédoublonnage applicatif
-- (hasLegalConsentForCheckoutSession, lookup-avant-insert) en imposant
-- l'unicité au niveau Postgres lui-même, pour les deux seuls consent_type
-- concernés par un achat de programme public payant.
--
-- Vérification préalable (2026-07-21, avant écriture de cette migration) :
-- recherche de doublons existants sur (consent_type,
-- metadata->>'checkout_session_id') pour 'cgv_programme'/
-- 'retractation_programme', exécutée directement contre la base de
-- production — AUCUN doublon trouvé (la table ne contient encore aucune
-- ligne pour ces deux types à cette date, projet pré-lancement).
--
-- La migration se revérifie elle-même ci-dessous (bloc do $$ ... end $$) et
-- lève une exception si des doublons existaient malgré tout au moment de
-- l'exécution réelle — garde-fou indépendant de la vérification manuelle
-- ci-dessus, pour toute exécution future de cette migration (autre
-- environnement, replay...).
--
-- PAS de `if not exists` sur l'index, contrairement à la convention du
-- reste du schéma (décision explicite de Jules) : cette instruction est une
-- vraie migration à appliquer UNE SEULE FOIS, pas une réexécution
-- silencieusement ignorée.

do $$
begin
  if exists (
    select 1
    from public.legal_consents
    where
      metadata ->> 'checkout_session_id' is not null
      and consent_type in ('cgv_programme', 'retractation_programme')
    group by
      consent_type,
      metadata ->> 'checkout_session_id'
    having count(*) > 1
  ) then
    raise exception
      'Impossible de créer l’index unique : doublons dans legal_consents';
  end if;
end
$$;

create unique index legal_consents_program_checkout_unique_idx
on public.legal_consents (
  consent_type,
  (metadata ->> 'checkout_session_id')
)
where
  metadata ->> 'checkout_session_id' is not null
  and consent_type in ('cgv_programme', 'retractation_programme');
