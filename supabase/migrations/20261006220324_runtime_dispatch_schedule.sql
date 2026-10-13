-- Cron records are runtime data, outside pg-delta's desired-schema model.
-- The wake function does nothing until this environment's Vault is configured.
select cron.schedule('fmat-runtime-dispatch','* * * * *','select fmat.wake_runtime_dispatch();');
