import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-29T01:00:00+01:00',
  job: 'lane/sync',
  status: 'ok',
  owner: 'rook',
};

describe('nightly log reader', () => {
  let runsDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-reader-'));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  async function writeNight(lines: unknown[], ending = '\n') {
    await writeFile(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join(ending) + ending);
  }

  it('reads the real night as five sorted jobs and one malformed line', async () => {
    const result = await readNight('runs', night);
    expect(result.kind).toBe('present');
    if (result.kind !== 'present') throw new Error('Expected the fixture night');
    expect(result.badLineCount).toBe(1);
    expect(result.eventCounts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(result.rows[0]).toMatchObject({ owner: null, runs: 1, retries: 0, lastError: null });
    expect(result.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00', warnings: [],
    });
    expect(result.rows[2]).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' });
    expect(result.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(result.rows[3].warnings).not.toHaveLength(0);
  });

  it('distinguishes a missing file from an empty file', async () => {
    expect(await readNight(runsDir, night)).toEqual({
      kind: 'missing', badLineCount: 0, eventCounts: { ok: 0, retry: 0, fail: 0 },
    });
    await writeFile(join(runsDir, `${night}.jsonl`), '');
    expect(await readNight(runsDir, night)).toEqual({
      kind: 'empty', rows: [], badLineCount: 0, eventCounts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['\n', '\r\n', ''])('does not count a normal final terminator %j as a bad line', async (ending) => {
    await writeNight([event], ending);
    expect(await readNight(runsDir, night)).toMatchObject({ kind: 'present', badLineCount: 0, eventCounts: { ok: 1, retry: 0, fail: 0 } });
  });

  it('counts invalid JSON and invalid event shapes, continuing with valid events', async () => {
    const invalid = [
      null, [], 42, 'text', {},
      { ...event, at: 42 }, { ...event, at: 'not a timestamp' },
      { ...event, job: null }, { ...event, job: ' ' },
      { ...event, status: 'unknown' }, { ...event, status: ['ok'] },
      { ...event, owner: undefined }, { ...event, owner: 42 },
      { ...event, error: null }, { ...event, error: {} },
    ];
    await writeFile(join(runsDir, `${night}.jsonl`), [
      JSON.stringify(event), ...invalid.map((line) => JSON.stringify(line)), '{bad', '', JSON.stringify(event),
    ].join('\n') + '\n');
    expect(await readNight(runsDir, night)).toMatchObject({
      kind: 'present', badLineCount: invalid.length + 2,
      eventCounts: { ok: 2, retry: 0, fail: 0 }, rows: [{ job: event.job, runs: 2 }],
    });
  });

  it('keeps a corrupt-only file distinct from an empty file', async () => {
    await writeNight([null, {}]);
    expect(await readNight(runsDir, night)).toEqual({
      kind: 'present', rows: [], badLineCount: 2, eventCounts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('uses chronological times across offsets and keeps failure warnings after recovery', async () => {
    await writeNight([
      { ...event, at: '2026-10-29T01:20:00+01:00', owner: null },
      { ...event, at: '2026-10-29T02:00:00+02:00', status: 'fail', error: 'first failure' },
      { ...event, at: '2026-10-29T00:10:00Z', status: 'retry', error: 'last error' },
    ]);
    const result = await readNight(runsDir, night);
    expect(result).toMatchObject({
      kind: 'present', badLineCount: 0, eventCounts: { ok: 1, retry: 1, fail: 1 },
      rows: [{
        job: event.job, owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'last error',
        firstAt: '2026-10-29T02:00:00+02:00', lastAt: '2026-10-29T01:20:00+01:00',
      }],
    });
    if (result.kind !== 'present') throw new Error('Expected the test night');
    expect(result.rows[0].warnings).not.toHaveLength(0);
  });

  it.each(['../2026-10-28', '..\\2026-10-28', '/2026-10-28', '2026-10-28.jsonl', '2026-02-30', '2026-13-01', ''])('rejects invalid night %j', async (invalidNight) => {
    expect(await readNight(runsDir, invalidNight)).toEqual({
      kind: 'missing', badLineCount: 0, eventCounts: { ok: 0, retry: 0, fail: 0 },
    });
  });
});
