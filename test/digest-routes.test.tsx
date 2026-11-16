import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

function event(job: string, status: 'ok' | 'retry' | 'fail', at: string, extra: Record<string, unknown> = {}) {
  return { at, job, status, owner: 'rook', ...extra };
}

describe('digest routes', () => {
  let runsDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  async function writeNight(contents: string) {
    await writeFile(join(runsDir, `${night}.jsonl`), contents, 'utf8');
  }

  function app() {
    return createApp({ ...config, runsDir });
  }

  it('serves a successful HTML page and JSON result for the same night', async () => {
    await writeNight(`${JSON.stringify(event('lane/sync', 'ok', '2026-10-29T01:00:00+01:00'))}\n`);
    const server = app();

    const [htmlResponse, jsonResponse] = await Promise.all([
      server.request(`/digest/${night}`),
      server.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const json = await jsonResponse.json();

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('<h1>digest · 2026-10-28</h1>');
    expect(html).toContain('<td>lane/sync</td>');
    expect(jsonResponse.status).toBe(200);
    expect(json).toMatchObject({
      kind: 'present',
      badLineCount: 0,
      rows: [{ job: 'lane/sync', lastStatus: 'ok' }],
    });
  });

  it('returns 404 for a missing night on both routes', async () => {
    const server = app();
    const [htmlResponse, jsonResponse] = await Promise.all([
      server.request(`/digest/${night}`),
      server.request(`/api/digest/${night}`),
    ]);

    expect(htmlResponse.status).toBe(404);
    expect(await htmlResponse.text()).toContain('Night not found');
    expect(jsonResponse.status).toBe(404);
    expect(await jsonResponse.json()).toMatchObject({ kind: 'missing' });
  });

  it('renders an empty night without a table and returns empty JSON', async () => {
    await writeNight('');
    const server = app();
    const [htmlResponse, jsonResponse] = await Promise.all([
      server.request(`/digest/${night}`),
      server.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table>');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toMatchObject({ kind: 'empty', rows: [] });
  });

  it('counts malformed lines while rendering valid records and sorting HTML like JSON', async () => {
    const records = [
      JSON.stringify(event('zeta/job', 'ok', '2026-10-29T01:00:00+01:00')),
      '{broken json',
      JSON.stringify(event('alpha/job', 'ok', '2026-10-29T01:01:00+01:00')),
    ];
    await writeNight(`${records.join('\n')}\n`);
    const server = app();
    const [htmlResponse, jsonResponse] = await Promise.all([
      server.request(`/digest/${night}`),
      server.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const json = await jsonResponse.json() as {
      kind: string;
      badLineCount: number;
      rows: Array<{ job: string }>;
    };

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('1 invalid line skipped.');
    expect(html).toContain('<td>alpha/job</td>');
    expect(html).toContain('<td>zeta/job</td>');
    expect(jsonResponse.status).toBe(200);
    expect(json).toMatchObject({ kind: 'present', badLineCount: 1 });
    const jsonJobs = json.rows.map((row) => row.job);
    const htmlRows = html.match(/<tr(?: [^>]*)?>[\s\S]*?<\/tr>/g) ?? [];
    const htmlJobs = htmlRows.slice(1).map((row) => row.match(/<td>(.*?)<\/td>/)?.[1]);
    expect(htmlJobs).toEqual(jsonJobs);
  });

  it('shows null owners as an em dash and keeps retry and recovered failure warnings', async () => {
    const records = [
      event('digest/render', 'retry', '2026-10-29T01:00:00+01:00', { owner: null, error: 'upstream 503' }),
      event('digest/render', 'retry', '2026-10-29T01:01:00+01:00', { owner: null }),
      event('digest/render', 'retry', '2026-10-29T01:02:00+01:00', { owner: null }),
      event('digest/render', 'fail', '2026-10-29T01:03:00+01:00', { owner: null, error: 'quota exceeded' }),
      event('digest/render', 'ok', '2026-10-29T01:04:00+01:00', { owner: null }),
    ];
    await writeNight(`${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    const server = app();
    const [htmlResponse, jsonResponse] = await Promise.all([
      server.request(`/digest/${night}`),
      server.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const json = await jsonResponse.json() as {
      rows: Array<{
        owner: string | null;
        retries: number;
        lastStatus: string;
        warnings: string[];
        firstAt: string;
        lastAt: string;
      }>;
    };

    expect(html).toContain('<td>—</td>');
    expect(html).toContain('<tr class="warn">');
    expect(html).toContain('A run failed.');
    expect(html).toContain('<td>2026-10-29T01:00:00+01:00</td>');
    expect(html).toContain('<td>2026-10-29T01:04:00+01:00</td>');
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0]).toMatchObject({
      owner: null,
      retries: 3,
      lastStatus: 'ok',
      warnings: ['A run failed.'],
      firstAt: '2026-10-29T01:00:00+01:00',
      lastAt: '2026-10-29T01:04:00+01:00',
    });
  });

  it('escapes log text and renders pages without client scripts', async () => {
    await writeNight(`${JSON.stringify(event('<img src=x onerror=alert(1)>', 'ok', '2026-10-29T01:00:00+01:00', { error: '<script>alert(1)</script>' }))}\n`);
    const response = await app().request(`/digest/${night}`);
    const html = await response.text();

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script(?:\s|>)/i);
  });
});
