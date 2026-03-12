import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SNAPSHOT_PATH = resolve(process.cwd(), 'docs/analyst-api-contract.snapshot.json');
const UPDATE_MODE = process.argv.includes('--update');

const ANALYST_API_FILES = [
  'src/api/client.ts',
  'src/api/connectedAnalyst.ts',
  'src/api/corporate.ts',
  'src/api/damageAssessment.ts',
  'src/api/damageAssessmentV2.ts',
];

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readApiFile(relativePath) {
  const absPath = resolve(process.cwd(), relativePath);
  return readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
}

function buildCurrentSnapshot() {
  const files = {};
  for (const relativePath of ANALYST_API_FILES) {
    files[relativePath] = sha256(readApiFile(relativePath));
  }
  return { files };
}

function writeSnapshot(snapshot) {
  mkdirSync(resolve(process.cwd(), 'docs'), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function main() {
  const current = buildCurrentSnapshot();

  if (UPDATE_MODE || !existsSync(SNAPSHOT_PATH)) {
    writeSnapshot(current);
    console.log(`Analyst API contract snapshot ${UPDATE_MODE ? 'updated' : 'created'} at ${SNAPSHOT_PATH}`);
    return;
  }

  const expected = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const mismatches = [];

  for (const relativePath of ANALYST_API_FILES) {
    const currentHash = current.files[relativePath];
    const expectedHash = expected.files?.[relativePath];
    if (currentHash !== expectedHash) {
      mismatches.push({
        file: relativePath,
        expected: expectedHash || '(missing)',
        actual: currentHash,
      });
    }
  }

  if (mismatches.length > 0) {
    console.error('Analyst API contract check failed. Files changed:');
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch.file}`);
      console.error(`  expected: ${mismatch.expected}`);
      console.error(`  actual:   ${mismatch.actual}`);
    }
    console.error('If this API change is intentional, run: npm run contract:analyst-api:update');
    process.exit(1);
  }

  console.log('Analyst API contract check passed.');
}

main();
