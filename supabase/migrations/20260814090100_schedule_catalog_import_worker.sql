create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname = 'sincro-vicente-catalog-import-worker';

select cron.schedule(
  'sincro-vicente-catalog-import-worker',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_project_url') || '/functions/v1/sync-catalog-imports',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_publishable_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
