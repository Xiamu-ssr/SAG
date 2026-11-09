import {
  parseLogic,
  fieldPath,
  type LogicStatement,
  type Condition,
  type Expression,
} from "./statements";
import {
  canOmit,
  checkPacketContract,
  dataType,
  type Field,
  type Fields,
  type Node,
  type Output,
  type Resource,
  type World,
  sameContract,
} from "./model";
import { reference, referenceType } from './coordinate';

export const readBranch = { found: "找到", missing: "未找到" } as const;
export const serviceReply = "完成";

export function logicIn(node: Node, logic: Node['logic']): LogicStatement[] {
  return logic
    ? logic.map((source, i) => {
        try {
          const statement = parseLogic(source);
          if (statement.kind === 'read')
            return {...statement, target: reference(statement.target, 'resource')};
          const type = referenceType([statement.target.slice(1, -1)]) === 'service' ? 'service' : 'node';
          return {...statement, target: reference(statement.target, type, node.id), ...(statement.packet ? {packet: reference(statement.packet, 'packet', node.id)} : {})};
        } catch (error) {
          throw new Error(
            `${node.id} 逻辑第 ${i + 1} 行：${error instanceof Error ? error.message : error}`,
          );
        }
      })
    : [];
}
type ResultBranch = Pick<Output, 'id' | 'fields'>;
type Scope = {
  input: Fields;
  output?: Fields;
  results: Map<string, ResultBranch[]>;
  allowed: Map<string, Set<string>>;
};
function atPath(fields: Fields, parts: string[], path: string): Field {
  if (!parts.length) return {type: 'object'};
  const [key] = parts;
  if (!Object.hasOwn(fields, key)) throw new Error(`未声明字段 ${path}`);
  if (parts.length > 1) throw new Error(`不能读取字段内部：${path}`);
  const field = fields[key];
  return {...field, optional: !!field.optional && !Object.hasOwn(field, 'default')};
}
function resultsFor(scope: Scope, root: string, path: string) {
  const result = scope.results.get(root);
  if (!result)
    throw new Error(`未声明字段或逻辑变量 ${path}；输入使用 input.字段`);
  const outputs = result.filter((b) =>
    scope.allowed.get(root)?.has(b.id),
  );
  if (!outputs.length) throw new Error(`分支条件不可达：${root}`);
  return outputs;
}
function typesAt(scope: Scope, path: string): Field[] {
  const [root, ...rest] = path.split(".");
  if (root === "input") return [atPath(scope.input, rest, path)];
  if (root === "output" && scope.output) return [atPath(scope.output, rest, path)];
  const outputs = resultsFor(scope, root, path);
  if (rest.length === 1 && rest[0] === "分支") return [{ type: "text" }];
  if (rest[0] !== "数据") throw new Error(`${path}：逻辑结果只有 分支 和 数据`);
  return outputs.map((b) => {
    if (rest.length > 1 && !Object.hasOwn(b.fields, rest[1]))
      throw new Error(
        `${path} 在返回分支“${b.id}”中不存在；请先根据 ${root}.分支 收窄结果`,
      );
    return atPath(b.fields, rest.slice(1), path);
  });
}
function packetContractsAt(scope: Scope, path: string): Fields[] {
  if (path === 'input') return [scope.input];
  if (path === 'output' && scope.output) return [scope.output];
  const [root, property, ...rest] = path.split('.');
  if (property === '数据' && !rest.length && scope.results.has(root))
    return resultsFor(scope, root, path).map(output => output.fields);
  throw new Error(`${path}：应引用已声明的整包（input、逻辑结果.数据 或出口动作中的 output）`);
}
function checkExpression(
  expr: Expression,
  expected: Field,
  scope: Scope,
  where: string,
): void {
  const path = fieldPath(expr);
  if (path) {
    for (const actual of typesAt(scope, path))
      if (actual.type !== expected.type || (actual.optional && !canOmit(expected)))
        throw new Error(
          `${where}：${path} 类型/必填合同不匹配，应为 ${expected.type}`,
        );
    return;
  }
  if (expr === null) throw new Error(`${where}：null 不是可省略字段`);
  const type = dataType(expr);
  if (type !== expected.type)
    throw new Error(`${where}：应为 ${expected.type}，实际是 ${type}`);
  checkReads(expr, scope);
}
function checkReads(expr: Expression, scope: Scope): void {
  if (!expr || typeof expr !== "object") return;
  const path = fieldPath(expr);
  if (path) {
    typesAt(scope, path);
    return;
  }
  for (const value of Object.values(expr)) checkReads(value, scope);
}
function checkPacket(
  values: Record<string, Expression>,
  fields: Fields,
  scope: Scope,
  where: string,
) {
  const path = fieldPath(values);
  if (path) {
    for (const source of packetContractsAt(scope, path))
      checkPacketContract(source, fields, `${where}：${path}`);
    return;
  }
  for (const [key, f] of Object.entries(fields)) {
    if (!Object.hasOwn(values, key)) {
      if (!canOmit(f)) throw new Error(`${where}：缺少必填字段 ${key}`);
    } else checkExpression(values[key], f, scope, `${where}.${key}`);
  }
  for (const key of Object.keys(values))
    if (!Object.hasOwn(fields, key))
      throw new Error(`${where}：未声明字段 ${key}`);
}
function checkCondition(condition: Condition, scope: Scope, resource?: Resource) {
  if ('left' in condition) {
    checkCondition(condition.left, scope, resource);
    const rightScope = resource ? scope : refine(scope, condition.left, condition.op === '&&');
    checkCondition(condition.right, rightScope, resource);
    return;
  }
  const {field, value} = condition;
  const actual = resource ? [atPath(resource.fields, [field], field)] : typesAt(scope, field);
  const path = fieldPath(value);
  const expected = path ? typesAt(scope, path).map(f => f.type) : [dataType(value)];
  const equality = condition.op === '==' || condition.op === '!=';
  if (!equality && (actual.some(f => f.type !== 'number') || expected.some(type => type !== 'number')))
    throw new Error(`${field}：大小比较只能用于数字`);
  if (actual.some(f => f.type === 'object' || expected.some(type => type !== f.type)))
    throw new Error(`${field}：比较值类型不匹配，应为同类型的文字、数字或布尔值`);
  if (!resource && !path) {
    const [name, property, extra] = field.split(".");
    const branches = scope.results.get(name);
    if (branches && property === "分支" && !extra && !branches.some(branch => branch.id === value))
      throw new Error(`${field}：不存在返回分支 ${value}`);
  }
}
function refine(
  scope: Scope,
  condition: Condition | undefined,
  truth: boolean,
): Scope {
  if (!condition) return scope;
  if ('left' in condition) {
    const left = refine(scope, condition.left, truth);
    if ((condition.op === '&&') === truth)
      return refine(left, condition.right, truth);
    const right = refine(scope, condition.right, truth);
    const allowed = new Map([...left.allowed].map(([name, branches]) =>
      [name, new Set([...branches, ...right.allowed.get(name)!])]));
    return {...scope, allowed};
  }
  if ((condition.op !== '==' && condition.op !== '!=') || typeof condition.value !== 'string')
    return scope;
  const [name, property, extra] = condition.field.split(".");
  const branches = scope.allowed.get(name);
  if (!branches || property !== "分支" || extra) return scope;
  const equals = condition.op === "==" ? truth : !truth;
  const allowed = new Map(scope.allowed);
  allowed.set(name, new Set([...branches].filter(id => (id === condition.value) === equals)));
  return {...scope, allowed};
}
export function validateLogic(world: World) {
  const byId = new Map(world.nodes.map((n) => [n.id, n]));
  const services = new Map(world.services.map(service => [service.id, service]));
  const resources = new Map(world.resources.map(resource => [resource.id, resource]));
  const graph = new Map<string, string[]>();
  for (const node of world.nodes) {
    let scope: Scope = {
      input: node.input,
      results: new Map(),
      allowed: new Map(),
    };
    const logic = logicIn(node, node.logic);
    const branchLogic = node.outputs.map(output => logicIn(node, output.logic));
    graph.set(
      node.id,
      [...logic, ...branchLogic.flat()].filter(step => step.kind === 'call').map(step => step.target),
    );
    function checkSteps(steps: LogicStatement[], scope: Scope) {
      for (const step of steps) {
        if (step.name === "input" || step.name === "output" ||
            scope.results.has(step.name) || Object.hasOwn(node.input, step.name))
          throw new Error(`${node.id}：逻辑变量重复或遮蔽输入 ${step.name}`);
        let outputs: ResultBranch[];
        if (step.kind === 'read') {
          const resource = resources.get(step.target);
          if (!resource) throw new Error(`${node.id}：read 资源不存在 ${step.target}`);
          checkCondition(step.where, scope, resource);
          outputs = [{id: readBranch.found, fields: resource.fields}, {id: readBranch.missing, fields: {}}];
        } else {
          const target = byId.get(step.target) ?? services.get(step.target);
          if (!target) throw new Error(`${node.id}：call 目标不存在 ${step.target}`);
          if ('outputs' in target) {
            if (target.outputs.some(b => !b.reply || b.to.length))
              throw new Error(`${node.id}：call 目标 ${step.target} 的所有输出都必须回复调用方`);
            outputs = target.outputs;
          } else {
            outputs = [{id: serviceReply, fields: target.output}];
          }
          if (step.packet) {
            const [domain, nodeId, packet] = step.packet.split('/');
            const contract = byId.get(`${domain}/${nodeId}`)?.packets[packet];
            if (!contract) throw new Error(`${node.id}：返回类型数据包不存在 ${step.packet}`);
            if (outputs.some(output => !sameContract(output.fields, contract)))
              throw new Error(`${node.id}：返回类型与 ${step.target} 的 output 数据包不匹配`);
          }
          checkPacket(step.input, target.input, scope, `${node.id} 调用 ${step.target}`);
        }
        scope.results.set(step.name, outputs);
        scope.allowed.set(step.name, new Set(outputs.map(b => b.id)));
      }
    }
    checkSteps(logic, scope);
    for (const [index, branch] of node.outputs.entries()) {
      if (branch.when) checkCondition(branch.when, scope);
      const narrowed = refine(scope, branch.when, true);
      const selected = {...narrowed, results: new Map(narrowed.results), allowed: new Map(narrowed.allowed)};
      checkSteps(branchLogic[index], selected);
      checkPacket(
        branch.values as Record<string, Expression>,
        branch.fields,
        selected,
        `${node.id}/${branch.id} 输出`,
      );
      for (const write of branch.write) {
        const resource = resources.get(write.resource)!;
        checkPacket(
          write.values as Record<string, Expression>,
          resource.fields,
          {...selected, output: branch.fields},
          `${node.id} 写入 ${resource.id}`,
        );
      }
      for (const to of branch.to)
        if (byId.get(to)?.outputs.some((b) => b.reply))
          throw new Error(
            `${node.id}：${to} 需要调用方，请用逻辑区 call 而不是单向交付`,
          );
      scope = refine(scope, branch.when, false);
    }
  }
  const visited = new Set<string>(),
    stack = new Set<string>();
  function visit(id: string) {
    if (stack.has(id))
      throw new Error(`逻辑区存在递归调用：${[...stack, id].join(" → ")}`);
    if (visited.has(id)) return;
    stack.add(id);
    for (const next of graph.get(id) || []) visit(next);
    stack.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
}
