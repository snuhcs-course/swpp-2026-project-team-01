import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Supabase remains the authentication authority; patch only its delivery settings.
export async function configureEmailSmtp({
  env = process.env,
  linkedProject,
  apply = false,
  fetcher = fetch,
}) {
  const project = env.SUPABASE_PROJECT_REF;
  if (
    !/^[a-z]{20}$/.test(project ?? '') || linkedProject !== project ||
    env.SUPABASE_URL !== `https://${project}.supabase.co`
  ) {
    throw new Error('Identify the exact linked Supabase project and URL before SMTP configuration');
  }
  if (
    !env.CLOUDFLARE_EMAIL_API_TOKEN ||
    !/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(env.CLOUDFLARE_EMAIL_FROM ?? '')
  ) {
    throw new Error('Cloudflare Email Sending token and verified sender address are required');
  }
  const settings = {
    smtp_host: 'smtp.mx.cloudflare.net',
    smtp_port: '465',
    smtp_user: 'api_token',
    smtp_admin_email: env.CLOUDFLARE_EMAIL_FROM,
    smtp_sender_name: 'Find Me a Time',
  };
  if (!apply) return { mode: 'preview', project, settings, password: '[redacted]' };
  if (!env.SUPABASE_ACCESS_TOKEN) {
    throw new Error('SUPABASE_ACCESS_TOKEN is required to apply SMTP settings');
  }
  const url = `https://api.supabase.com/v1/projects/${project}/config/auth`;
  const request = async (method, body) => {
    let response;
    try {
      response = await fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(
        `Supabase Auth ${method} response unavailable; inspect settings before retrying`,
      );
    }
    if (!response.ok) throw new Error(`Supabase Auth ${method} failed (${response.status})`);
    try {
      return await response.json();
    } catch {
      throw new Error('Invalid Auth configuration response');
    }
  };
  const before = await request('GET');
  if (before.hook_send_email_enabled) {
    throw new Error('An active Send Email Auth Hook overrides SMTP; reconcile it before applying');
  }
  await request('PATCH', { ...settings, smtp_pass: env.CLOUDFLARE_EMAIL_API_TOKEN });
  const after = await request('GET');
  if (
    after.hook_send_email_enabled ||
    Object.entries(settings).some(([key, value]) => String(after[key]) !== String(value))
  ) {
    throw new Error('SMTP settings readback did not match; inspect the identified Auth project');
  }
  return { mode: 'applied', project, settings, password: '[redacted]' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--apply')) {
      throw new Error('Usage: configure-email-smtp.mjs [--apply]');
    }
    const linkedProject = readFileSync('supabase/.temp/project-ref', 'utf8').trim();
    console.log(
      JSON.stringify(
        await configureEmailSmtp({ linkedProject, apply: process.argv.includes('--apply') }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
