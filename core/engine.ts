import {
  checkData,
  applyDefaults,
  canOmit,
  matchesCondition,
  readPath,
  type World,
  type Service,
  type Data,
  type Output,
  type Fields,
  type Field,
} from "./model";
import { logicIn, readBranch, serviceReply } from "./logic";
import { fieldPath, type Expression } from "./statements";

const packetTravelMs = 660;

export type Event = {
  id: number;
  time: number;
  kind:
    | "enter"
    | "route"
    | "output"
    | "transfer"
    | "read"
    | "write"
    | "end"
    | "cancel"
    | "error"
    | "call"
    | "reply"
    | "resume";
  node: string;
  target?: string;
  arrivesAt?: number;
  branch?: string;
  data: Data;
  invocation: number;
  parent?: number;
  cause?: number;
  resource?: string;
  direction?: "call" | "reply" | "send" | "read" | "write";
  callId?: number;
  callName?: string;
  packet?: {
    id: string;
    skin: { symbol: string; color: string };
    streamId?: string;
    segment?: number;
  };
};
export type Start = { node: string; input: Data; name?: string };
export type Timeline = { events: Event[] };
export type Recording = {
  mode: "simulation";
  complete: true;
  status: "completed" | "failed";
  entry: string;
  start?: Start;
  duration: number;
  events: Event[];
  initial: Record<string, Data[]>;
  final: Record<string, Data[]>;
  coverage: string[];
  error?: string;
};
export type ServiceRunner = (service: Service, input: Data, signal: AbortSignal) => Promise<unknown>;
type ServiceExecution = {
  run: ServiceRunner;
  time?: () => number;
  wake?: () => void;
};

