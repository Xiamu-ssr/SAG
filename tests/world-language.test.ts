import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { reference, coordinateText } from '../core/coordinate';
import { parseWorld, applyDefaults, checkData, type Data } from '../core/model';
import { createRuntime, simulate, type Event } from '../core/engine';
import { frontendInput, frontendOutputs } from '../core/frontend';
import { loadWorldDirectory } from '../server/world-directory';
import { serviceRunner } from '../server/services';

const example = resolve('examples/photo-recognition');
const exampleSource = readFileSync(resolve(example, 'world.yaml'), 'utf8');
const entry = '前台/拍照识物';
const entryRef = '[前台:domain/拍照识物:node]';

test('typed references resolve absolute and local identity, never silently change type', () => {
  assert.equal(reference(['问题:packet'], 'packet', '前台/提问'), '前台/提问/问题');
  assert.equal(reference('[服务:domain/回声:node]', 'node', '前台/提问'), '服务/回声');
  assert.equal(reference(['回声:node'], 'node', '服务/提问'), '服务/回声');
  assert.equal(reference(['服务|前台:road'], 'road'), 'road:前台|服务');
  assert.equal(coordinateText('前台/提问/问题', 'packet'), '[前台:domain/提问:node/问题:packet]');
  for (const invalid of ['前台/提问', ['前台/提问'], ['问题:packet', '其他:packet'], ['前台:node/提问:domain'], ['constructor:packet'], ['前台:domain/提问:packet']])
    assert.throws(() => reference(invalid, 'node', '前台/提问'));
  const raw = parse(exampleSource);
  raw.domain.前台.node.拍照识物.input = ['展示:output'];
  assert.throws(() => parseWorld(stringify(raw)), /应引用 packet/);
  raw.domain.前台.node.拍照识物.input = ['前台:domain/拍照识物:node/缺失:packet'];
  assert.throws(() => parseWorld(stringify(raw)), /引用不存在/);
  const kind = parse(exampleSource);
  kind.fable = [[['前台:fable'], '坐标类型不符']];
  assert.throws(() => parseWorld(stringify(kind)), /寓言引用不存在/);
});

test('field shorthand and defaults are validated, copied and applied only to absent values', async () => {
  const loaded = loadWorldDirectory(example);
  const {world} = loaded;
  const request = frontendInput(world, '前台', entryRef, {});
  assert.deepEqual(request.input, {照片: 'samples/ginkgo.svg'});
  const run = await simulate(world, request, loaded.initial, serviceRunner(loaded));
  assert.equal(run.status, 'completed', run.error);
  assert.equal(frontendOutputs(world, '前台', run, run.duration)[entryRef].data.主体, '银杏叶');
  assert.throws(() => frontendInput(world, '前台', entryRef, {照片: 7}), /应为 text/);
  assert.throws(() => frontendInput(world, '前台', entryRef, {安全: true}), /未声明字段 安全/);
  const raw = parse(exampleSource);
  raw.domain.前台.node.拍照识物.packet.照片.照片.default = 7;
  assert.throws(() => parseWorld(stringify(raw)), /默认值.*应为 text/);
  const fields = {详情: {type: 'object' as const, default: {数量: 3}}};
  const a = applyDefaults({}, fields), b = applyDefaults({}, fields);
  checkData(a, fields, '包');
  (a.详情 as Record<string, unknown>).数量 = 9;
  assert.deepEqual(b, {详情: {数量: 3}});
});

test('packet contracts reject old nested declarations, and UI is the only special domain', () => {
  for (const shape of ['list', {type: 'object', field: {名称: 'text'}}, {type: 'object', item: 'text'}]) {
    const raw = parse(exampleSource);
    raw.domain.前台.node.拍照识物.packet.照片.附加 = shape;
    assert.throws(() => parseWorld(stringify(raw)), /附加/);
  }
  const raw = parse(exampleSource);
  raw.domain.云服务.type = 'service';
  assert.throws(() => parseWorld(stringify(raw)), /云服务.type/);
});

test('resource declarations reject invalid SQLite tables before initialization', () => {
  for (const [resource, error] of [
    [{空表: {field: {}}}, /resource\.空表\.field.*至少声明一个字段/],
    [{_SAG_CAPTURE: {field: {内容: 'text'}}}, /_SAG_CAPTURE.*保留/],
    [{sqlite_sample: {field: {内容: 'text'}}}, /sqlite_sample.*保留/],
    [{Records: {field: {内容: 'text'}}, records: {field: {内容: 'text'}}}, /records.*表名.*重复/],
    [{表: {field: {Flag: 'text', flag: 'text'}}}, /表\.field.*列名重复/],
  ] as const) {
    const raw = parse(exampleSource);
    Object.assign(raw.resource, resource);
    assert.throws(() => parseWorld(stringify(raw)), error);
  }
});

