export type Expression = string | number | boolean | null | Expression[] | { [key: string]: Expression };
export type CallStatement = { name: string; target: string; input: Record<string, Expression>; source: string; packet?: string };
export type ReadStatement = {kind: 'read'; name: string; target: string; where: Condition; source: string};
export type LogicStatement = (CallStatement & {kind: 'call'}) | ReadStatement;
const operators = ['==', '!=', '<=', '>=', '<', '>'] as const;
export type Comparison = {
  field: string;
  op: (typeof operators)[number];
  value: string | number | boolean | { $: string };
};
export type Condition = Comparison | {op: '&&' | '||'; left: Condition; right: Condition};
type Delivery = {target: string; values: Record<string, Expression>};
type Route = Delivery & {when?: Condition};
type Action = {kind: 'go'; target: string} | ({kind: 'write'} & Delivery) | {kind: 'return'};

export function fieldPath(value: Expression): string | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === 1 && Object.hasOwn(value, '$') && typeof value.$ === 'string')
    return value.$;
}

const MAX_SOURCE_LENGTH = 16_384;
const MAX_DEPTH = 32;
const IDENTIFIER = /^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*/u;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const DANGEROUS = new Set(['__proto__', 'prototype', 'constructor']);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

function readStatement(source: string) {
  let position = 0;
  let comparisons = 0;
  // Positions use one-based UTF-16 offsets, like JavaScript string indices.
  function fail(message: string, at = position): never {
    throw new SyntaxError(`字符位置 ${at + 1}：${message}`);
  }
  if (source.length > MAX_SOURCE_LENGTH) fail(`源长度不能超过 ${MAX_SOURCE_LENGTH} 个字符`, MAX_SOURCE_LENGTH);

  function space() {
    while (position < source.length && /\s/u.test(source[position])) position++;
  }
  function take(token: string): boolean {
    space();
    if (!source.startsWith(token, position)) return false;
    position += token.length;
    return true;
  }
  function expect(token: string) {
    if (!take(token)) fail(`应为 ${token}`);
  }
  function identifier(): string {
    space();
    const match = IDENTIFIER.exec(source.slice(position));
    if (!match) fail('应为标识符（可使用中文）');
    position += match[0].length;
    return match[0];
  }
  function safe(key: string, at: number) {
    if (DANGEROUS.has(key)) fail(`禁止使用危险名称 ${key}`, at);
  }
  function string(): string {
    space();
    const start = position;
    const quote = source[position++];
    if (quote !== '"' && quote !== "'") fail('应为单引号或双引号字符串', start);
    let result = '';
    while (position < source.length) {
      const at = position;
      const char = source[position++];
      if (char === quote) return result;
      if (char.charCodeAt(0) < 0x20) fail('字符串内不能直接包含换行或控制字符', at);
      if (char !== '\\') { result += char; continue; }
      const escape = source[position++];
      const escapes: Record<string, string> = { '"': '"', "'": "'", '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (Object.hasOwn(escapes, escape)) result += escapes[escape];
      else if (escape === 'u') {
        const hex = source.slice(position, position + 4);
        if (!/^[\da-fA-F]{4}$/.test(hex)) fail('Unicode 转义必须为 \\u 加四位十六进制数', at);
        result += String.fromCharCode(Number.parseInt(hex, 16));
        position += 4;
      } else fail('不支持的字符串转义', at);
    }
    fail('字符串缺少结束引号', start);
  }
  function depthLimit(depth: number) {
    if (depth > MAX_DEPTH) fail(`对象和数组嵌套不能超过 ${MAX_DEPTH} 层`);
  }
  function object(depth: number): Record<string, Expression> {
    depthLimit(depth);
    expect('{');
    const result: Record<string, Expression> = {};
    if (take('}')) return result;
    do {
      space();
      const at = position;
      const key = source[position] === '"' || source[position] === "'" ? string() : identifier();
      safe(key, at);
      if (key === '$') fail('对象不能直接声明特殊 $ 键；请使用字段路径引用', at);
      if (Object.hasOwn(result, key)) fail(`对象存在重复键 ${key}`, at);
      expect(':');
      result[key] = value(depth);
      if (take('}')) return result;
    } while (take(','));
    fail('对象字段之间应为逗号，末尾应为 }');
  }
  function array(depth: number): Expression[] {
    depthLimit(depth);
    expect('[');
    const result: Expression[] = [];
    if (take(']')) return result;
    do {
      result.push(value(depth));
      if (take(']')) return result;
    } while (take(','));
    fail('数组元素之间应为逗号，末尾应为 ]');
  }
  function value(depth: number): Expression {
    space();
    const char = source[position];
    if (char === '"' || char === "'") return string();
    if (char === '{') return object(depth + 1);
    if (char === '[') return array(depth + 1);
    const at = position;
    if (char === '-' || (char >= '0' && char <= '9')) {
      const match = NUMBER.exec(source.slice(position));
      if (!match) fail('应为 JSON 数字');
      position += match[0].length;
      const number = Number(match[0]);
      if (!Number.isFinite(number)) fail('数字必须为有限的 JSON 数字', at);
      return number;
    }
    const root = identifier();
    if (root === 'true') return true;
    if (root === 'false') return false;
    if (root === 'null') return null;
    if (LITERALS.has(root)) fail(`不支持 ${root}；仅允许 JSON 字面量或字段路径`, at);
    safe(root, at);
    return { $: path(root) };
  }
  function path(root: string) {
    let result = root;
    while (take('.')) {
      space();
      const at = position;
      const field = identifier();
      safe(field, at);
      result += '.' + field;
    }
    return result;
  }
  function coordinate() {
    space();
    const start = position;
    expect('[');
    const end = source.indexOf(']', position);
    if (end < 0) fail('世界坐标缺少 ]');
    const result = source.slice(start, end + 1);
    position = end + 1;
    return result;
  }
  function word(expected: string, message = `应为 ${expected}`) {
    space();
    const at = position;
    if (identifier() !== expected) fail(message, at);
  }
  function finish() {
    space();
    if (position !== source.length) fail('语句末尾有多余内容');
  }
  function targetArgument() {
    expect('(');
    const target = coordinate();
    expect(',');
    return target;
  }
  function delivery(): Delivery {
    const target = targetArgument();
    space();
    const at = position;
    const values = value(0);
    if (!values || typeof values !== 'object' || Array.isArray(values))
      return fail('第二个参数应为数据包或字段映射', at);
    expect(')');
    finish();
    return {target, values};
  }
  function conditionField() {
    const field = fieldPath(value(0));
    if (!field) return fail('比较左边应为字段路径');
    return field;
  }
  function column() {
    space();
    const match = /^[\p{L}\p{N}_-]+/u.exec(source.slice(position));
    if (!match) return fail('read 比较左边应为数据资源的字段名');
    safe(match[0], position);
    position += match[0].length;
    return match[0];
  }
  function comparison(left: () => string): Comparison {
    if (++comparisons > 64) fail('条件最多包含 64 个比较');
    const field = left();
    const op = operators.find(candidate => take(candidate));
    if (!op) return fail('比较应使用 ==、!=、<、<=、> 或 >=');
    const expected = value(0);
    if (typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean')
      return {field, op, value: expected};
    const reference = fieldPath(expected);
    if (reference) return {field, op, value: {$: reference}};
    return fail('比较右边应为字段路径、文本、数字或布尔值');
  }
  function predicate(leftField = conditionField, depth = 0): Condition {
    if (depth > MAX_DEPTH) fail(`条件嵌套不能超过 ${MAX_DEPTH} 层`);
    function term(): Condition {
      if (!take('(')) return comparison(leftField);
      const grouped = predicate(leftField, depth + 1);
      expect(')');
      return grouped;
    }
    function conjunction(): Condition {
      let left = term();
      while (take('&&')) left = {op: '&&', left, right: term()};
      return left;
    }
    let left = conjunction();
    while (take('||')) left = {op: '||', left, right: conjunction()};
    return left;
  }
  return {
    logic(required?: 'call'): LogicStatement {
      space();
      const at = position;
      const name = identifier();
      safe(name, at);
      if (LITERALS.has(name)) fail('赋值变量不能使用字面量名称', at);
      const packet = take(':') ? coordinate() : undefined;
      expect('=');
      space();
      const operationAt = position;
      const kind = identifier();
      if (required && kind !== required) fail('赋值右侧只能是 call 调用', operationAt);
      if (kind !== 'call' && kind !== 'read') fail('赋值右侧应为 call 或 read', operationAt);
      if (kind === 'read') {
        if (packet) fail('read 的返回字段由数据资源定义', operationAt);
        const target = targetArgument();
        const where = predicate(column);
        expect(')');
        finish();
        return {kind, name, target, where, source};
      }
      const {target, values: input} = delivery();
      return {kind, name, target, input, source, ...(packet ? {packet} : {})};
    },
    route(): Route {
      space();
      const at = position;
      const keyword = identifier();
      if (keyword === 'go') return delivery();
      if (keyword !== 'IF') fail('路由应以 IF 或 go 开头', at);
      const when = predicate();
      word('go');
      return {...delivery(), when};
    },
    action(): Action {
      const keyword = identifier();
      if (keyword === 'write') return {kind: 'write', ...delivery()};
      if (keyword === 'go') {
        const {target, values} = delivery();
        if (fieldPath(values) !== 'output') return fail('出口 go 的第二个参数须为当前输出包 output');
        return {kind: 'go', target};
      }
      if (keyword === 'return') {
        expect('(');
        expect(')');
        finish();
        return {kind: 'return'};
      }
      return fail('出口动作应为 write、go 或 return');
    },
  };
}

export const parseLogic = (source: string) => readStatement(source).logic();
export function parseCall(source: string): CallStatement {
  const {kind, ...call} = readStatement(source).logic('call') as Extract<LogicStatement, {kind: 'call'}>;
  return call;
}
export const parseRoute = (source: string) => readStatement(source).route();
export const parseAction = (source: string) => readStatement(source).action();

export function references(value: Expression): string[] {
  const result = new Set<string>();
  function visit(value: Expression) {
    if (value === null || typeof value !== 'object') return;
    const path = fieldPath(value);
    if (path) {
      result.add(path);
    } else {
      for (const item of Object.values(value)) visit(item);
    }
  }
  visit(value);
  return [...result];
}
