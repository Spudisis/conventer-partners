#!/usr/bin/env node
// Headless CLI for the SVG/WebP converter — same pipeline as the web UI, no UI.
//
// Usage:  node scripts/convert.mjs <files-or-dirs...> [options]
// See --help, or README.md § "Script / CLI usage".

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import { build } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'scripts/headless/entry.ts');
const CACHE_DIR = path.join(ROOT, 'node_modules/.cache/converter-cli');

const MIME_BY_EXT = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const FILL_METHODS = ['default', 'cutout', 'foreground', 'two-tone'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.idea', '.vscode']);

const HELP = `
Convert logos to the 178x82 brand-coloured SVG (and WebP), headlessly.

  node scripts/convert.mjs <files-or-dirs...> [options]

Options
  -o, --out <dir>       Output directory (default: ./converted)
  -f, --format <fmt>    svg | webp | both                 (default: both)
  -s, --scale <n>       WebP retina scale, 1-4            (default: 3)
      --fill <method>   ${FILL_METHODS.join(' | ')}
                        Vector-SVG background handling    (default: default)
  -p, --padding <spec>  auto | none | "N" | "V,H" | "T,R,B,L"
                        Padding in card units             (default: auto)
      --name <base>     Output base name (single input only)
      --json            Print a JSON report on stdout
  -q, --quiet           Suppress per-file progress lines
  -h, --help            Show this help

Directories are scanned recursively for .svg .png .jpg .jpeg .webp.
Exit code is 1 if any input failed to convert.

Examples
  node scripts/convert.mjs logo.png -o ./assets
  node scripts/convert.mjs ./logos -f webp -s 3 --json
  node scripts/convert.mjs card.svg --fill cutout --padding 5,15
`.trimStart();

// --- argument parsing --------------------------------------------------------

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

function parsePadding(spec) {
  if (!spec || spec === 'auto') return 'auto';
  if (spec === 'none') return { top: 0, right: 0, bottom: 0, left: 0 };

  const parts = spec.split(',').map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n))) fail(`invalid --padding: ${spec}`);

  if (parts.length === 1) {
    const [all] = parts;
    return { top: all, right: all, bottom: all, left: all };
  }
  if (parts.length === 2) {
    const [v, h] = parts;
    return { top: v, right: h, bottom: v, left: h };
  }
  if (parts.length === 4) {
    const [top, right, bottom, left] = parts;
    return { top, right, bottom, left };
  }
  return fail(`--padding takes 1, 2 or 4 numbers (got ${parts.length})`);
}

function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        format: { type: 'string', short: 'f' },
        scale: { type: 'string', short: 's' },
        fill: { type: 'string' },
        padding: { type: 'string', short: 'p' },
        name: { type: 'string' },
        json: { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    return fail(err.message);
  }

  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    process.exit(positionals.length === 0 && !values.help ? 2 : 0);
  }

  const format = values.format ?? 'both';
  if (!['svg', 'webp', 'both'].includes(format)) fail(`invalid --format: ${format}`);

  const fill = values.fill ?? 'default';
  if (!FILL_METHODS.includes(fill)) fail(`invalid --fill: ${fill}`);

  const scale = values.scale === undefined ? 3 : Number(values.scale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 8) fail(`invalid --scale: ${values.scale}`);

  if (values.name && positionals.length > 1) fail('--name only works with a single input file');

  return {
    inputs: positionals,
    out: path.resolve(values.out ?? 'converted'),
    format,
    fill,
    scale,
    padding: parsePadding(values.padding),
    name: values.name ?? null,
    json: Boolean(values.json),
    quiet: Boolean(values.quiet) || Boolean(values.json),
  };
}

// --- input collection --------------------------------------------------------

async function walk(dir, found) {
  for (const dirent of await readdir(dir, { withFileTypes: true })) {
    if (dirent.name.startsWith('.') && dirent.isDirectory()) continue;
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (!SKIP_DIRS.has(dirent.name)) await walk(full, found);
    } else if (MIME_BY_EXT[path.extname(dirent.name).toLowerCase()]) {
      found.push(full);
    }
  }
}

async function collectInputs(inputs) {
  const files = [];
  for (const input of inputs) {
    const full = path.resolve(input);
    let info;
    try {
      info = await stat(full);
    } catch {
      fail(`no such file or directory: ${input}`);
    }
    if (info.isDirectory()) {
      const found = [];
      await walk(full, found);
      found.sort();
      if (found.length === 0) fail(`no convertible images found in ${input}`);
      files.push(...found);
    } else if (MIME_BY_EXT[path.extname(full).toLowerCase()]) {
      files.push(full);
    } else {
      fail(`unsupported file type: ${input} (expected ${Object.keys(MIME_BY_EXT).join(', ')})`);
    }
  }
  return [...new Set(files)];
}

// --- bundling the browser-side pipeline --------------------------------------

// The bundle only changes when the source does, so cache it — a warm run skips
// the ~1s Vite build entirely.
async function sourceStamp() {
  const parts = [];
  const roots = [path.join(ROOT, 'src'), path.join(ROOT, 'scripts/headless')];
  for (const root of roots) {
    const files = [];
    await collectAllFiles(root, files);
    files.sort();
    for (const file of files) {
      const info = await stat(file);
      parts.push(`${path.relative(ROOT, file)}:${info.size}:${info.mtimeMs}`);
    }
  }
  return createHash('sha1').update(parts.join('\n')).digest('hex');
}

