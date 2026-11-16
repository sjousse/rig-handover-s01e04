import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestNightResult, DigestRow, DigestStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('at' in value) || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))) return false;
  if (!('job' in value) || typeof value.job !== 'string' || value.job.trim() === '') return false;
  if (!('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return false;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return false;
  return !('error' in value) || typeof value.error === 'string';
}

function isNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const date = new Date(`${night}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === night;
}

export async function readNight(runsDir: string, night: string): Promise<DigestNightResult> {
  const eventCounts = { ok: 0, retry: 0, fail: 0 };
  const missing: DigestNightResult = { kind: 'missing', badLineCount: 0, eventCounts };
  if (!isNight(night)) return missing;

  let contents: string;
  try {
    contents = await readFile(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return missing;
    throw error;
  }
  if (contents.length === 0) return { kind: 'empty', rows: [], badLineCount: 0, eventCounts };

  const lines = contents.split(/\r?\n/);
  // A final line terminator closes the preceding record; it is not another record.
  if (lines.at(-1) === '') lines.pop();

  const events: RunEvent[] = [];
  let badLineCount = 0;
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (isRunEvent(value)) events.push(value);
      else badLineCount += 1;
    } catch {
      badLineCount += 1;
    }
  }

  // Timestamp order, rather than string or file order, handles offsets and delayed writes.
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const jobs = new Map<string, DigestRow>();
  for (const event of events) {
    eventCounts[event.status] += 1;
    let row = jobs.get(event.job);
    if (!row) {
      row = {
        job: event.job,
        owner: event.owner,
        runs: 0,
        retries: 0,
        lastStatus: event.status,
        lastError: null,
        firstAt: event.at,
        lastAt: event.at,
        warnings: [],
      };
      jobs.set(event.job, row);
    }
    row.owner = event.owner;
    row.runs += 1;
    if (event.status === 'retry') row.retries += 1;
    row.lastStatus = event.status;
    if (event.error !== undefined) row.lastError = event.error;
    row.lastAt = event.at;
    if (event.status === 'fail' && row.warnings.length === 0) row.warnings.push('A run failed.');
  }

  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { kind: 'present', rows, badLineCount, eventCounts };
}
