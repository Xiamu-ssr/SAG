import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync,unlinkSync} from 'node:fs';
import {worldCommand} from '../server/world-cli';
import {fixture, worldFolder} from './server-fixtures';
import {echoSource} from './fixtures';

test('CLI validates the entire directory, and init-data never overwrites an existing SQLite file', async t => {
  const {directory, root}=fixture(t);
  const check=await worldCommand(['check',directory]);
  assert.equal(check.ok,true); assert.equal(check.nodes,2);
  const file=join(directory,'initial.sqlite'), before=readFileSync(file);
  await assert.rejects(()=>worldCommand(['init-data',directory]),/拒绝覆盖/);
  assert.deepEqual(readFileSync(file),before);
  unlinkSync(file); await worldCommand(['init-data',directory]);
  assert.equal((await worldCommand(['check',directory])).ok,true);
  const sqlitePrefix = worldFolder(root, 'SQLite 表名', echoSource.replaceAll('记录', 'sqlitex'));
  assert.equal((await worldCommand(['check',sqlitePrefix])).ok,true);
});
test('CLI has no legacy create/apply commands or remote library access', async()=>{
  for(const command of ['create','apply']) await assert.rejects(()=>worldCommand([command]),/用法/);
  for(const url of ['https://example.com','http://example.com','http://user:pass@localhost:4880','http://localhost:4880/elsewhere']) await assert.rejects(()=>worldCommand(['list'],url),/本地 HTTP/);
});
