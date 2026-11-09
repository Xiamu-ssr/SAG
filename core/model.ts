import { z } from "zod";
import { parseDocument } from "yaml";
import { roadsFor } from "./topology";
import { validateLogic } from "./logic";
import { reference, referenceType, type SubjectType } from './coordinate';
import { fieldPath, parseAction, parseRoute, type Comparison, type Condition } from './statements';

export type Data = Record<string, z.infer<ReturnType<typeof z.json>>>;
const fieldType = z.enum(['text', 'number', 'boolean', 'object']);
export type Field = {
  type: z.infer<typeof fieldType>;
  description?: string;
  optional?: boolean;
  default?: Data[string];
};
export type Fields = Record<string, Field>;
const dangerous = new Set(["__proto__", "prototype", "constructor"]);
const segment = /^[\p{L}\p{N}_-]+$/u;
const name = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (v) => segment.test(v) && !dangerous.has(v),
    "名称不能含 /、.、空白或保留字",
  );
const ref = z.tuple([z.string().min(1).max(360)]);
const value = z.json();
const field: z.ZodType<Field> =
  z.union([fieldType.transform((type): Field => ({type})), z
    .object({
      type: fieldType,
      description: z.string().optional(),
      optional: z.boolean().optional(),
      default: value.optional(),
    })
    .strict()]);
const fields = z.record(name, field);
const statement = z.string().min(1);
const logicSchema = z.array(statement).max(30);
const outputSchema = z
  .object({
    packet: ref,
    logic: logicSchema.optional(),
    action: z.array(statement).max(150).default([]),
  })
  .strict();
const nodeSchema = z
  .object({
    description: z.string().default(""),
    packet: z.record(name, fields).default({}),
    input: ref,
    logic: logicSchema.optional(),
    route: z.array(statement).min(1).max(30),
    output: z.record(name, outputSchema),
    duration: z.number().int().min(0).max(60000).default(300),
  })
  .strict();
function isMediaOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.origin === origin && (
      url.protocol === 'https:' ||
      url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
const viewSchema = z
  .object({
    directory: z
      .string()
      .min(1)
      .max(300)
      .refine(
        (v) =>
          !/[\\:]/.test(v) &&
          v.split("/").every((s) => s && s !== "." && s !== ".."),
        "view.directory 必须为世界内的相对目录",
      ),
    width: z.number().int().min(240).max(800),
    height: z.number().int().min(200).max(800),
    media: z.array(z.string().refine(isMediaOrigin, "媒体来源须为完整的 HTTPS 或本地 HTTP 源")).max(8).optional(),
  })
  .strict();
const domainSchema = z
  .object({
    type: z.literal("UI").optional(),
    description: z.string().default(""),
    notes: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1))]).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    view: viewSchema.optional(),
    node: z.record(name, nodeSchema),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.type === "UI" && !d.view)
      ctx.addIssue({ code: "custom", message: "UI 大域必须声明 view" });
    if (d.type !== "UI" && d.view)
      ctx.addIssue({ code: "custom", message: "只有 UI 大域可以声明 view" });
  });
const serviceSchema = z.object({
  description: z.string().default(""),
  input: fields,
  output: fields,
  script: z.string().max(300).refine(
    path => /\.(mjs|js|cjs)$/.test(path) && !/[\\:\u0000]/.test(path)
      && path.split('/').every(segment => segment && !segment.startsWith('.')),
    "script 必须指向世界目录内的 Node.js 脚本",
  ),
}).strict();
const worldSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).default(""),
    domain: z.record(name, domainSchema),
    service: z.record(name, serviceSchema).default({}),
    resource: z.record(name, z.object({ field: fields }).strict()).default({}),
    fable: z.array(z.tuple([ref, z.string().trim().min(1)])).default([]),
  })
  .strict();
