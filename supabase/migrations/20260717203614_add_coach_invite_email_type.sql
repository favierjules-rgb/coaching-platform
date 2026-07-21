alter table public.email_logs drop constraint email_logs_email_type_check;
alter table public.email_logs add constraint email_logs_email_type_check
  check (email_type = any (array[
    'welcome', 'subscription_assigned', 'payment_succeeded', 'payment_failed',
    'subscription_cancelled', 'program_assigned', 'nutrition_assigned',
    'document_assigned', 'appointment_created', 'appointment_cancelled',
    'appointment_reminder', 'password_reset', 'account_expiry_warning',
    'coach_invite'
  ]));;