function resolve(
  values: Record<string, Expression>,
  scope: Data,
  contract: Fields,
): Data {
  function visit(v: Expression, expected?: Field): Data[string] | undefined {
    if (!v || typeof v !== "object") return v;
    if (Array.isArray(v))
      return v.map((item) => visit(item)!);
    const path = fieldPath(v);
    if (path) {
      const result = readPath(scope, path);
      if (result === undefined) {
        if (expected && canOmit(expected)) return undefined;
        throw new Error(`输入或逻辑结果 ${path} 未提供`);
      }
      return structuredClone(result) as Data[string];
    }
    return Object.fromEntries(Object.entries(v).map(([key, value]) => [key, visit(value)!]));
  }
  const path = fieldPath(values);
  if (path) return applyDefaults(readPath(scope, path), contract);
  const result: Data = {};
  for (const [key, value] of Object.entries(values)) {
    const resolved = visit(value, contract[key]);
    if (resolved !== undefined) result[key] = resolved;
  }
  return applyDefaults(result, contract);
}
export function createRuntime(
  world: World,
  initialOverride?: Record<string, Data[]>,
  onEvent: (event: Event) => void = () => {},
  external?: ServiceExecution,
) {
  if (initialOverride !== undefined) {
    for (const key of Object.keys(initialOverride))
      if (!world.resources.some((r) => r.id === key))
        throw new Error(`初始资源 ${key} 不存在`);
    for (const resource of world.resources) {
      if (!Object.hasOwn(initialOverride, resource.id))
        throw new Error(`初始资源缺少 ${resource.id}`);
      const rows = initialOverride[resource.id];
      if (!Array.isArray(rows))
        throw new Error(`初始资源 ${resource.id} 应为数组`);
      rows.forEach((row) =>
        checkData(row, resource.fields, resource.name + "初始资源"),
      );
    }
  }
  const initial = Object.fromEntries(
    world.resources.map((r) => [
      r.id,
      structuredClone(
        initialOverride === undefined ? [] : initialOverride[r.id],
      ),
    ]),
  );
  const state = structuredClone(initial);
  const nodes = new Map(world.nodes.map(node => [node.id, node]));
  const services = new Map(world.services.map(service => [service.id, service]));
  const resources = new Map(world.resources.map(resource => [resource.id, resource]));
  let serial = 1,
    time = 0,
    invocation = 0,
    eventId = 0;
  type Chain = { began: number; invocations: number; steps: number; active: Set<Frame> };
  type Frame = {
    node: string;
    input: Data;
    scope: Data;
    invocation: number;
    chain: Chain;
    parent?: number;
    cause?: number;
    call?: { caller: Frame; name: string };
    next: number;
    selected?: Output;
    waiting?: number;
    ended?: boolean;
  };
  type Work = {
    frame: Frame;
    time: number;
    order: number;
    branch?: Output;
    read?: { resource: string; name: string; data: Data };
    delivery?: Delivery;
    serviceResult?: ServiceResult;
    returned?: {
      callId: number;
      name: string;
      branch: string;
      data: Data;
      node: string;
      cause: number;
    };
  };
  type ServiceResult = {data: unknown} | {error: unknown};
  type Delivery = {
    branch: Pick<Output, "id" | "reply" | "to">;
    data: Data;
    writes: { resource: string; row: Data; cause: number }[];
  };
  const pending = new Map<Frame, {controller: AbortController; done: Promise<void>}>();
  function cancelServices(chain?: Chain) {
    for (const [frame, task] of pending) {
      if (chain && frame.chain !== chain) continue;
      pending.delete(frame);
      task.controller.abort();
    }
  }
  const create = (
    node: string,
    input: Data,
    chain: Chain,
    parent?: number,
    cause?: number,
  ): Frame => {
    chain.invocations++;
    return {
      node,
      input: structuredClone(input),
      scope: {},
      invocation: ++invocation,
      chain,
      parent,
      cause,
      next: 0,
    };
  };
  const queue: Work[] = [];
  function schedule(work: Omit<Work, "order">) {
    queue.push({...work, order: serial++});
    queue.sort((a, b) => a.time - b.time || a.order - b.order);
  }
  const emit = (
    f: Frame,
    kind: Event["kind"],
    data: Data,
    extra: Partial<Event> = {},
  ) => {
    const id = ++eventId;
    onEvent({
      id,
      time,
      kind,
      node: f.node,
      invocation: f.invocation,
      ...(f.parent === undefined ? {} : { parent: f.parent }),
      ...(f.cause !== undefined ? { cause: f.cause } : {}),
      data: structuredClone(data),
      ...extra,
    });
    f.cause = id;
    return id;
  };
  function transfer(frame: Frame, data: Data, extra: Partial<Event>) {
    const arrivesAt = time + packetTravelMs;
    return {arrivesAt, cause: emit(frame, "transfer", data, {...extra, arrivesAt})};
  }
  function advance(frame: Frame) {
    const node = nodes.get(frame.node)!;
    const logic = frame.selected ? frame.selected.logic : node.logic;
    const step = logicIn(node, logic)[frame.next];
    if (step?.kind === 'read') {
      const resource = resources.get(step.target)!;
      const rows = state[resource.id];
      let row: Data | undefined;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchesCondition(step.where, frame.scope, rows[i])) {
          row = rows[i];
          break;
        }
      }
      const data = row
        ? {分支: readBranch.found, 数据: applyDefaults(row, resource.fields)}
        : {分支: readBranch.missing, 数据: {}};
      const {arrivesAt} = transfer(frame, data, {resource: resource.id, direction: "read"});
      schedule({frame, time: arrivesAt, read: {resource: resource.id, name: step.name, data}});
      return;
    }
    if (step) {
      const target = nodes.get(step.target) ?? services.get(step.target);
      if (!target) throw new Error(`call 目标不存在：${step.target}`);
      const data = resolve(step.input, frame.scope, target.input);
      checkData(data, target.input, `${node.name} 调用 ${target.name}`);
      const child = create(target.id, data, frame.chain, frame.invocation);
      child.call = { caller: frame, name: step.name };
      frame.waiting = child.invocation;
      const extra = {
        target: target.id,
        callId: child.invocation,
        callName: step.name,
        direction: "call" as const,
      };
      emit(frame, "call", data, extra);
      const sent = transfer(frame, data, extra);
      child.cause = sent.cause;
      schedule({ frame: child, time: sent.arrivesAt });
      return;
    }
    if (!frame.selected) {
      const branch = node.outputs.find(
        b => !b.when || matchesCondition(b.when, frame.scope),
      );
      if (!branch) throw new Error(`${node.name} 没有可用分支`);
      emit(frame, 'route', {}, {branch: branch.id});
      frame.selected = branch;
      frame.next = 0;
      advance(frame);
      return;
    }
    schedule({ frame, time: time + node.duration, branch: frame.selected });
  }

  function deliver(frame: Frame, {branch, data, writes}: Delivery) {
    for (const write of writes) {
      state[write.resource].push(write.row);
      emit(frame, "write", write.row, {resource: write.resource, branch: branch.id, cause: write.cause});
    }
    emit(frame, "output", data, {branch: branch.id});
    if (branch.reply && frame.call) {
      const {caller, name} = frame.call;
      const extra = {
        target: caller.node,
        callId: frame.invocation,
        callName: name,
        branch: branch.id,
        direction: "reply" as const,
      };
      emit(frame, "reply", data, extra);
      const sent = transfer(frame, data, extra);
      schedule({
        frame: caller,
        time: sent.arrivesAt,
        returned: {
          callId: frame.invocation, name, branch: branch.id, data,
          node: frame.node, cause: sent.cause,
        },
      });
    }
    for (const target of branch.to) {
      const sent = transfer(frame, data, {target, branch: branch.id, direction: "send"});
      schedule({
        frame: create(target, data, frame.chain, frame.invocation, sent.cause),
        time: sent.arrivesAt,
      });
    }
    frame.ended = true;
    emit(frame, "end", {}, {branch: branch.id});
    frame.chain.active.delete(frame);
  }

  function enter(frame: Frame, target: {name: string; input: Fields}) {
    frame.input = applyDefaults(frame.input, target.input);
    frame.scope.input = structuredClone(frame.input);
    checkData(frame.input, target.input, target.name + "输入");
    emit(frame, "enter", frame.input);
    frame.chain.active.add(frame);
  }

  function runService(frame: Frame, service: Service) {
    if (!external) throw new Error(`${service.name}：需要外部服务执行器`);
    const controller = new AbortController();
    const finish = (serviceResult: ServiceResult) => {
      if (!pending.delete(frame)) return;
      schedule({frame, time: Math.max(time, external.time?.() ?? time), serviceResult});
      external.wake?.();
    };
    const done = external.run(service, frame.input, controller.signal).then(
      data => finish({data}),
      error => finish({error}),
    );
    pending.set(frame, {controller, done});
  }

  function process(w: Work) {
    const f = w.frame, chain = f.chain;
    time = w.time;
    try {
      if (chain.invocations > 200 || ++chain.steps > 1000 || time - chain.began > 600000)
        throw new Error("运行超过边界：最多 200 次节点执行、10 分钟模拟时间");
      const service = services.get(f.node);
      if (service) {
        if (!w.serviceResult) {
          enter(f, service);
          runService(f, service);
        } else {
          const result = w.serviceResult;
          if ('error' in result)
            throw new Error(`${service.name}：${result.error instanceof Error ? result.error.message : String(result.error)}`);
          const data = applyDefaults(result.data, service.output);
          checkData(data, service.output, service.name + "输出");
          deliver(f, {branch: {id: serviceReply, reply: true, to: []}, data, writes: []});
        }
        return;
      }
      const n = nodes.get(f.node)!;
      if (w.returned) {
        const reply = w.returned;
        if (f.ended || f.waiting !== reply.callId)
          throw new Error(`${n.name} 收到不属于当前等待的回复`);
        f.scope[reply.name] = {
          分支: reply.branch,
          数据: structuredClone(reply.data),
        };
        f.cause = reply.cause;
        f.waiting = undefined;
        f.next++;
        emit(f, "resume", f.scope[reply.name] as Data, {
          callId: reply.callId,
          callName: reply.name,
          target: reply.node,
        });
        advance(f);
      } else if (w.read) {
        f.scope[w.read.name] = w.read.data;
        emit(f, "read", w.read.data, {resource: w.read.resource, callName: w.read.name});
        f.next++;
        advance(f);
      } else if (w.delivery) {
        deliver(f, w.delivery);
      } else if (!w.branch) {
        enter(f, n);
        if (!f.call && n.outputs.some((b) => b.reply))
          throw new Error(`${n.name} 没有逻辑区调用方，不能回复`);
        advance(f);
      } else {
        const b = w.branch;
        if (f.call && !b.reply)
          throw new Error(`${n.name} 的调用没有回复，不能结束等待`);
        if (b.reply && (!f.call || b.to.length))
          throw new Error(`${n.name} 回复目标不合法`);
        const output = resolve(b.values, f.scope, b.fields);
        checkData(output, b.fields, n.name + "输出");
        // Validate the whole business write before committing any resource change.
        const writes = b.write.map((write) => {
          const resource = resources.get(write.resource)!;
          const row = resolve(write.values, {...f.scope, output}, resource.fields);
          checkData(row, resource.fields, resource.name);
          return { resource: resource.id, row };
        });
        const delivery = {branch: b, data: output, writes: writes.map(write => {
          const {cause} = transfer(f, write.row, {resource: write.resource, branch: b.id, direction: "write"});
          return {...write, cause};
        })};
        if (writes.length) schedule({frame: f, time: time + packetTravelMs, delivery});
        else deliver(f, delivery);
      }
    } catch (e) {
      cancelServices(chain);
      for (const active of chain.active)
        if (active !== f) emit(active, "cancel", {});
      chain.active.clear();
      emit(f, "error", { message: e instanceof Error ? e.message : String(e) });
      for (let i = queue.length - 1; i >= 0; i--)
        if (queue[i].frame.chain === chain) queue.splice(i, 1);
    }
  }
  function submit(start: Start) {
    if (!start || typeof start !== "object" || Array.isArray(start) || typeof start.node !== "string")
      throw new Error("入口必须为显式 Start 对象 {node, input}");
    if (!nodes.has(start.node))
      throw new Error(`小域 ${start.node} 不存在`);
    schedule({
      frame: create(start.node, start.input, {began: time, invocations: 0, steps: 0, active: new Set()}),
      time,
    });
  }
  function advanceTo(until: number) {
    if (until < time) throw new Error("世界时钟不能倒退");
    while (queue.length && queue[0].time <= until) process(queue.shift()!);
    if (Number.isFinite(until)) time = until;
  }
  async function drain() {
    advanceTo(Infinity);
    while (pending.size) {
      await Promise.race([...pending.values()].map(task => task.done));
      advanceTo(Infinity);
    }
  }
  function close() {
    cancelServices();
    queue.length = 0;
  }
  return {initial, state, submit, advanceTo, drain, close, nextAt: () => queue[0]?.time};
}

