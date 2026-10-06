import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['node_modules', 'dist', '.vercel', '.local', '.git']);

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    if (ignored.has(entry.name) || entry.name.startsWith('.')) return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(target);
    return entry.isFile() && entry.name.endsWith('.md') ? [target] : [];
  }));
  return files.flat();
}

function headings(markdown) {
  const counts = new Map();
  const anchors = new Set();
  for (const line of markdown.split('\n')) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/u);
    if (!match) continue;
    const slug = match[1].replace(/[`*_]/gu, '').toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/ /gu, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    anchors.add(count ? `${slug}-${count}` : slug);
  }
  return anchors;
}

const files = [path.join(root, 'README.md')];
for (const directory of ['documentations', 'openspec', 'apps', 'scripts', 'supabase']) {
  files.push(...await markdownFiles(path.join(root, directory)));
}

const errors = [];
let checked = 0;
for (const file of files) {
  const markdown = await readFile(file, 'utf8');
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu)) {
    const url = match[1].replace(/^<|>$/gu, '');
    if (/^[a-z][a-z\d+.-]*:/iu.test(url) || url.startsWith('//')) continue;
    checked += 1;
    const [relative, fragment] = decodeURIComponent(url).split('#');
    const target = relative ? path.resolve(path.dirname(file), relative) : file;
    try {
      await stat(target);
      if (fragment && target.endsWith('.md')) {
        const anchors = headings(await readFile(target, 'utf8'));
        if (!anchors.has(fragment)) throw new Error('missing heading');
      }
    } catch (error) {
      errors.push(`${path.relative(root, file)}: ${url} (${error.code ?? error.message})`);
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${checked} local links in ${files.length} Markdown files.`);
}