test('the UI observes its own output as the same packet goes downstream to be recorded', async () => {
  const loaded = loadWorldDirectory(example);
  const {world, initial} = loaded;
  const run = await simulate(world, {node: entry, input: {}}, initial, serviceRunner(loaded));
  assert.equal(run.status, 'completed', run.error);
  const reply = run.events.find(e => e.kind === 'reply' && e.node === 'ant服务器/识别')!;
  const resume = run.events.find(e => e.kind === 'resume' && e.node === entry)!;
  const output = run.events.find(e => e.kind === 'output' && e.node === entry)!;
  const delivery = run.events.find(e => e.kind === 'transfer' && e.direction === 'send')!;
  assert.equal(reply.callId, resume.callId);
  assert.equal(run.events.filter(e => e.kind === 'enter' && e.node === entry).length, 1);
  assert.deepEqual(frontendOutputs(world, '前台', run, output.time - 1), {});
  assert.deepEqual(frontendOutputs(world, '前台', run, output.time)[entryRef].data, reply.data);
  assert(!run.events.some(e => e.kind === 'reply' && e.node === entry));
  assert.equal(delivery.target, 'ant服务器/登记交付');
  assert.deepEqual(delivery.data, reply.data);
  assert.deepEqual(run.final.识别记录, [{状态: '已识别', 主体: '银杏叶'}]);
  assert.deepEqual(initial.识别记录, []);
  for (const transfer of run.events.filter(e => e.kind === 'transfer')) {
    assert.equal(transfer.arrivesAt! - transfer.time, 660);
    const arrived = run.events.find(e => e.cause === transfer.id && e.time === transfer.arrivesAt);
    if (transfer.resource) {
      assert.equal(arrived?.kind, transfer.direction);
      assert.equal(arrived?.resource, transfer.resource);
      assert.deepEqual(arrived?.data, transfer.data);
    } else {
      assert.equal(arrived?.node, transfer.target);
      assert(arrived?.kind === 'enter' || arrived?.kind === 'resume');
    }
  }
});

test('read takes the last matching row, including writes from earlier inputs', () => {
  const raw = parse(exampleSource);
  raw.domain.ant服务器.node.登记交付.logic[0] =
    '上次 = read([识别记录:resource], 状态 == "旧版" || 状态 == input.状态 && 主体 != "跳过")';
  const world = parseWorld(stringify(raw));
  const events: Event[] = [];
  const initial: Record<string, Data[]> = {
    识别记录: [
      {状态: '旧版', 主体: '跳过'},
      {状态: '已识别', 主体: '较新记录'},
      {状态: '已识别', 主体: '跳过'},
      {状态: '已识别'},
    ],
  };
  const runtime = createRuntime(world, initial, event => events.push(event));
  const node = 'ant服务器/登记交付';
  runtime.submit({node, input: {状态: '已识别', 主体: '本次'}});
  runtime.advanceTo(660);
  assert.deepEqual(events.find(e => e.kind === 'read')?.data, {分支: '找到', 数据: initial.识别记录[1]});
  runtime.advanceTo(1_619);
  assert.deepEqual(runtime.state, initial);
  runtime.advanceTo(1_620);
  assert.equal(runtime.state.识别记录.at(-1)?.主体, '本次');
  runtime.submit({node, input: {状态: '已识别', 主体: '下次'}});
  runtime.advanceTo(3_240);
  assert.deepEqual(events.filter(e => e.kind === 'read').at(-1)?.data, {分支: '找到', 数据: {状态: '已识别', 主体: '本次'}});
  assert.equal(events.filter(e => e.kind === 'output').at(-1)?.branch, '再次登记');
  assert.equal(initial.识别记录.length, 4);
  const legacy = simulate(world, {node, input: {状态: '其他'}}, initial);
  assert.deepEqual(legacy.events.find(e => e.kind === 'read')?.data, {分支: '找到', 数据: initial.识别记录[0]});
});

test('read filters are typed, and a row can be used after checking the result branch', () => {
  const raw = parse(exampleSource);
  const registration = raw.domain.ant服务器.node.登记交付;
  registration.route[0] = 'IF 上次.分支 == "找到" && (上次.数据.状态 == input.状态 || 上次.数据.主体 == "未知") go([再次登记:output], {状态: 上次.数据.状态, 主体: 上次.数据.主体})';
  assert.doesNotThrow(() => parseWorld(stringify(raw)));
  registration.route[0] = 'IF 上次.分支 == "找到" go([再次登记:output], input)';
  registration.route[1] = 'go([完成:output], {状态: 上次.数据.状态})';
  assert.throws(() => parseWorld(stringify(raw)), /未找到.*不存在/);
  registration.route[1] = 'go([完成:output], input)';
  for (const [filter, error] of [['{状态: input.状态}', /左边应为数据资源的字段名/], ['缺失 == 1', /未声明字段/], ['状态 == 1', /比较值类型不匹配/]] as const) {
    registration.logic[0] = `上次 = read([识别记录:resource], ${filter})`;
    assert.throws(() => parseWorld(stringify(raw)), error);
  }
});

