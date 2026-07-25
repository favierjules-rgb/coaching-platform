-- ============================================================================
-- delete_unused_subscription_template — suppression TRANSACTIONNELLE d'un
-- modèle d'abonnement réellement inutilisé.
--
-- POURQUOI : compter les références en TypeScript puis faire un DELETE séparé
-- laisse une fenêtre de course (un élève peut se voir attribuer le modèle, ou
-- un abonnement être créé par un webhook, ENTRE le contrôle et la suppression).
-- Cette fonction verrouille la ligne du modèle puis revérifie toutes les
-- références DANS LA MÊME TRANSACTION avant de supprimer.
--
-- SÉCURITÉ : `security invoker` (les policies RLS de l'appelant s'appliquent),
-- `search_path = ''` (tous les objets sont qualifiés) et surtout EXECUTE
-- **révoqué à public, anon ET authenticated**, accordé au seul `service_role`.
-- Cette RPC destructive n'est donc PAS appelable depuis le navigateur : elle
-- est invoquée uniquement par la route serveur `DELETE
-- /api/admin/subscription-templates/[id]` via le client service role, APRÈS
-- une vérification staff explicite (session + rôle admin/coach). La clé
-- service role n'est jamais exposée au client (`lib/supabase/admin.ts` importe
-- `server-only`).
--
-- IDEMPOTENCE : un modèle déjà absent renvoie {"result":"not_found"} sans
-- erreur — un réessai après une erreur réseau est sûr.
--
-- RÉFÉRENCES VÉRIFIÉES (voir supabase/schema.sql) :
--   1. student_profiles.assigned_subscription_template_id (FK set null)
--   2. student_profiles.assigned_stripe_price_id (colonne TEXTE, non nettoyée
--      par la FK — vecteur d'attribution distinct)
--   3. subscriptions.stripe_price_id (texte, aucune FK)
--   4. stripe_payments rattachés à un abonnement portant ce price_id
--      (stripe_payments n'a AUCUNE colonne prix/produit/modèle et AUCUNE FK
--      vers subscriptions : le seul lien possible est
--      stripe_payments.stripe_subscription_id = subscriptions.stripe_subscription_id)
-- ============================================================================

create or replace function public.delete_unused_subscription_template(p_template_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_price_id text;
  v_students_by_template integer := 0;
  v_students_by_price integer := 0;
  v_subscriptions integer := 0;
  v_payments integer := 0;
begin
  -- 1. Verrouiller la ligne cible (bloque toute suppression/màj concurrente).
  select t.stripe_price_id
    into v_price_id
    from public.subscription_templates t
   where t.id = p_template_id
     for update;

  -- 2. Modèle inexistant → réponse contrôlée (idempotent).
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  -- 3. Revérifier TOUTES les références dans la même transaction.
  select count(*) into v_students_by_template
    from public.student_profiles sp
   where sp.assigned_subscription_template_id = p_template_id;

  if v_price_id is not null then
    select count(*) into v_students_by_price
      from public.student_profiles sp
     where sp.assigned_stripe_price_id = v_price_id;

    select count(*) into v_subscriptions
      from public.subscriptions s
     where s.stripe_price_id = v_price_id;

    select count(*) into v_payments
      from public.stripe_payments p
      join public.subscriptions s
        on s.stripe_subscription_id = p.stripe_subscription_id
     where s.stripe_price_id = v_price_id;
  end if;

  -- 4. Une seule référence bloquante ⇒ on ne supprime rien.
  if v_students_by_template > 0
     or v_students_by_price > 0
     or v_subscriptions > 0
     or v_payments > 0 then
    return jsonb_build_object(
      'result', 'in_use',
      'references', jsonb_build_object(
        'studentsByTemplateId', v_students_by_template,
        'studentsByPriceId', v_students_by_price,
        'subscriptions', v_subscriptions,
        'payments', v_payments
      )
    );
  end if;

  -- 5. Réellement inutilisé → suppression dans la même transaction.
  delete from public.subscription_templates where id = p_template_id;

  return jsonb_build_object('result', 'deleted');
end;
$$;

revoke execute on function public.delete_unused_subscription_template(uuid) from public;
revoke execute on function public.delete_unused_subscription_template(uuid) from anon;
revoke execute on function public.delete_unused_subscription_template(uuid) from authenticated;
grant execute on function public.delete_unused_subscription_template(uuid) to service_role;
