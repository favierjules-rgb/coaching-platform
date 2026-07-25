ALTER TABLE public.email_logs DROP CONSTRAINT email_logs_email_type_check;

ALTER TABLE public.email_logs ADD CONSTRAINT email_logs_email_type_check
  CHECK (email_type = ANY (ARRAY[
    'welcome', 'subscription_assigned', 'payment_succeeded', 'payment_failed',
    'subscription_cancelled', 'program_assigned', 'nutrition_assigned',
    'document_assigned', 'appointment_created', 'appointment_cancelled',
    'appointment_reminder', 'password_reset', 'account_expiry_warning',
    'coach_invite', 'collaborator_invite'
  ]));;
