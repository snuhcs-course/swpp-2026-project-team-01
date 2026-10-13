export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ service: 'find-me-a-time', status: 'reachable', releaseReady: false }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