async function collectAllFiles(dir, found) {
  for (const dirent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) await collectAllFiles(full, found);
    else found.push(full);
  }
}

async function getBundle() {
  const stamp = await sourceStamp();
  const bundleFile = path.join(CACHE_DIR, 'entry.iife.js');
  const stampFile = path.join(CACHE_DIR, 'stamp.txt');

  if (existsSync(bundleFile) && existsSync(stampFile)) {
    if ((await readFile(stampFile, 'utf8')).trim() === stamp) return readFile(bundleFile, 'utf8');
  }

  const result = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      minify: false,
      target: 'chrome120',
      lib: { entry: ENTRY, formats: ['iife'], name: 'ConverterHeadless' },
    },
  });

  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunk = output.find((o) => o.type === 'chunk');
  if (!chunk) throw new Error('Failed to bundle the conversion pipeline');

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(bundleFile, chunk.code);
  await writeFile(stampFile, stamp);
  return chunk.code;
}

// --- headless page -----------------------------------------------------------

// Blob URLs and canvas readback need a real (non-opaque) origin, so the page is
// served over loopback rather than about:blank.
function startOriginServer() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>converter</title>');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function launchBrowser() {
  const attempts = [];
  if (process.env.CHROME_PATH) {
    attempts.push(() => chromium.launch({ executablePath: process.env.CHROME_PATH }));
  }
  attempts.push(() => chromium.launch());
  attempts.push(() => chromium.launch({ channel: 'chrome' }));

  const errors = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      errors.push(err.message.split('\n')[0]);
    }
  }
  throw new Error(
    `Could not launch a Chromium browser.\n${errors.map((e) => `  - ${e}`).join('\n')}\n` +
      'Install one with: pnpm exec playwright install chromium  (or set CHROME_PATH)',
  );
}

// --- output naming -----------------------------------------------------------

function uniqueName(base, taken) {
  let name = base;
  let n = 2;
  while (taken.has(name)) name = `${base}-${n++}`;
  taken.add(name);
  return name;
}

// Absolute paths outside the cwd read better than a stack of '../' segments.
function displayPath(target) {
  const rel = path.relative(process.cwd(), target);
  return rel.startsWith('..') ? target : rel || '.';
}

function formatBytes(n) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
}

// --- main --------------------------------------------------------------------

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const files = await collectInputs(opts.inputs);

  const bundle = await getBundle();
  const { server, port } = await startOriginServer();
  const browser = await launchBrowser();

  const results = [];
  let failed = 0;

  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => Boolean(window.__converter));

    await mkdir(opts.out, { recursive: true });
    const taken = new Set();

    for (const file of files) {
      const base = opts.name ?? path.basename(file, path.extname(file));
      const outBase = uniqueName(base, taken);
      const record = { input: file, name: outBase, svg: null, webp: null, error: null };

      try {
        const bytes = await readFile(file);
        const result = await page.evaluate(
          (req) => window.__converter.convert(req),
          {
            name: path.basename(file),
            mime: MIME_BY_EXT[path.extname(file).toLowerCase()],
            base64: bytes.toString('base64'),
            fill: opts.fill,
            padding: opts.padding,
            webpScale: opts.format === 'svg' ? null : opts.scale,
          },
        );

        record.padding = result.padding;
        record.isVectorSvg = result.isVectorSvg;

        if (opts.format !== 'webp') {
          const dest = path.join(opts.out, `${outBase}.svg`);
          await writeFile(dest, result.svg, 'utf8');
          record.svg = { path: dest, bytes: Buffer.byteLength(result.svg) };
        }
        if (opts.format !== 'svg' && result.webpBase64) {
          const dest = path.join(opts.out, `${outBase}.webp`);
          const buf = Buffer.from(result.webpBase64, 'base64');
          await writeFile(dest, buf);
          record.webp = { path: dest, bytes: buf.length, scale: opts.scale };
        }

        if (!opts.quiet) {
          const written = [record.svg, record.webp]
            .filter(Boolean)
            .map((f) => `${displayPath(f.path)} (${formatBytes(f.bytes)})`)
            .join(', ');
          process.stdout.write(`✓ ${displayPath(file)} → ${written}\n`);
        }
      } catch (err) {
        failed++;
        const message = String(err?.message ?? err).split('\n')[0];
        record.error = pageErrors.length ? `${message} | ${pageErrors.join(' | ')}` : message;
        process.stderr.write(`✗ ${displayPath(file)}: ${record.error}\n`);
      } finally {
        pageErrors.length = 0;
      }

      results.push(record);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ outDir: opts.out, format: opts.format, fill: opts.fill, scale: opts.scale, converted: results.length - failed, failed, results }, null, 2)}\n`,
    );
  } else if (!opts.quiet && files.length > 1) {
    process.stdout.write(`\n${results.length - failed}/${results.length} converted → ${displayPath(opts.out)}\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`error: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