test('annotated call results must point at a defined, matching packet', () => {
  assert.throws(() => parseWorld(exampleSource.replace('结果:[识物结果:packet]', '结果:[不存在:packet]')), /返回类型数据包不存在/);
  const raw = parse(exampleSource);
  raw.domain.前台.node.拍照识物.packet.错误类型 = {内容: 'number'};
  raw.domain.前台.node.拍照识物.logic[0] = raw.domain.前台.node.拍照识物.logic[0].replace('[识物结果:packet]', '[错误类型:packet]');
  assert.throws(() => parseWorld(stringify(raw)), /返回类型.*不匹配/);
});

test('forwarding a whole packet still checks the receiving contract', () => {
  const raw = parse(exampleSource);
  raw.domain.前台.node.拍照识物.logic[0] = '结果 = call([ant服务器:domain/识别:node], input.照片)';
  assert.throws(() => parseWorld(stringify(raw)), /应引用已声明的整包/);
  const extra = parse(exampleSource);
  extra.domain.ant服务器.node.识别.output.正常.logic[0] = '主体语音 = call([语音样例:service], {文本: "你好", 多余: 1})';
  assert.throws(() => parseWorld(stringify(extra)), /未声明字段 多余/);
  const wrong = parse(exampleSource);
  wrong.domain.前台.node.拍照识物.route[0] = 'go([展示:output], input)';
  assert.throws(() => parseWorld(stringify(wrong)), /缺少必填字段 状态/);
});

test('photo example returns playable audio through two calls to the same service after routing', async () => {
  const loaded = loadWorldDirectory(example);
  const {world, initial, assets} = loaded;
  const speak = serviceRunner(loaded);
  assert.equal(world.nodes.filter(n => n.domain === '前台').length, 1);
  for (const [file, photo] of [['ginkgo', '银杏叶'], ['cat', '橘猫'], ['butterfly', '蝴蝶'], ['frog', '树蛙']]) {
    const run = await simulate(world, {node: entry, input: {照片: `samples/${file}.svg`}}, initial, speak);
    assert.equal(run.status, 'completed', run.error);
    const calls = run.events.filter(e => e.kind === 'call' && e.target === 'service:语音样例');
    assert.equal(calls.length, 2);
    const reply = run.events.find(e => e.kind === 'output' && e.node === entry)!;
    assert.equal(reply.data.主体, photo);
    assert.deepEqual(calls.map(call => call.data.文本), [photo, reply.data.讲解]);
    for (const field of ['主体语音', '讲解语音']) {
      assert.equal(typeof reply.data[field], 'string');
      assert(Object.hasOwn(assets.前台, String(reply.data[field])));
    }
    const selected = run.events.find(e => e.kind === 'route' && e.node === 'ant服务器/识别')!;
    assert(calls.every(e => e.id > selected.id));
    assert.deepEqual(run.final.识别记录, [{状态: '已识别', 主体: photo}]);
  }
  assert.deepEqual(initial.识别记录, []);
});

test('low confidence and safety from the recognition node skip synthesis', () => {
  const {world, initial} = loadWorldDirectory(example);
  const raw = parse(exampleSource);
  const routes = raw.domain.云服务.node.识物.route;
  routes[0] = routes[0].replace('敏感:false', '敏感:true');
  const cases: {world: typeof world; input: Data; branch: string}[] = [
    {world, input: {照片: 'samples/unknown.svg'}, branch: '未识别'},
    {world: parseWorld(stringify(raw)), input: {}, branch: '安全'},
  ];
  for (const item of cases) {
    const run = simulate(item.world, {node: entry, input: item.input}, initial);
    assert.equal(run.status, 'completed', run.error);
    assert(!run.events.some(e => e.target === 'service:语音样例'));
    assert(run.coverage.includes(`ant服务器/识别#${item.branch}`));
  }
});

test('branch logic cannot recurse or leak variables to another branch', () => {
  const recursive = parse(exampleSource);
  recursive.domain.ant服务器.node.识别.output.正常.logic.push('循环 = call([识别:node], input)');
  assert.throws(() => parseWorld(stringify(recursive)), /递归|未声明/);
  const leaked = parse(exampleSource);
  leaked.domain.ant服务器.node.识别.route[0] = leaked.domain.ant服务器.node.识别.route[0].replace(
    '"这个东西可能有危险，请不要靠近"', '主体语音.数据.音频地址',
  );
  assert.throws(() => parseWorld(stringify(leaked)), /未声明/);
});
