import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAction, parseCall, parseRoute, references, type Expression, type CallStatement } from '../core/statements';

function input(expression: string) {
  return parseCall(`结果 = call([语音:domain/合成:node], ${expression})`).input;
}
function invalid(source: string, message?: RegExp) {
  assert.throws(() => parseCall(source), (error: unknown) => {
    assert(error instanceof SyntaxError);
    assert.match(error.message, /字符位置 \d+：[\s\S]*[\u4e00-\u9fff]/u);
    if (message) assert.match(error.message, message);
    return true;
  }, source);
}

test('parses the call statement and retains its original source', () => {
  const source = ' 结果 = call([语音:domain/合成:node], {文本: 输入.播报文案, 数量: 3, 开关: true}) ';
  const statement: CallStatement = parseCall(source);
  assert.deepEqual(statement, {
    name: '结果', target: '[语音:domain/合成:node]',
    input: { 文本: { $: '输入.播报文案' }, 数量: 3, 开关: true }, source,
  });
});

test('supports recursively nested objects, arrays and JSON primitives', () => {
  assert.deepEqual(input('{数据: [null, false, true, 0, -12.5, 1e3, 2E-2, {子项: ["文本", 前一变量.数据.foo]}], 空对象: {}, 空数组: []}'), {
    数据: [null, false, true, 0, -12.5, 1000, 0.02, { 子项: ['文本', { $: '前一变量.数据.foo' }] }],
    空对象: {}, 空数组: [],
  });
  assert(Object.is(input('{负零: -0}').负零, -0));
});

test('supports both quotes, JSON escapes, Unicode escapes and literal code-like strings', () => {
  const expression = String.raw`{文本: 'it\'s "ok"', 转义: "\"\\\/\b\f\n\r\t\u4e2d\uD83D\uDE00", 代码: "eval('x'); ${'${输入.foo}'}"}`;
  assert.deepEqual(input(expression), {
    文本: 'it\'s "ok"', 转义: '"\\/\b\f\n\r\t中😀', 代码: "eval('x'); ${输入.foo}",
  });
});

test('accepts Unicode identifiers and normalizes whitespace in reference paths', () => {
  const source = '𠮷结果 = call([目标:node], {é: 输入 . 播报文案, e\u0301: 前一变量 . 数据 . foo, _值2: $变量.δ, "非标-键": 𠮷变量.字段})';
  assert.equal(parseCall(source).name, '𠮷结果');
  assert.deepEqual(parseCall(source).input, {
    é: { $: '输入.播报文案' }, é: { $: '前一变量.数据.foo' }, _值2: { $: '$变量.δ' }, '非标-键': { $: '𠮷变量.字段' },
  });
  assert.deepEqual(input('{"": "", "123": 1, true: false}'), { '': '', '123': 1, true: false });
  assert.deepEqual(input('{文本: "你好 " , 数量: 2 }'), {文本: '你好 ', 数量: 2});
});

test('references are full paths, unique in encounter order and never inferred from strings', () => {
  const value: Expression = input('{a: 输入.foo, b: [前一变量.数据.foo, {c: 输入.foo, d: 后续.数据.bar}], 文本: "输入.fake", 空: null}');
  assert.deepEqual(references(value), ['输入.foo', '前一变量.数据.foo', '后续.数据.bar']);
  assert.deepEqual(references({ $: '输入.foo' }), ['输入.foo']);
  for (const literal of [null, 1, true, '输入.foo', [], {}]) assert.deepEqual(references(literal), []);
});

test('only parses references; forward, self and whole-variable references require no scope', () => {
  const statement = parseCall('结果 = call([目标:node], {a: 后续.数据.foo, b: 结果.数据.bar, c: 未知变量, d: 输入})');
  assert.deepEqual(references(statement.input), ['后续.数据.foo', '结果.数据.bar', '未知变量', '输入']);
});

test('allows only one statement without a trailing semicolon or comments', () => {
  const source = '结果 = call([目标:node], {})';
  for (const ending of ['', ' \t\n']) assert.deepEqual(parseCall(source + ending).input, {});
  for (const ending of [';', '; x = call([目标:node], {})', '\nx = call([目标:node], {})', '//注释', '/*注释*/']) invalid(source + ending);
});

