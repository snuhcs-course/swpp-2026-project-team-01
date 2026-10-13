SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.scheduling_view (
  p_request_id uuid,
  p_context    text,
  p_reconnect  boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r fmat.requests; p fmat.candidate_publications; proposal jsonb; bound boolean:=false; current boolean:=false; availability text;
begin
 select * into strict r from fmat.requests where id=p_request_id;
 select * into p from fmat.candidate_publications where id=r.candidate_publication_id and request_id=r.id;
 current:=p.id is not null and p.context_basis=p_context and p.expires_at>clock_timestamp() and p.check_id=r.availability_check_id and r.availability_check_started_at>clock_timestamp()-interval '5 minutes' and not r.host_availability_failed and not(r.availability_mode='calendar' and r.availability_failed);
 select details into proposal from fmat.proposals where request_id=r.id and version=r.current_proposal_version;
 bound:=exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=p_context);
 availability:=case when p_reconnect then 'reconnect_required' when p.id is null then 'not_evaluated' when not current then 'stale' else p.resolution end;
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'status',r.status,'detailsComplete',fmat.details_complete(r.details),'meeting',jsonb_build_object('timezone',coalesce(r.details->>'timezone',''),'durationMinutes',r.details->'durationMinutes','mode',coalesce(r.details->>'mode',''),'location',coalesce(r.details->>'location','')),'availability',availability,
 'publication',case when current then jsonb_build_object('id',p.id,'expiresAt',p.expires_at,'truncated',p.truncated,'candidates',p.candidates) else null end,
 'proposal',proposal,'requesterAgreed',bound and coalesce(r.requester_agreed_version=r.current_proposal_version,false),
 'canAgree',coalesce(bound and proposal is not null and not p_reconnect and not r.host_availability_failed and not(r.availability_mode='calendar' and r.availability_failed),false));
end;
$function$;

