"""Disposable local-only two-session setup locking probe. Never reads .env or contacts production."""
import json
import subprocess
import time
import uuid

CONTAINER = 'supabase_db_swpp-2026-project-team-01'
TAG = 'setup-concurrency-' + uuid.uuid4().hex
host_id, invitation_id = str(uuid.uuid4()), str(uuid.uuid4())
challenge_hash, browser_hash = uuid.uuid4().hex * 2, uuid.uuid4().hex * 2
host = {'kind': 'host', 'id': host_id, 'email': TAG + '@example.test'}
worker = {'kind': 'worker', 'id': TAG}
channel = {'provider': 'imessage', 'senderId': TAG, 'privateConversationId': TAG, 'isGroup': False}
rules = {'timezone': 'UTC', 'durationMinutes': 30, 'availability': [{'days': [1], 'start': '09:00', 'end': '17:00'}], 'focusBlocks': [], 'bufferMinutes': 0, 'travelMode': 'TRANSIT', 'preferences': ''}


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def command(operation, actor, data):
    body = dict(data, idempotencyKey=TAG + '-' + uuid.uuid4().hex)
    return 'select public.fmat_command(' + ','.join([literal(operation), literal(json.dumps(actor)) + '::jsonb', literal(json.dumps(body)) + '::jsonb']) + ');'


def start(sql):
    process = subprocess.Popen(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(sql)
    process.stdin.close()
    return process


def run(sql):
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    lines = [line for line in result.stdout.splitlines() if line.startswith('{')]
    return json.loads(lines[-1]) if lines else None


try:
    run('insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values (' + ','.join([literal(invitation_id), literal(host['email']), literal(uuid.uuid4().hex * 2), "now()+interval '1 day'", literal(TAG)]) + ');\n' +
        'insert into fmat.hosts(id,email,invitation_id) values (' + ','.join([literal(host_id), literal(host['email']), literal(invitation_id)]) + ');\n' +
        command('setup_save', host, {'handle': 'probe-' + uuid.uuid4().hex[:16], 'displayName': 'Disposable concurrency host', 'rules': rules}))
    challenge = run(command('setup_link_challenge_start', host, {'challengeSecretHash': challenge_hash, 'browserProofHash': browser_hash}))
    run(command('setup_link_challenge_claim', worker, dict(channel, challengeId=challenge['challengeId'], challengeSecretHash=challenge_hash)))
    linked = run(command('setup_link_confirm', host, {'challengeId': challenge['challengeId'], 'browserProofHash': browser_hash}))
    inbound = []
    for n in (1, 2):
        inbound.append(run(command('setup_provider_inbound_record', worker, dict(channel, providerMessageId=TAG + '-' + str(n), occurredAt='2026-10-05T06:00:00Z', text='Turn ' + str(n)))))
    first = start('begin;\n' + command('setup_turn_append', worker, dict(channel, providerMessageId=TAG + '-1', expectedRevision=0, clientTurnId=str(uuid.uuid4()), channel='imessage', text='Turn 1', assistantText='Reply 1')) + "\nselect pg_sleep(2);\ncommit;\n")
    first_result = json.loads(first.stdout.readline())
    assert first_result['revision'] == 1
    started = time.monotonic()
    second = start(command('setup_turn_append', worker, dict(channel, providerMessageId=TAG + '-2', expectedRevision=1, clientTurnId=str(uuid.uuid4()), channel='imessage', text='Turn 2', assistantText='Reply 2')))
    second_out = second.stdout.read()
    second_error = second.stderr.read()
    second.wait(timeout=10)
    first.stdout.read()
    first_error = first.stderr.read()
    first.wait(timeout=10)
    assert first.returncode == 0 and second.returncode == 0, (first_error, second_error)
    assert time.monotonic() - started >= 1.5, 'second worker did not wait for the first host/channel transaction'
    assert json.loads(second_out.strip())['revision'] == 2
    prepared = run(command('setup_provider_outbound_prepare', worker, {'inboundId': inbound[0]['inboundId'], 'clientMessageId': str(uuid.uuid4()), 'text': 'Reply 1'}))
    sender = start('begin;\n' + command('setup_provider_outbound_claim', worker, {'provider': 'imessage'}) + "\nselect pg_sleep(2);\ncommit;\n")
    dispatch = json.loads(sender.stdout.readline())
    assert dispatch['action'] == 'dispatch'
    started = time.monotonic()
    unlinker = start(command('setup_link_unlink', host, {'linkId': linked['channelLink']['id']}))
    unlinker.stdout.read()
    unlink_error = unlinker.stderr.read()
    unlinker.wait(timeout=10)
    sender.stdout.read()
    sender_error = sender.stderr.read()
    sender.wait(timeout=10)
    assert sender.returncode == 0 and unlinker.returncode == 0, (sender_error, unlink_error)
    assert time.monotonic() - started >= 1.5, 'unlink did not wait for the locked dispatch authority'
    revoked = start(command('setup_provider_outbound_authorize', worker, {'intentId': prepared['outboundId']}))
    revoked.stdout.read()
    revoked_error = revoked.stderr.read()
    revoked.wait(timeout=10)
    assert revoked.returncode != 0 and 'LINK_NOT_FOUND' in revoked_error
    print(json.dumps({'concurrent_private_turns_serialized': True, 'no_lock_upgrade_deadlock': True, 'unlink_waited_for_claim_lock': True, 'post_unlink_send_authority_rejected': True}))
finally:
    run('begin;\n' +
        'delete from fmat.setup_provider_outbound where link_id in (select id from fmat.setup_channel_links where host_id=' + literal(host_id) + ');\n' +
        'delete from fmat.setup_provider_inbound where link_id in (select id from fmat.setup_channel_links where host_id=' + literal(host_id) + ');\n' +
        'delete from fmat.setup_channel_links where host_id=' + literal(host_id) + ';\n' +
        'delete from fmat.setup_channel_challenges where host_id=' + literal(host_id) + ';\n' +
        'delete from fmat.setup_conversations where host_id=' + literal(host_id) + ';\n' +
        'delete from fmat.hosts where id=' + literal(host_id) + ';\n' +
        'delete from fmat.invitations where id=' + literal(invitation_id) + ';\n' +
        'delete from fmat.idempotency where key like ' + literal(TAG + '%') + ';\n' +
        'delete from fmat.audit_events where actor->>\'id\' in (' + literal(host_id) + ',' + literal(TAG) + ');\ncommit;')