test('requires precisely a named assignment to call with two arguments', () => {
  for (const source of [
    '', 'call([目标:node], {})', 'let 结果 = call([目标:node], {})', '结果.foo = call([目标:node], {})',
    '结果 += call([目标:node], {})', '结果 == call([目标:node], {})', '结果 = other("目标", {})',
    '结果 = call.call([目标:node], {})', '结果 = call([目标:node])', '结果 = call([目标:node], {}, 3)',
    '结果 = call([目标:node], [])', '结果 = call([目标:node], null)',
    '结果 = call([目标:node], {})()', '结果 = call([目标:node], {}).foo',
    'true = call([目标:node], {})', 'null = call([目标:node], {})',
  ]) invalid(source);
});

test('requires a literal coordinate, without quotes or computation', () => {
  for (const target of ['""', '"[目标:node]"', "' \t '", '"\\n\\t"', '输入.目标', '`目标`', '"语音/" + "合成"', '("目标")', 'getTarget()', '3', 'null']) {
    invalid(`结果 = call(${target}, {})`);
  }
  assert.equal(parseCall('结果 = call([语音:domain/合成:node], {})').target, '[语音:domain/合成:node]');
});

test('call, go and write use the same literal-coordinate and packet arguments', () => {
  assert.deepEqual(parseCall('结果 = call([回声:node], input)').input, { $: 'input' });
  assert.deepEqual(parseRoute('go([完成:output], 结果.数据)').values, { $: '结果.数据' });
  assert.deepEqual(parseAction('write([交付记录:resource], {主体:output.主体})'), {
    kind: 'write', target: '[交付记录:resource]', values: {主体: {$: 'output.主体'}},
  });
  assert.throws(() => parseRoute('go [完成:output] {}'), /应为/);
  assert.throws(() => parseAction('[交付记录:resource] {主体:output.主体}'), /应为/);
  assert.throws(() => parseAction('go([登记交付:node], input)'), /当前输出包/);
});

test('only accepts finite JSON number syntax and JSON literal names', () => {
  for (const expression of ['+1', '.5', '01', '-01', '1.', '1e', '1e+', '- 1', '0x10', '1_000', '1n', '1e309', '-1e309', 'NaN', 'Infinity', '-Infinity', 'undefined']) {
    invalid(`结果 = call([目标:node], {值: ${expression}})`);
  }
  assert.deepEqual(input('{a: -1.25e+2, b: 0.5, c: 1E-2}'), { a: -125, b: 0.5, c: 0.01 });
});

test('rejects executable JavaScript constructs rather than evaluating them', () => {
  for (const expression of [
    'eval("throw 1")', 'call([嵌套:node], {})', 'fetch("https://example.com")',
    '(() => 1)()', 'function () {}', 'new Date()', '`插值${输入.foo}`',
    '1 + 2', '输入.foo || "默认"', '!true', 'true ? 1 : 0', '(输入.foo)',
    '输入["foo"]', '输入?.foo', '输入.foo = 1', '输入.foo++',
    '{...输入.foo}', '{[输入.foo]: 1}', '{get foo() { return 1 }}', '{foo() {}}', '{foo}',
    '[...输入.foo]', '/*注释*/ 1', '//注释\n1',
  ]) invalid(`结果 = call([目标:node], {值: ${expression}})`);
  for (const source of [
    '结果 = call([目标:node], {}); globalThis.injected = true',
    'while (true) {}', 'for (;;) {}', 'if (true) call([目标:node], {})',
  ]) invalid(source);
});

test('blocks dangerous names at every reference segment, object level and assignment', () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    for (const expression of [
      `{${key}: 1}`, `{"${key}": 1}`, `{嵌套: [{${key}: 1}]}`,
      `{值: ${key}.foo}`, `{值: 输入.${key}}`, `{值: 前一变量.数据.${key}.foo}`,
    ]) invalid(`结果 = call([目标:node], ${expression})`, /危险名称/);
    invalid(`${key} = call([目标:node], {})`, /危险名称/);
  }
  invalid(String.raw`结果 = call([目标:node], {"\u005f_proto__": 1})`, /危险名称/);
  assert.deepEqual(input('{toString: "普通键", 值: 输入.constructorName}'), { toString: '普通键', 值: { $: '输入.constructorName' } });
});

