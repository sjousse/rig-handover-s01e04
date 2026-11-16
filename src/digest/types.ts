export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
  /** Includes a warning whenever any run for this job had status `fail`. */
  warnings: string[];
};

export type DigestEventCounts = {
  ok: number;
  retry: number;
  fail: number;
};

type DigestReadSummary = {
  badLineCount: number;
  eventCounts: DigestEventCounts;
};

export type DigestNightResult =
  | ({ kind: 'missing' } & DigestReadSummary)
  | ({ kind: 'empty'; rows: [] } & DigestReadSummary)
  | ({ kind: 'present'; rows: DigestRow[] } & DigestReadSummary);

export declare function readNight(
  runsDir: string,
  night: string,
): Promise<DigestNightResult>;
