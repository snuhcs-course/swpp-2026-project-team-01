-- Existing scans are evidence that the host already chose optional analysis.
-- Retain that choice after the temporary scan summaries are deleted.
update fmat.setup_conversations c set analysis_decided=true
where not c.analysis_decided and exists (
 select 1 from fmat.calendar_scans s where s.host_id=c.host_id
);
