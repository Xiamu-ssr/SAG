export type SubjectType = 'domain' | 'node' | 'packet' | 'output' | 'resource' | 'service' | 'fable' | 'road';
const safeName = /^[\p{L}\p{N}_-]+$/u;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const kinds = new Set<SubjectType>(['domain', 'node', 'packet', 'output', 'resource', 'service', 'fable', 'road']);

export function referenceType([value]: [string]): SubjectType {
  return value.slice(value.lastIndexOf(':') + 1) as SubjectType;
}

export function reference(value: unknown, expected?: SubjectType, context?: string): string {
  let text: string;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') text = value[0];
  else if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) text = value.slice(1, -1);
  else throw new Error('坐标应写为 [名称:类型]');
  const parts = text.split('/').map(part => {
    const at = part.lastIndexOf(':');
    const name = part.slice(0, at), type = part.slice(at + 1) as SubjectType;
    if (at < 1 || !kinds.has(type)) throw new Error(`坐标缺少有效类型：${part}`);
    if (type === 'road') {
      if (!name.split('|').every(validName) || name.split('|').length !== 2) throw new Error('道路坐标为 [大域甲|大域乙:road]');
    } else if (!validName(name)) throw new Error(`坐标名称无效：${name}`);
    return {name, type};
  });
  const last = parts.at(-1)!;
  if (expected && last.type !== expected) throw new Error(`坐标应引用 ${expected}，实际为 ${last.type}`);
  if (last.type === 'road') {
    if (parts.length !== 1) throw new Error('道路坐标不嵌套');
    return 'road:' + last.name.split('|').sort().join('|');
  }
  if (['resource', 'service', 'fable'].includes(last.type)) {
    if (parts.length !== 1) throw new Error(`${last.type} 坐标不嵌套`);
    return last.type === 'service' ? 'service:' + last.name : last.name;
  }
  if (parts[0].type !== 'domain') {
    if (!context) throw new Error('局部坐标缺少所属小域');
    const [domain, node] = context.split('/');
    if (parts[0].type === 'node') parts.unshift({name: domain, type: 'domain'});
    else if (['packet', 'output'].includes(parts[0].type) && node) parts.unshift({name: domain, type: 'domain'}, {name: node, type: 'node'});
  }
  const shape = parts.map(p => p.type).join('/');
  if (!['domain', 'domain/node', 'domain/node/packet', 'domain/node/output'].includes(shape)) throw new Error(`坐标层级无效：${shape}`);
  return parts.map(p => p.name).join('/');
}

function validName(name: string) { return safeName.test(name) && !forbidden.has(name); }

export function coordinateText(id: string, type: SubjectType): string {
  if (type === 'road') return `[${id.slice(5)}:road]`;
  if (type === 'service') return `[${id.slice(8)}:service]`;
  const parts = id.split('/');
  return '[' + parts.map((name, i) => `${name}:${i === parts.length - 1 ? type : i === 0 ? 'domain' : 'node'}`).join('/') + ']';
}