export type Output = {
  packet: string;
  values: Data;
  write: {resource: string; values: Data}[];
  id: string;
  label: string;
  fields: Fields;
  logic?: z.infer<typeof logicSchema>;
  when?: Condition;
  routeSource: string;
  to: string[];
  reply?: boolean;
};
export type Node = {
  id: string;
  domain: string;
  name: string;
  description: string;
  packets: Record<string, Fields>;
  inputPacket: string;
  input: Fields;
  logic?: z.infer<typeof logicSchema>;
  outputs: Output[];
  duration: number;
};
export type Domain = Omit<z.infer<typeof domainSchema>, "node"> & {
  id: string;
  name: string;
};
export type Resource = { id: string; name: string; fields: Fields };
export type Service = z.infer<typeof serviceSchema> & { id: string; name: string };
export type Fable = {target: string; type: SubjectType; text: string};
export type World = {
  name: string;
  description: string;
  domains: Domain[];
  nodes: Node[];
  services: Service[];
  resources: Resource[];
  fables: Fable[];
};
export function inputPacketId(node: Pick<Node, "inputPacket">) {
  return node.inputPacket;
}
export function outputPacketId(
  _node: Pick<Node, "id">,
  output: Pick<Output, "packet">,
) {
  return output.packet;
}

export function dataType(v: unknown): Field['type'] | undefined {
  if (typeof v === 'string') return 'text';
  if (typeof v === 'number' && Number.isFinite(v)) return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (v && typeof v === 'object') return 'object';
}

export function canOmit(field: Field) {
  return !!field.optional || Object.hasOwn(field, 'default');
}

export function checkData(
  data: unknown,
  contract: Fields,
  where: string,
): asserts data is Data {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error(`${where}：数据应为对象`);
  if (!value.safeParse(data).success)
    throw new Error(`${where}：数据必须为有效 JSON`);
  const record = data as Data;
  for (const [key, f] of Object.entries(contract)) {
    const v = Object.hasOwn(record, key) ? record[key] : undefined;
    if (v === undefined) {
      if (f.optional) continue;
      throw new Error(`${where}：缺少必填字段 ${key}`);
    }
    if (dataType(v) !== f.type) throw new Error(`${where}：${key} 应为 ${f.type}`);
  }
  for (const key of Object.keys(data))
    if (!Object.hasOwn(contract, key))
      throw new Error(`${where}：未声明字段 ${key}`);
}

export function applyDefaults(data: unknown, fields: Fields): Data {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data as Data;
  if (!value.safeParse(data).success) throw new Error('数据必须为有效 JSON');
  const result = structuredClone(data) as Data;
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(result, key) && Object.hasOwn(field, 'default')) result[key] = structuredClone(field.default!);
  }
  return result;
}
export function readPath(data: Data, path: string): unknown {
  let result: unknown = data;
  for (const key of path.split(".")) {
    if (dangerous.has(key)) throw new Error("不允许访问原型属性");
    if (!result || typeof result !== "object" || !Object.hasOwn(result, key))
      return undefined;
    result = (result as Record<string, unknown>)[key];
  }
  return result;
}
export function compare(
  actual: unknown,
  op: Comparison["op"],
  expected: unknown,
): boolean {
  if (actual === undefined || expected === undefined) return false;
  if (op === "==") return actual === expected;
  if (op === "!=") return actual !== expected;
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  return op === "<"
    ? actual < expected
    : op === "<="
      ? actual <= expected
      : op === ">"
        ? actual > expected
        : actual >= expected;
}
export function matchesCondition(condition: Condition, scope: Data, row = scope): boolean {
  if ('left' in condition) {
    const left = matchesCondition(condition.left, scope, row);
    return condition.op === '&&'
      ? left && matchesCondition(condition.right, scope, row)
      : left || matchesCondition(condition.right, scope, row);
  }
  const reference = fieldPath(condition.value);
  const value = reference ? readPath(scope, reference) : condition.value;
  return compare(readPath(row, condition.field), condition.op, value);
}
export function sameContract(a: Fields, b: Fields): boolean {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(
      ([key, f]) =>
        Object.hasOwn(b, key) &&
        f.type === b[key].type &&
        !!f.optional === !!b[key].optional,
    )
  );
}

