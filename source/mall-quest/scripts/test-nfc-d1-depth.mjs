import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Real production SQL is captured from disposable business fixtures. Bound values
// never leave that fixture; the separate SQLite compiler receives only nulls.
const script = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');

async function capture(scope) {
  const fixture = await import('./business-fixture.mjs');
  const { setupFixtureGeofences, fixtureLocation } = await import('./geofence-fixture.mjs');
  if (scope === 'demo') fixture.mockModule('lib/application-scope.ts', {
    APP_BASE_PATH: '/demo', HARDWARE_DEMO_INSTANCE: true,
    appPath: value => '/demo' + value, stripAppPath: value => value.replace(/^\/demo(?=\/|$)/, '') || '/',
  });
  else assert.equal(fixture.load('lib/application-scope.ts').HARDWARE_DEMO_INSTANCE, false,
    'The production source must retain the disabled hardware-demo default');
  const prepare = fixture.d1.prepare;
  let finalSQL = null, bindCount = null;
  try {
    fixture.reset({ hardwareConfirmation: true });
    setupFixtureGeofences();
    fixture.run(`INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,status,created_at,updated_at)
      VALUES('depth-test-coupon','tea','Depth test reward','gift',0,0,24,'active',?,?)`, Date.now(), Date.now());
    fixture.run("UPDATE tasks SET reward_coupon_id='depth-test-coupon' WHERE id='quest-tea'");
    fixture.environment.RECORDING_SHORTCUT_LOGIN = 'true';
    const endpoint = 'http://localhost' + (scope === 'demo' ? '/demo' : '') + '/api/game';
    const call = (actor, action, input) => fixture.load('lib/game-server.ts').execute(actor, { action, ...input });
    const playerLogin = await call(new Request(endpoint), 'recordingLogin', { role: 'player' });
    const merchantLogin = await call(new Request(endpoint), 'recordingLogin', { role: 'merchant', storeId: 'tea' });
    const actor = login => new Request(endpoint, {
      headers: { Cookie: [login.setCookie].flat().map(value => value.split(';')[0]).join('; ') },
    });
    const player = actor(playerLogin), merchant = actor(merchantLogin);
    fixture.d1.prepare = function (sql) {
      const statement = prepare.call(this, sql);
      if (/^\s*UPDATE nfc_claim_drafts AS d SET state='issued'/.test(sql)) {
        assert.equal(finalSQL, null, 'The first real merchant confirmation must prepare exactly one final CAS');
        finalSQL = sql;
        const bind = statement.bind;
        statement.bind = function (...values) {
          bindCount = values.length; // Record arity only, never credentials or token values.
          return bind.apply(this, values);
        };
      }
      return statement;
    };
    const created = await call(player, 'nfcClaim', {
      taskId: 'quest-tea', deviceId: 'coin-tea-01', requestId: randomUUID(), location: fixtureLocation(),
    });
    assert.equal(created.draft.state, 'pending');
    const issued = await call(merchant, 'merchantIssueClaim', {
      draftId: created.draft.id, requestId: randomUUID(), expectedRevision: created.draft.revision,
      deviceCode: 'GTB-DEVICE:coin-tea-01', receivedDevice: true,
    });
    assert.equal(issued.newlyIssued, true);
    assert.equal(issued.draft.state, 'issued');
    assert.equal(issued.coupon.redeemedAt, null);
    assert.equal(fixture.get('SELECT COUNT(*) AS n FROM claims').n, 1);
    assert.equal(fixture.get('SELECT COUNT(*) AS n FROM nfc_draft_operations WHERE purpose=\'issue\'').n, 1);
    assert.equal(fixture.get('PRAGMA integrity_check').integrity_check, 'ok');
    assert.equal(fixture.all('PRAGMA foreign_key_check').length, 0);
    assert.equal(typeof finalSQL, 'string');
    assert(Number.isSafeInteger(bindCount) && bindCount > 0);
    return { scope, sql: finalSQL, bindCount, realMerchantIssue: 'PASS', memoryClaimCount: 1 };
  } finally {
    fixture.d1.prepare = prepare;
    delete fixture.environment.RECORDING_SHORTCUT_LOGIN;
    fixture.close();
  }
}