type Simulation = Recording & { start: Start };
export function simulate(
  world: World,
  start: Start,
  initialOverride?: Record<string, Data[]>,
): Simulation;
export function simulate(
  world: World,
  start: Start,
  initialOverride: Record<string, Data[]> | undefined,
  runService: ServiceRunner,
): Promise<Simulation>;
export function simulate(
  world: World,
  start: Start,
  initialOverride?: Record<string, Data[]>,
  runService?: ServiceRunner,
): Simulation | Promise<Simulation> {
  const events: Event[] = [];
  const runtime = createRuntime(world, initialOverride, event => events.push(event), runService && {run: runService});
  runtime.submit(start);
  const actualStart: Start = structuredClone(start);
  function recording(): Simulation {
    const failure = events.find(e => e.kind === "error")?.data.message as string | undefined;
    return {
      mode: "simulation",
      complete: true,
      status: failure ? "failed" : "completed",
      entry: actualStart.node,
      start: actualStart,
      duration: (events.at(-1)?.time ?? 0) + 300,
      events,
      initial: runtime.initial,
      final: runtime.state,
      coverage: [
        ...new Set(
          events
            .filter((e) => e.kind === "output")
            .map((e) => `${e.node}#${e.branch}`),
        ),
      ],
      ...(failure ? { error: failure } : {}),
    };
  }
  if (runService) return runtime.drain().then(recording);
  runtime.advanceTo(Infinity);
  return recording();
}

export function stateAt(recording: Recording, time: number) {
  const state = structuredClone(recording.initial);
  for (const e of recording.events)
    if (e.time <= time && e.kind === "write" && e.resource)
      state[e.resource].push(structuredClone(e.data));
  return state;
}