export function checkPacketContract(actual: Fields, expected: Fields, where: string) {
  for (const [key, field] of Object.entries(expected)) {
    if (!Object.hasOwn(actual, key)) {
      if (!canOmit(field)) throw new Error(`${where}：缺少必填字段 ${key}`);
    } else {
      const from = actual[key];
      if (from.type !== field.type || (!canOmit(field) && from.optional && !Object.hasOwn(from, 'default')))
        throw new Error(`${where}：${key} 类型或必填合同不匹配`);
    }
  }
  for (const key of Object.keys(actual))
    if (!Object.hasOwn(expected, key))
      throw new Error(`${where}：对方未声明 ${key}`);
}
function validateFields(contract: Fields, where: string) {
  for (const [key, f] of Object.entries(contract)) {
    if (Object.hasOwn(f, 'default')) checkData({[key]: f.default}, {[key]: f}, `${where} 默认值`);
  }
}
function validateKeys(value: unknown, depth = 0) {
  if (!value || typeof value !== "object") return;
  if (depth > 64) throw new Error("世界结构过深或存在循环引用");
  for (const [key, child] of Object.entries(value)) {
    if (dangerous.has(key)) throw new Error(`禁止使用危险名称 ${key}`);
    validateKeys(child, depth + 1);
  }
}

