-- 1. Suivi de l'email d'avertissement
alter table public.students
  add column if not exists deletion_warning_sent_at timestamptz;

-- 2. Nouveau type d'email transactionnel
alter table public.email_logs drop constraint email_logs_email_type_check;
alter table public.email_logs add constraint email_logs_email_type_check
  check (email_type = any (array[
    'welcome', 'subscription_assigned', 'payment_succeeded', 'payment_failed',
    'subscription_cancelled', 'program_assigned', 'nutrition_assigned',
    'document_assigned', 'appointment_created', 'appointment_cancelled',
    'appointment_reminder', 'password_reset', 'account_expiry_warning'
  ]));

-- 3. Activation pg_cron / pg_net (le job lui-meme sera programme une fois l'URL de prod connue)
create extension if not exists pg_cron;
create extension if not exists pg_net;
;
