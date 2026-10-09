-- Irreversible minimization of this ledger only. Both expressions read the old
-- row, so retry identity is derived before original credential text is removed.
-- Do not rehash protected rows: the digest represents the originally submitted
-- text, not its replacement. IDs, order, status and session bindings are intact.
update fmat.runtime_messages
set input_fingerprint=coalesce(input_fingerprint,
      fmat.conversation_input_fingerprint(conversation_id,grant_id,client_id,text)),
    text=fmat.protect_conversation_text(text)
where input_fingerprint is null or text is distinct from fmat.protect_conversation_text(text);
