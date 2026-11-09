import assert from 'node:assert/strict';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {parse, stringify} from 'yaml';
import {createRuntime, simulate, type Event} from '../core/engine';
import {parseWorld} from '../core/model';
import {serviceRunner} from '../server/services';
import {loadWorldDirectory} from '../server/world-directory';
import {echoSource, echoStart} from './fixtures';
import {fixture, worldFolder} from './server-fixtures';

function adaptedSource() {
  const raw = parse(echoSource);
  raw.service = {远端: {script: 'services/echo.mjs', input: {内容: 'text'}, output: {内容: 'text'}}};
  raw.domain.前台.node.提问.logic[0] = '回应 = call([远端:service], input)';
  return stringify(raw);
}

test('an external call waits for its result, then resumes the caller and ignores completions after close', async () => {
  let clock = 0;
  const events: Event[] = [];
  const calls: {signal: AbortSignal; resolve: (value: unknown) => void}[] = [];
  const runtime = createRuntime(parseWorld(adaptedSource()), undefined, event => events.push(event), {
    time: () => clock,
    run: (_service, _input, signal) => new Promise(resolve => calls.push({signal, resolve})),
  });
  runtime.submit(echoStart);
  runtime.advanceTo(660);
  assert.equal(calls.length, 1);
  assert.equal(runtime.nextAt(), undefined);
  assert(!events.some(event => event.kind === 'resume'));
  clock = 3000;
  calls[0].resolve({内容: '服务回复'});
  await Promise.resolve();
  assert.equal(runtime.nextAt(), 3000);
  runtime.advanceTo(3659);
  assert(!events.some(event => event.kind === 'resume'));
  runtime.advanceTo(Infinity);
  assert.equal(events.find(event => event.kind === 'resume')?.time, 3660);
  assert.deepEqual(runtime.state.记录, [{内容: '服务回复'}]);

  runtime.submit(echoStart);
  runtime.advanceTo(Infinity);
  assert.equal(calls.length, 2);
  runtime.close();
  const count = events.length;
  assert(calls[1].signal.aborted);
  calls[1].resolve({内容: '迟到的回复'});
  await Promise.resolve();
  assert.equal(runtime.nextAt(), undefined);
  assert.equal(events.length, count);
});

test('directory checks do not execute scripts, and changed scripts or invalid output fail the call', async t => {
  const {root} = fixture(t);
  const directory = worldFolder(root, '脚本世界', adaptedSource());
  const script = join(directory, 'services', 'echo.mjs');
  const marker = join(directory, 'called.txt');
  assert.throws(() => loadWorldDirectory(directory), /echo\.mjs/);
  mkdirSync(join(directory, 'services'));
  writeFileSync(script, "import {writeFileSync} from 'node:fs';\nwriteFileSync('called.txt', 'yes');\nconsole.log(JSON.stringify({内容: 'ok'}));");
  const before = loadWorldDirectory(directory);
  assert(!existsSync(marker));
  writeFileSync(script, "console.log(JSON.stringify({内容: 7}));");
  const start = {node: echoStart.node, input: echoStart.input};
  const stale = await simulate(before.world, start, before.initial, serviceRunner(before));
  assert.equal(stale.status, 'failed');
  assert.match(stale.error!, /远端.*脚本已修改/);
  assert(!existsSync(marker));

  const after = loadWorldDirectory(directory);
  assert.notEqual(before.fingerprint, after.fingerprint);
  const invalid = await simulate(after.world, start, after.initial, serviceRunner(after));
  assert.equal(invalid.status, 'failed');
  assert.match(invalid.error!, /远端输出.*内容 应为 text/);
  assert.deepEqual(invalid.final.记录, []);
});
