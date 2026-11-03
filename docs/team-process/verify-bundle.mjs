// Read-only verifier: reconstruct each proposed final from the bound source and literal unified diff.
// Invocation: node docs/team-process/verify-bundle.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = dirname(fileURLToPath(import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(readFileSync(join(dir, 'five-target-manifest.json'), 'utf8'));
const diff = readFileSync(join(dir, 'five-targets.diff'), 'utf8');
assert.equal(manifest.targets.length, 5);
assert.equal((diff.match(/^diff --git /gm) || []).length, 5);
const sections = diff.split(/(?=^diff --git )/m).filter(Boolean);
for (let i = 0; i < 5; i++) {
  const t = manifest.targets[i];
  const source = readFileSync(t.oldPath);
  const final = readFileSync(join(dir, t.artifact));
  assert.equal(sha(source), t.sourceSha256, `${t.artifact}: baseline drift`);
  assert.equal(sha(final), t.finalSha256, `${t.artifact}: candidate drift`);
  const old = source.toString('utf8');
  const next = final.toString('utf8');
  assert.equal(old.charCodeAt(0) === 0xfeff, false);
  assert.equal(next.charCodeAt(0) === 0xfeff, false);
  assert.ok(old.endsWith('\n') && next.endsWith('\n'));
  const count = s => [(s.match(/\r\n/g) || []).length, (s.match(/(?<!\r)\n/g) || []).length];
  assert.deepEqual(count(old), [t.oldCRLF, t.oldLFOnly]);
  assert.deepEqual(count(next), [t.finalCRLF, t.finalLFOnly]);
  const lines = sections[i].split('\n');
  assert.equal(lines.shift(), `diff --git a/${t.oldPath} b/${t.newPath}`);
  assert.equal(lines.shift(), `--- a/${t.oldPath}`);
  assert.equal(lines.shift(), `+++ b/${t.newPath}`);
  const before = old.split('\n'); before.pop();
  const expected = next.split('\n'); expected.pop();
  const out = [];
  let cursor = 0;
  while (lines.length && lines[0].startsWith('@@ ')) {
    const header = lines.shift();
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    assert.ok(match, `invalid hunk ${header}`);
    const from = Number(match[1]) - 1;
    assert.ok(from >= cursor && from <= before.length);
    out.push(...before.slice(cursor, from));
    cursor = from;
    assert.equal(out.length + 1, Number(match[3]), 'new line offset');
    let removed = 0, added = 0;
    while (lines.length && !lines[0].startsWith('@@ ') && !lines[0].startsWith('diff --git ')) {
      const row = lines.shift();
      if (row === '') { assert.equal(lines.length, 0); break; }
      const content = row.slice(1);
      if (row.startsWith(' ') || row.startsWith('-')) {
        assert.equal(before[cursor++].replace(/\r$/, ''), content, `${t.artifact}: context mismatch at ${cursor}`);
        removed++;
      }
      if (row.startsWith(' ') || row.startsWith('+')) {
        // Git for Windows presents CRLF context without CR; unchanged bytes are taken
        // from the hash-bound source, rather than synthesized from displayed context.
        out.push(row.startsWith(' ') ? before[cursor - 1] : content);
        added++;
      }
      assert.ok(' +-'.includes(row[0]), `invalid patch row ${row}`);
    }
    assert.equal(removed, Number(match[2] ?? 1));
    assert.equal(added, Number(match[4] ?? 1));
  }
  assert.ok(lines.length === 0 || (lines.length === 1 && lines[0] === ''));
  out.push(...before.slice(cursor));
  assert.deepEqual(out, expected, `${t.artifact}: diff reconstruction`);
  assert.equal(sha(Buffer.from(out.join('\n') + '\n')), t.finalSha256);
  if (i) {
    const ref = `PROC-P01-P16-v1.3.md (version v1.3; SHA-256 ${manifest.targets[0].finalSha256})`;
    assert.ok(next.includes(ref), `${t.artifact}: PROC reference`);
    assert.ok(!next.includes('v1.2'), `${t.artifact}: stale reference`);
  } else {
    assert.ok(!next.includes('v1.2'));
    assert.ok(next.trimEnd().startsWith('# PROC-P01-P16 v1.3'));
    assert.ok(next.trimEnd().split('\n').at(-1).startsWith('Конец полного проекта.'));
  }
  console.log(`PASS ${t.artifact}: source/final SHA-256, newline counts, headers, hunks and reconstruction`);
}
console.log(`PASS exact five-target diff SHA-256 ${sha(Buffer.from(diff))}`);
