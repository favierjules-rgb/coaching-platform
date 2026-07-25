-- Correctif : deux fonctions SECURITY DEFINER appelées par des policies RLS
-- qui s'appliquent à TOUS les rôles (y compris anon) n'avaient jamais reçu
-- le droit EXECUTE pour anon (elles n'étaient utilisées, jusqu'à présent,
-- que par des policies réservées aux élèves/staff connectés). Résultat :
-- toute lecture anonyme de `programs` ou `subscription_templates`
-- (catalogue public home page / /programmes) échouait avec "permission
-- denied for function current_student_id", même si la policy dédiée aux
-- visiteurs (programs_select_public) autoriserait la ligne. Les deux
-- fonctions renvoient simplement null/false pour un visiteur anonyme
-- (auth.uid() est alors null) : ce grant ne change aucun comportement
-- métier, il corrige uniquement le blocage.
grant execute on function public.current_student_id() to anon;
grant execute on function public.is_coach_or_admin() to anon;;
