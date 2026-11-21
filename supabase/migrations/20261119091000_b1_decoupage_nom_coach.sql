-- ============================================================================
-- B1 — `get_my_coach_public_profile` : un nom sans espace n'est plus rendu deux fois
--
-- ----------------------------------------------------------------------------
-- LE DÉFAUT, REPRODUIT CARACTÈRE POUR CARACTÈRE
-- ----------------------------------------------------------------------------
-- Expression posée par 20260726220000 (l. 228-229) :
--
--   split_part(coalesce(c.name, ''), ' ', 1)                                            as first_name,
--   nullif(trim(substr(coalesce(c.name, ''), strpos(coalesce(c.name, ''), ' ') + 1)), '') as last_name
--
-- ⚠️ `strpos` REND 0 QUAND LE SÉPARATEUR EST ABSENT, ET `substr(x, 0 + 1)` REND
-- LA CHAÎNE ENTIÈRE. Un nom d'un seul mot ressort donc DEUX FOIS : une fois en
-- prénom, une fois en patronyme. Mesuré le 19/11/2026 sur la production :
--
--   name                    strpos  first_name            last_name
--   <adresse technique>          0  <toute la chaine>     <toute la chaine>   ← faux
--   'COACH TEST UN'              6  COACH                 TEST UN             ← correct
--
-- La première ligne est la valeur réelle de `coaches.name` du coach titulaire :
-- une adresse technique sans espace. Elle n'est pas recopiée ici — une migration
-- ne doit porter aucune identité — mais le mécanisme, lui, est celui-ci.
--
-- Chaîne complète du défaut, reproduite par exécution des fonctions du dépôt,
-- avec un nom d'un seul mot noté <x> :
--
--   RPC                              → (<x>, <x>)
--   lib/supabase/appointments.ts:170 → '<x> <x>'
--   formaterIdentiteCoach(…)         → '<x> <X MAJUSCULES>'
--   titre .ics téléchargé            → 'Séance de coaching — <x> <X MAJUSCULES>'
--
-- C'est ce dernier titre qu'Apple Calendrier a affiché, avec l'adresse
-- technique du coach titulaire en <x>. Le patronyme crié n'est PAS dans la
-- base : c'est la RPC qui le fabrique.
--
-- Le cas nommé, avec sa valeur réelle, est tenu hors de cette migration : il
-- est figé par scripts/tests/stabilisation-b1-b2.mts (CONTRE-B1-01) et par
-- supabase/tests/stabilisation_b1_b2_checklist.sql (B1-03).
--
-- ----------------------------------------------------------------------------
-- POURQUOI LA CORRECTION EST ICI, ET NULLE PART AILLEURS
-- ----------------------------------------------------------------------------
-- Trois emplacements étaient possibles ; deux sont mauvais.
--
--   • `lib/ics-intitules.ts` : il met en majuscules ce qu'on lui donne et ne
--     connaît pas la provenance. Y mettre une règle serait soigner le symptôme
--     dans le formateur commun aux trois parcours .ics.
--
--   • `lib/supabase/appointments.ts` : une règle « si first_name === last_name
--     alors ignorer le patronyme » y effacerait le nom des HOMONYMES RÉELS —
--     « Martin Martin » perdrait son patronyme. Écarté pour cette raison.
--
--   • ICI, dans la RPC : c'est la seule fabrique des deux champs. Corrigée
--     ici, la duplication n'existe plus pour AUCUN consommateur, présent ou
--     futur, et aucun code TypeScript n'a besoin de changer.
--
-- ----------------------------------------------------------------------------
-- LE CONTRAT DES DEUX CHAMPS, APRÈS CORRECTION
-- ----------------------------------------------------------------------------
--   nom composé      → prénom = avant le premier espace, patronyme = le reste
--   nom d'un seul mot → prénom = ce mot,                  patronyme = NULL
--   nom vide ou NULL  → prénom = NULL,                    patronyme = NULL
--
-- ⚠️ LE COMPORTEMENT DE SECOURS EST INCHANGÉ, et c'est vérifiable. Avec un nom
-- vide, l'ancienne expression rendait `first_name = ''` ; la nouvelle rend
-- NULL. Côté application, `[first_name, last_name].filter(Boolean)`
-- (lib/supabase/appointments.ts:170) écarte `''` exactement comme `null` : le
-- nom recomposé reste vide dans les deux cas, et le repli
-- `DEFAULT_COACH_INFO.name` s'applique à l'identique.
--
-- ⚠️ `btrim` AJOUTÉ — un nom à espace de tête ne produit plus un prénom vide.
-- Ancienne expression sur ' Alpha Beta' : `split_part` rend '' et `strpos` rend
-- 1, donc ('', 'Alpha Beta'). Nouvelle : ('Alpha', 'Beta'). Le titre final
-- était déjà correct par recomposition ; les deux champs le sont maintenant
-- aussi.
--
-- ----------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ----------------------------------------------------------------------------
--   • elle ne modifie AUCUNE donnée — `coaches.name` reste tel quel, et aucune
--     identité n'est déduite d'une adresse électronique ;
--   • elle ne change ni la signature, ni les colonnes rendues, ni
--     `security definer`, ni `search_path`, ni le périmètre de lecture ;
--   • elle ne touche pas aux ACL au-delà de la réaffirmation à l'identique de
--     celles de 20260726220000 (nécessaire pour une base reconstruite depuis le
--     baseline, inoffensive sur la production où elles sont déjà en place).
--
-- ⚠️ CE QU'ELLE NE CORRIGE PAS. `coaches.name` vaut toujours une adresse
-- technique pour le coach titulaire. Après cette migration, le titre porte
-- cette adresse UNE SEULE FOIS : lisible, cohérent avec le titre déjà produit
-- par le parcours e-mail serveur, mais toujours pas un nom de personne. Seule
-- une correction de la DONNÉE y remédie ; elle est présentée séparément, pour
-- validation manuelle, et n'a pas sa place dans une migration.
-- ============================================================================

