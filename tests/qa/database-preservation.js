const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '../..');
const backup = process.argv[2];
assert(backup, 'Provide the path to the pre-QA SQLite online backup');
const db = new Database(path.join(root, 'data/audits.db'), { readonly: true });
const quote = name => `"${name.replace(/"/g, '""')}"`;
try {
  const schema = () => db.prepare('SELECT name, sql FROM sqlite_schema ORDER BY name').all();
  const before = schema();
  for (let n = 0; n < 2; n++) {
    const init = spawnSync(process.execPath, ['-e', "require('./src/db')"], { cwd: root, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    assert.deepEqual(schema(), before, 'Schema initialization must be idempotent');
  }
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(db.pragma('foreign_key_check').length, 0);
  db.prepare('ATTACH DATABASE ? AS baseline').run(path.resolve(backup));
  const tables = db.prepare("SELECT name FROM baseline.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const result = [];
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA baseline.table_info(${quote(name)})`).all();
    const keys = columns.filter(c => c.pk).map(c => c.name);
    assert(keys.length, `No comparison key for ${name}`);
    const sameId = keys.map(key => `b.${quote(key)} IS c.${quote(key)}`).join(' AND ');
    const missing = db.prepare(`SELECT COUNT(*) AS n FROM baseline.${quote(name)} b WHERE NOT EXISTS (SELECT 1 FROM main.${quote(name)} c WHERE ${sameId})`).get().n;
    assert.equal(missing, 0, `Pre-existing ${name} records were deleted`);
    const originalCount = db.prepare(`SELECT COUNT(*) AS n FROM baseline.${quote(name)}`).get().n;
    if (['audits', 'interaction_runs'].includes(name)) {
      const changed = db.prepare(`SELECT COUNT(*) AS n FROM baseline.${quote(name)} b JOIN main.${quote(name)} c ON ${sameId} WHERE b.results_json IS NOT NULL AND b.results_json IS NOT c.results_json`).get().n;
      assert.equal(changed, 0, `Pre-existing ${name} report contents changed`);
    }
    result.push({ table: name, originalRecordsPreserved: originalCount });
  }
  console.log(JSON.stringify({ integrity: 'ok', foreignKeyErrors: 0, schemaInitializations: 2, tables: result }, null, 2));
} finally { db.close(); }
