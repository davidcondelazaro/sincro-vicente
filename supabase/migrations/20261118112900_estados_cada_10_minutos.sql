-- Leer los estados de MHD cada 10 minutos (a los :02, :12…) en vez de cada 30 (petición del 18-11-2026)
select cron.alter_job((select jobid from cron.job where jobname = 'sincro-vicente-pedidos-estados'), schedule := '2-59/10 * * * *');