if (process.argv[2] === '--capture') {
  assert(['production', 'demo'].includes(process.argv[3]));
  process.stdout.write(JSON.stringify(await capture(process.argv[3])));
} else {
  const pythonCode = String.raw`
import json, sqlite3, sys
payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
connection = sqlite3.connect(':memory:')
try:
    for migration in payload['migrations']:
        connection.executescript(migration['sql'])
    connection.execute('PRAGMA foreign_keys=ON')
    triggers = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='trigger'")]
    for required in ['nfc_draft_issue','nfc_draft_operation','claim_points','ledger_balance']:
        assert required in triggers, 'Missing real claim trigger: ' + required
    connection.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 100)
    assert connection.getlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH) == 100
    try:
        connection.execute('EXPLAIN SELECT ' + ' AND '.join(['1'] * 101)).fetchall()
    except sqlite3.OperationalError as error:
        assert 'Expression tree is too large' in str(error), str(error)
    else:
        raise AssertionError('The expression-depth negative control did not fail at the configured limit')
    results = []
    for case in payload['cases']:
        before = connection.total_changes
        opcodes = connection.execute('EXPLAIN ' + case['sql'], [None] * case['bindCount']).fetchall()
        assert connection.total_changes == before, 'EXPLAIN must not execute the update'
        compiled_triggers = sorted(set(row[5][len('-- TRIGGER '):] for row in opcodes
                                      if row[1] == 'Init' and isinstance(row[5], str) and row[5].startswith('-- TRIGGER ')))
        for required in ['nfc_draft_issue','nfc_draft_operation','claim_points','ledger_balance']:
            assert required in compiled_triggers, 'The final CAS did not compile trigger: ' + required
        results.append({'scope': case['scope'], 'status': 'PASS', 'expressionDepthLimit': 100,
                        'boundValuePolicy': 'all-null', 'bindCount': case['bindCount'],
                        'opcodeCount': len(opcodes), 'compiledTriggers': compiled_triggers,
                        'compilerDatabaseWrites': connection.total_changes - before})
    print(json.dumps({'status': 'PASS', 'sqliteVersion': sqlite3.sqlite_version,
                      'migrationCount': len(payload['migrations']), 'depthNegativeControl': 'PASS',
                      'cases': results}, ensure_ascii=False))
finally:
    connection.close()
`;
  let python = null;
  for (const candidate of [{ command: 'python', args: ['-I'] }, { command: 'python3', args: ['-I'] }, { command: 'py', args: ['-3', '-I'] }]) {
    const probe = spawnSync(candidate.command, [...candidate.args, '-c',
      "import sqlite3; assert hasattr(sqlite3.Connection, 'setlimit'); print('SQLITE_LIMIT_AVAILABLE')"], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (probe.status === 0 && probe.stdout.trim() === 'SQLITE_LIMIT_AVAILABLE') { python = candidate; break; }
  }
  assert(python, 'Python 3.11+ with its standard-library sqlite3 is required; this test does not install packages');
  const cases = ['production', 'demo'].map(scope => {
    const child = spawnSync(process.execPath, [script, '--capture', scope], {
      cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    });
    assert.equal(child.status, 0, `Disposable ${scope} issue flow failed: ${child.stderr}`);
    return JSON.parse(child.stdout);
  });
  const migrations = readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()
    .map(name => ({ name, sql: readFileSync(path.join(root, 'drizzle', name), 'utf8') }));
  const result = spawnSync(python.command, [...python.args, '-c', pythonCode], {
    input: JSON.stringify({ cases, migrations }), encoding: 'utf8', timeout: 60000,
    maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  });
  assert.equal(result.status, 0, `Real merchant CAS failed compilation at D1's depth-100 cap: ${result.stderr}`);
  const compilation = JSON.parse(result.stdout);
  const report = {
    status: 'PASS', test: 'real-merchant-issue-d1-depth', ...compilation,
    source: ['lib/nfc-draft-server.ts', 'lib/account-authorization.ts', 'lib/hardware-demo-policy.ts']
      .map(file => ({ file, sha256: sha(readFileSync(path.join(root, file))) })),
    migrations: migrations.map(({ name, sql }) => ({ file: name, sha256: sha(sql) })),
    capturedSQL: cases.map(({ scope, sql, bindCount, realMerchantIssue, memoryClaimCount }) => ({
      scope, sha256: sha(sql), bytes: Buffer.byteLength(sql), bindCount, realMerchantIssue, memoryClaimCount,
    })),
    privateDatabaseWrites: 0, cloudRequests: 0, physicalDeviceWrites: 0,
    validationScope: 'Real isolated business flow plus EXPLAIN at SQLite expression depth 100; not a remote D1/browser/device test',
  };
  const reportOption = process.argv.indexOf('--report');
  if (reportOption >= 0) {
    const target = process.argv[reportOption + 1];
    assert(target, '--report requires a file path');
    mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  }
  for (const item of report.cases)
    console.log(`PASS ${item.scope}: real merchant issue CAS compiles at depth 100 (${item.bindCount} null bindings; ${item.compiledTriggers.length} real triggers)`);
  console.log(JSON.stringify(report));
}
