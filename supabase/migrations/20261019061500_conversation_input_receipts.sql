ALTER TABLE "app"."conversation_inputs"
  ADD COLUMN "received_session_id" text;

ALTER TABLE "app"."conversation_inputs"
  ADD CONSTRAINT "conversation_inputs_received_session_id_fkey" FOREIGN KEY (received_session_id) REFERENCES app.agent_sessions(session_id);