export function parseWorld(source: string): World {
  if (source.length > 512000) throw new Error("世界文件超过 500 KB");
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length)
    throw new Error(doc.errors.map((e) => e.message).join("\n"));
  const document = doc.toJS({ maxAliasCount: 30 });
  validateKeys(document);
  const parsed = worldSchema.safeParse(document);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".") || "世界"}：${i.message}`)
        .join("\n"),
    );
  const raw = parsed.data;
  const domains: Domain[] = Object.entries(raw.domain).map(
    ([key, { node: _node, ...d }]) => ({ ...d, id: key, name: key }),
  );
  if (!domains.length || domains.length > 16)
    throw new Error("世界需要 1 至 16 个大域");
  const definitions = new Map<string, Fields>();
  for (const [domain, d] of Object.entries(raw.domain))
    for (const [node, n] of Object.entries(d.node))
      for (const [packet, contract] of Object.entries(n.packet)) {
        const id = `${domain}/${node}/${packet}`;
        validateFields(contract, id);
        definitions.set(id, contract);
      }
  const resolvePacket = (id: string): Fields => {
    const contract = definitions.get(id);
    if (!contract) throw new Error(`数据包引用不存在：${id}`);
    return structuredClone(contract);
  };
  const nodes: Node[] = Object.entries(raw.domain).flatMap(([domain, d]) =>
    Object.entries(d.node).map(([key, n]) => {
      const id = `${domain}/${key}`;
      const routes = n.route.map((line, i) => parseLine(line, parseRoute, `${id} route 第 ${i + 1} 行`));
      if (routes.slice(0, -1).some(r => !r.when) || routes.at(-1)!.when)
        throw new Error(`${id}：route 最后一条为无条件 go，其余用 IF`);
      const routed = new Set<string>();
      const outputs = routes.map((r, index): Output => {
        const outputRef = reference(r.target, 'output', id);
        if (!outputRef.startsWith(id + '/') || outputRef.split('/').length !== 3) throw new Error(`${id}：route 只能选择本小域的 output`);
        const output = outputRef.slice(id.length + 1);
        if (routed.has(output)) throw new Error(`${id}：route 重复输出 ${output}`);
        routed.add(output);
        if (!Object.hasOwn(n.output, output)) throw new Error(`${id}：route 输出 ${output} 不存在`);
        const o = n.output[output];
        const packet = reference(o.packet, 'packet', id);
        const to: Output['to'] = [], write: Output['write'] = [];
        let reply = false;
        for (const [i, line] of o.action.entries()) {
          const where = `${id}/${output} action 第 ${i + 1} 行`;
          const action = parseLine(line, parseAction, where);
          if (action.kind === 'write') {
            if (to.length || reply) throw new Error(`${where}：write 必须在交付前`);
            write.push({resource: reference(action.target, 'resource'), values: action.values});
          } else if (action.kind === 'go') {
            if (reply) throw new Error(`${where}：出口只能选择 go 或 return`);
            to.push(reference(action.target, 'node', id));
          } else {
            if (to.length || reply) throw new Error(`${where}：出口只能选择 go 或一次 return`);
            reply = true;
          }
        }
        return {
          id: output,
          label: output,
          packet,
          values: r.values,
          routeSource: n.route[index],
          write,
          ...(o.logic ? {logic: o.logic} : {}),
          fields: resolvePacket(packet),
          ...(r.when ? { when: r.when } : {}),
          to,
          ...(reply ? { reply: true } : {}),
        };
      });
      if (Object.keys(n.output).some((key) => !routed.has(key)))
        throw new Error(`${id}：每个 output 必须由 route 引用`);
      const inputPacket = reference(n.input, 'packet', id);
      return {
        id,
        domain,
        name: key,
        description: n.description,
        packets: n.packet,
        inputPacket,
        input: resolvePacket(inputPacket),
        ...(n.logic === undefined ? {} : { logic: n.logic }),
        outputs,
        duration: n.duration,
      };
    }),
  );
  if (!nodes.length || nodes.length > 150)
    throw new Error("世界需要 1 至 150 个小域");
  const resources = Object.entries(raw.resource).map(([key, r]) => ({
    fields: r.field,
    id: key,
    name: key,
  }));
  if (resources.some((r) => domains.some((d) => d.id === r.id)))
    throw new Error("世界主体存在重复坐标");
  const tableNames = new Set<string>();
  // SQLite folds ASCII letters in identifiers.
  const sqliteName = (name: string) => name.replace(/[A-Z]/g, letter => letter.toLowerCase());
  for (const r of resources) {
    const table = sqliteName(r.id);
    if (table.startsWith('sqlite_') || table === '_sag_capture')
      throw new Error(`resource.${r.id}：表名保留`);
    if (tableNames.has(table)) throw new Error(`resource.${r.id}：表名与其他资源重复（忽略 ASCII 大小写）`);
    tableNames.add(table);
    const columns = Object.keys(r.fields);
    if (!columns.length) throw new Error(`resource.${r.id}.field：至少声明一个字段`);
    if (new Set(columns.map(sqliteName)).size !== columns.length)
      throw new Error(`resource.${r.id}.field：列名重复（忽略 ASCII 大小写）`);
    validateFields(r.fields, r.id);
  }
  const world: World = {
    name: raw.name,
    description: raw.description,
    domains,
    nodes,
    services: Object.entries(raw.service).map(([name, service]) => {
      validateFields(service.input, `service.${name}.input`);
      validateFields(service.output, `service.${name}.output`);
      return {...service, name, id: reference([name + ':service'], 'service')};
    }),
    resources,
    fables: raw.fable.map(([ref, text], i) => ({
      target: parseLine(ref, value => reference(value), `fable 第 ${i + 1} 条`),
      type: referenceType(ref),
      text,
    })),
  };
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes)
    for (const o of n.outputs) {
      const targets = o.to.map((id) => {
        const next = nodeMap.get(id);
        if (!next) throw new Error(`${n.id}：去向 ${id} 不存在`);
        return next;
      });
      if (targets.some((next) => !sameContract(targets[0].input, next.input)))
        throw new Error(`${n.id}/${o.id}：广播目标合同不匹配`);
      for (const next of targets)
        checkPacketContract(o.fields, next.input, `${n.id} → ${next.id}`);
      for (const write of o.write)
        if (!resources.some((r) => r.id === write.resource))
          throw new Error(`资源 ${write.resource} 不存在`);
    }
  validateLogic(world);
  const subjects = new Map<string, Set<SubjectType>>();
  const register = (id: string, type: SubjectType) => {
    if (!subjects.has(id)) subjects.set(id, new Set());
    subjects.get(id)!.add(type);
  };
  domains.forEach(d => register(d.id, 'domain'));
  nodes.forEach(n => {register(n.id, 'node'); n.outputs.forEach(o => register(`${n.id}/${o.id}`, 'output'));});
  world.services.forEach(service => register(service.id, 'service'));
  resources.forEach(r => register(r.id, 'resource'));
  definitions.forEach((_fields, id) => register(id, 'packet'));
  roadsFor(world).forEach(r => register(r.id, 'road'));
  for (const f of world.fables)
    if (!subjects.get(f.target)?.has(f.type))
      throw new Error(`寓言引用不存在：${f.target} (${f.type})`);
  return world;
}

function parseLine<S, T>(source: S, parse: (source: S) => T, where: string): T {
  try { return parse(source); }
  catch (error) { throw new Error(`${where}：${(error as Error).message}`); }
}
