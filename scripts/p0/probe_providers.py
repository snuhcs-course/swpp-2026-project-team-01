#!/usr/bin/env python3
# AI-generated with Codex, 2026-10-05 (Asia/Seoul).
"""Reproduce P0 checks without sending messages or changing provider configuration.

Uses the ignored root .env. Outputs only allowlisted diagnostics, never credentials
or customer content. Routes and synthetic model probes incur normal API usage.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def environment():
    env = dict(os.environ)
    if (ROOT / '.env').exists():
        for line in (ROOT / '.env').read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                name, value = line.split('=', 1)
                env.setdefault(name.strip(), value.strip().strip('\"').strip("'"))
    return env


def request(url, headers=None, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, headers=headers or {}, data=data)
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read())
        except ValueError:
            return error.code, {}
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None, {'transport_error': True}


def run_cli(args, env):
    try:
        result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=40)
        return result.returncode, json.loads(result.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None, None


def probe(env, routes=False, model=False):
    results = {}
    url = env.get('SUPABASE_URL', '').rstrip('/')
    if url:
        status, data = request(url + '/auth/v1/health', {'apikey': env.get('SUPABASE_PUBLISHABLE_KEY', '')})
        results['supabase_auth'] = {'http_status': status, 'version': data.get('version')}
        status, data = request(url + '/.well-known/oauth-authorization-server/auth/v1')
        results['supabase_oauth_discovery'] = {
            'http_status': status,
            'authorization_code': 'code' in data.get('response_types_supported', []),
            'pkce_s256': 'S256' in data.get('code_challenge_methods_supported', []),
            'dynamic_registration_advertised': bool(data.get('registration_endpoint')),
            'error_code': data.get('error_code'),
        }
        status, data = request(url + '/auth/v1/.well-known/jwks.json')
        results['supabase_jwks'] = {'http_status': status, 'algorithms': sorted({k.get('alg', '') for k in data.get('keys', [])})}
    if env.get('AGENTMAIL_API_KEY'):
        status, data = request('https://api.agentmail.to/v0/inboxes', {'Authorization': 'Bearer ' + env['AGENTMAIL_API_KEY']})
        results['agentmail_inbox_access'] = {'http_status': status, 'inbox_count': len(data.get('inboxes', [])), 'configured_inbox_visible': any(i.get('inbox_id') == env.get('AGENTMAIL_INBOX_ID') for i in data.get('inboxes', []))}
    if env.get('PHOTON_PROJECT_ID'):
        code, data = run_cli(['photon', 'projects', 'show', env['PHOTON_PROJECT_ID'], '--json'], env)
        results['photon_project_access'] = {'exit_code': code, 'project_matches': isinstance(data, dict) and data.get('id') == env['PHOTON_PROJECT_ID']}
        code, data = run_cli(['photon', 'spectrum', 'lines', 'list', '--json'], env)
        results['photon_lines'] = {'exit_code': code, 'line_count': len(data) if isinstance(data, list) else None}
    if routes and env.get('GOOGLE_MAPS_API_KEY'):
        # Public landmarks: Seoul City Hall -> Seoul Station. No private locations.
        points = [(37.5663, 126.9779), (37.5547, 126.9707)]
        waypoint = lambda p: {'location': {'latLng': {'latitude': p[0], 'longitude': p[1]}}}
        for mode in ['DRIVE', 'WALK', 'TRANSIT']:
            status, data = request('https://routes.googleapis.com/directions/v2:computeRoutes', {
                'Content-Type': 'application/json', 'X-Goog-Api-Key': env['GOOGLE_MAPS_API_KEY'],
                'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
            }, {'origin': waypoint(points[0]), 'destination': waypoint(points[1]), 'travelMode': mode})
            candidates = data.get('routes', [])
            results['seoul_routes_' + mode.lower()] = {'http_status': status, 'route_count': len(candidates), 'duration': candidates[0].get('duration') if candidates else None, 'distance_meters': candidates[0].get('distanceMeters') if candidates else None, 'error_status': data.get('error', {}).get('status')}
    if model and env.get('OPENAI_API_KEY'):
        name = env.get('OPENAI_MODEL', 'gpt-4o-mini-2024-07-18')
        status, data = request('https://api.openai.com/v1/responses', {
            'Authorization': 'Bearer ' + env['OPENAI_API_KEY'], 'Content-Type': 'application/json',
        }, {'model': name, 'store': False, 'max_output_tokens': 80,
            'input': 'Extract this synthetic scheduling request: a 30 minute online meeting. Return only the requested fields.',
            'text': {'format': {'type': 'json_schema', 'name': 'scheduling_probe', 'strict': True,
                'schema': {'type': 'object', 'properties': {'durationMinutes': {'type': 'integer'}, 'mode': {'type': 'string', 'enum': ['online', 'in_person']}}, 'required': ['durationMinutes', 'mode'], 'additionalProperties': False}}}})
        text = ''.join(c.get('text', '') for item in data.get('output', []) for c in item.get('content', []) if c.get('type') == 'output_text')
        try:
            valid = json.loads(text) == {'durationMinutes': 30, 'mode': 'online'}
        except ValueError:
            valid = False
        results['openai_structured_response'] = {'http_status': status, 'model': name, 'response_status': data.get('status'), 'synthetic_contract_passed': valid, 'error_code': (data.get('error') or {}).get('code')}
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--routes', action='store_true', help='Compute public Seoul landmark routes (billable API usage).')
    parser.add_argument('--model', action='store_true', help='Run a synthetic structured Responses request (billable API usage).')
    args = parser.parse_args()
    print(json.dumps(probe(environment(), args.routes, args.model), indent=2))
