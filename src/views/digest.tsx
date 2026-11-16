import type { DigestNightResult, DigestRow } from '../digest/types.js';

function flagged(row: DigestRow): boolean {
  return row.retries >= 3 || row.lastStatus === 'fail' || row.warnings.length > 0;
}

export function DigestPage({ night, digest }: { night: string; digest: Exclude<DigestNightResult, { kind: 'missing' }> }) {
  return (
    <>
      <h1>digest · {night}</h1>
      {digest.badLineCount > 0 && (
        <p class="warn" role="status">{digest.badLineCount} invalid {digest.badLineCount === 1 ? 'line' : 'lines'} skipped.</p>
      )}
      {digest.kind === 'empty' ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th><th>owner</th><th>runs</th><th>retries</th><th>last status</th>
              <th>last error</th><th>first at</th><th>last at</th><th>warnings</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr class={flagged(row) ? 'warn' : undefined}>
                <td>{row.job}</td>
                <td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td>
                <td>{row.retries}</td>
                <td>{row.lastStatus}</td>
                <td>{row.lastError ?? '—'}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
                <td>{row.warnings.length ? row.warnings.join(' ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
