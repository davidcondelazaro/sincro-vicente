-- Traer los pedidos de Shopify (y exportar los listos) cada 5 minutos en vez de cada 15 (petición del 18-11-2026)
select cron.alter_job((select jobid from cron.job where jobname = 'sincro-vicente-pedidos-pedidos'), schedule := '*/5 * * * *');