test('cannot forge reference nodes with a literal special $ key, even escaped or nested', () => {
  for (const expression of ['{$: "输入.foo"}', '{"$": "输入.foo"}', "{'$': '输入.foo'}", '{a: [{"$": "输入.foo"}]}', String.raw`{"\u0024": "输入.foo"}`]) {
    invalid(`结果 = call([目标:node], ${expression})`, /特殊 \$ 键/);
  }
  assert.deepEqual(input('{值: "{$: 输入.foo}", $普通键: 1}'), { 值: '{$: 输入.foo}', $普通键: 1 });
});

test('rejects duplicate decoded keys, not identical names in separate objects', () => {
  for (const expression of ['{a: 1, a: 2}', '{a: 1, "a": 2}', '{子项: {值: 1, 值: 2}}', String.raw`{"a": 1, "\u0061": 2}`]) {
    invalid(`结果 = call([目标:node], ${expression})`, /重复键/);
  }
  assert.deepEqual(input('{a: 1, b: {a: 2}}'), { a: 1, b: { a: 2 } });
});

test('rejects malformed strings, containers and field paths, including trailing commas', () => {
  for (const expression of [
    String.raw`{值: "\x41"}`, String.raw`{值: "\u{41}"}`, String.raw`{值: "\u123"}`,
    String.raw`{值: "\q"}`, '{值: "未结束}', '{值: "第一行\n第二行"}', '{值: "\u0000"}',
    '{值: "反斜杠' + '\\', '{值: [1,]}', '{值: [,1]}', '{值: [1,,2]}', '{值: 1,}',
    '{值: [1}', '{值: {a: 1}', '{值: 输入.}', '{值: 输入..foo}', '{值: 输入.3}',
    String.raw`{值: \u8f93入.foo}`, '{值 1}', '{123: 1}',
  ]) invalid(`结果 = call([目标:node], ${expression})`);
});

test('errors point at the offending character, including EOF and UTF-16 offsets', () => {
  const prefix = '𠮷结果 = call([目标:node], {})';
  assert.throws(() => parseCall(prefix + '!'), { message: `字符位置 ${prefix.length + 1}：语句末尾有多余内容` });
  const incomplete = '结果 = call([目标:node], {}';
  assert.throws(() => parseCall(incomplete), { message: `字符位置 ${incomplete.length + 1}：应为 )` });
  const duplicate = '结果 = call([目标:node], {a: 1, a: 2})';
  assert.throws(() => parseCall(duplicate), { message: `字符位置 ${duplicate.lastIndexOf('a:') + 1}：对象存在重复键 a` });
  const dangerous = '结果 = call([目标:node], {值: 输入.constructor})';
  assert.throws(() => parseCall(dangerous), { message: `字符位置 ${dangerous.indexOf('constructor') + 1}：禁止使用危险名称 constructor` });
  const escape = String.raw`结果 = call([目标:node], {值: "\q"})`;
  assert.throws(() => parseCall(escape), { message: `字符位置 ${escape.indexOf('\\q') + 1}：不支持的字符串转义` });
  const callee = '结果 = other("目标", {})';
  assert.throws(() => parseCall(callee), { message: `字符位置 ${callee.indexOf('other') + 1}：赋值右侧只能是 call 调用` });
});

test('limits source length to 16384 UTF-16 code units', () => {
  const empty = '结果 = call([目标:node], {值: ""})';
  const source = empty.replace('""', '"' + 'a'.repeat(16_384 - empty.length) + '"');
  assert.equal(source.length, 16_384);
  assert.equal((parseCall(source).input.值 as string).length, 16_384 - empty.length);
  invalid(source + ' ', /源长度不能超过 16384/);
});

test('limits combined object/array nesting to 32 levels including the input object', () => {
  const arrays = (count: number) => `{值: ${'['.repeat(count)}0${']'.repeat(count)}}`;
  const objects = (count: number) => '{值: '.repeat(count) + '0' + '}'.repeat(count);
  assert.doesNotThrow(() => input(arrays(31)));
  assert.doesNotThrow(() => input(objects(32)));
  invalid(`结果 = call([目标:node], ${arrays(32)})`, /嵌套不能超过 32 层/);
  invalid(`结果 = call([目标:node], ${objects(33)})`, /嵌套不能超过 32 层/);
  invalid(`结果 = call([目标:node], {值: ${'[{值: '.repeat(16)}0${'}]'.repeat(16)}})`, /嵌套不能超过 32 层/);
});
