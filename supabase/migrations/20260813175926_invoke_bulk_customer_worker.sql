create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'sincro_vicente_project_url') then
    perform vault.create_secret('https://cxmsriqumanocmviuzok.supabase.co', 'sincro_vicente_project_url');
  end if;
  if not exists (select 1 from vault.secrets where name = 'sincro_vicente_publishable_key') then
    perform vault.create_secret('sb_publishable_buAchNkPnGI7H8Yile8D4A_yt94qynH', 'sincro_vicente_publishable_key');
  end if;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'sincro-vicente-customer-import-worker';

select cron.schedule(
  'sincro-vicente-customer-import-worker',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_project_url') || '/functions/v1/sync-prestashop-customers',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sincro_vicente_publishable_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
