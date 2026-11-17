-- Google Merchant: la lectura de avisos pasa de una vez por noche a cada hora (minuto 45), para ver durante el día lo
-- que Google aplica de verdad y avisar si lo mandado no se refleja.
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'sincro-vicente-merchant-avisos'), schedule := '45 * * * *');