create or replace function public.get_my_coach_public_profile()
returns table (
  coach_id uuid,
  first_name text,
  last_name text,
  specialty text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id                                                        as coach_id,
    nullif(split_part(nom.valeur, ' ', 1), '')                  as first_name,
    -- ⚠️ LE SÉPARATEUR DOIT EXISTER POUR QU'IL Y AIT UN PATRONYME. Sans ce
    -- `case`, `substr(valeur, 0 + 1)` rend le nom entier : c'est le défaut B1.
    case
      when strpos(nom.valeur, ' ') = 0 then null
      else nullif(trim(substr(nom.valeur, strpos(nom.valeur, ' ') + 1)), '')
    end                                                         as last_name,
    c.specialty
  from public.students s
  join public.coaches c on c.id = s.coach_id
  cross join lateral (select btrim(coalesce(c.name, '')) as valeur) as nom
  where s.user_id = auth.uid()
    and auth.uid() is not null
  limit 1;
$$;

comment on function public.get_my_coach_public_profile() is
  'Identité minimale du coach associé à l''élève appelant (jamais email, téléphone ni rôle). Remplace la lecture directe de profiles ET de coaches — audit 26/07/2026. Découpage corrigé le 19/11/2026 (B1) : un nom sans espace rend un seul champ, l''autre NULL.';

-- Permissions réaffirmées à l'identique de 20260726220000 : `create or replace`
-- conserve l'ACL, ces trois lignes ne servent donc qu'à une base reconstruite
-- depuis le baseline, où la fonction naîtrait avec les privilèges par défaut.
revoke execute on function public.get_my_coach_public_profile() from public;
revoke execute on function public.get_my_coach_public_profile() from anon;
grant execute on function public.get_my_coach_public_profile() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- GARDE D'ARRIVÉE — le contrat de découpage est vérifié sur la fonction
-- RÉELLEMENT installée, sans lire aucune donnée de `coaches` ni de `students`.
-- Les expressions ci-dessous sont celles du corps, appliquées à des noms
-- fictifs : si le corps changeait sans que le contrat soit relu, cette garde
-- resterait verte à tort — c'est pourquoi la correspondance corps/garde est
-- figée en plus par scripts/tests/stabilisation-b1-b2.mts (TEXTE-B1-04).
-- ----------------------------------------------------------------------------
do $$
declare
  -- ⚠️ NOMS FICTIFS, ET C'EST UNE CONTRAINTE, PAS UN STYLE. Une migration part
  -- au dépôt et à la production : elle ne doit porter aucune identité réelle.
  -- Les cas couvrent les trois formes du contrat — composé, un seul mot, vide —
  -- et l'homonymie, qu'une règle « prénom = patronyme » détruirait.
  v_cas text[] := array['Alpha Beta', 'Alpha-Beta Gamma Delta', 'Monomot', 'Doublon Doublon', '', '   '];
  v_nom text;
  v_valeur text;
  v_prenom text;
  v_patronyme text;
begin
  foreach v_nom in array v_cas loop
    v_valeur := btrim(coalesce(v_nom, ''));
    -- Calculé comme dans le corps, même si seul le patronyme est contrôlé
    -- ci-dessous : la garde doit refléter les DEUX expressions du corps, sinon
    -- elle cesse d'en être une (TEXTE-B1-04 fige cette correspondance).
    v_prenom := nullif(split_part(v_valeur, ' ', 1), '');
    v_patronyme := case
      when strpos(v_valeur, ' ') = 0 then null
      else nullif(trim(substr(v_valeur, strpos(v_valeur, ' ') + 1)), '')
    end;

    /*
     * UN NOM SANS ESPACE NE DOIT JAMAIS RENDRE DEUX CHAMPS RENSEIGNÉS.
     *
     * ⚠️ `RAISE` NE CONNAÎT QUE `%`. Une première rédaction écrivait `%L`, en
     * croyant reprendre le marqueur de `format()` : mesuré le 19/11/2026,
     * `raise notice 'nom %L', 'Monomot'` affiche « nom MonomotL » — le `%`
     * consomme l'argument et le `L` est émis littéralement. Aucune erreur,
     * mais un message faux sur le seul chemin où il compte.
     *
     * ⚠️ UN SEUL CONTRÔLE, ET C'EST VOULU. Une deuxième condition suivait ici
     * — « le patronyme ne doit pas égaler le prénom quand il n'y a pas
     * d'espace » — et elle était INATTEIGNABLE : son prédicat est un
     * sous-ensemble strict de celui ci-dessous, qui lève avant. Mesuré en
     * réintroduisant l'expression fautive : l'exception vient toujours de ce
     * contrôle-ci. Un test qui ne peut pas rougir a été retiré plutôt que
     * conservé pour la forme.
     */
    if strpos(v_valeur, ' ') = 0 and v_patronyme is not null then
      raise exception 'B1 : le nom % sans espace rend encore un patronyme (%)', v_nom, v_patronyme;
    end if;
  end loop;

  -- L'HOMONYMIE EST PRÉSERVÉE : deux mots identiques restent deux champs.
  v_valeur := btrim('Doublon Doublon');
  if nullif(split_part(v_valeur, ' ', 1), '') is distinct from 'Doublon'
     or (case when strpos(v_valeur, ' ') = 0 then null
              else nullif(trim(substr(v_valeur, strpos(v_valeur, ' ') + 1)), '') end) is distinct from 'Doublon' then
    raise exception 'B1 : l''homonymie a ete ecrasee';
  end if;

  -- LA FORME QUI A MOTIVÉ LA CORRECTION : un nom sans espace, quel qu'il soit.
  -- La valeur réelle rencontrée en production est une adresse technique ; elle
  -- est décrite dans l'en-tête et volontairement ABSENTE du code exécuté.
  v_valeur := btrim('identifiant.sans.espace');
  if (case when strpos(v_valeur, ' ') = 0 then null
           else nullif(trim(substr(v_valeur, strpos(v_valeur, ' ') + 1)), '') end) is not null then
    raise exception 'B1 : un nom sans espace rend encore un patronyme';
  end if;
end $$;
