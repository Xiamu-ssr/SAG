import { randomUUID } from "node:crypto";
import { createRuntime, type Event, type Recording, type Start, type Timeline } from "../core/engine";
import { packetDecorator } from "../core/packets";
import { worldRate } from "../core/speed";
import type { ResourceData } from "./resource-store";
import type { WorldDirectory } from "./world-directory";
import { serviceRunner } from "./services";

const reminderInterval = 10 * 60_000;
const idleLimit = 30 * 60_000;
const recentLimit = 512;

export type SessionOptions = { record: boolean; idleStop: boolean; speed?: number };
export type SessionAction = "pause" | "resume" | "continue" | "stop" | "activity";
export type SessionCommand = SessionAction | {speed: number};
export type Reminder = { appId: string; sessionId: string; name: string };
export type SessionView = Timeline & {
  source: string;
  fingerprint: string;
  assetBase: string;
  initial: ResourceData;
  current: ResourceData;
};
export type SessionSnapshot = {
  id: string;
  cursor: string;
  status: "running" | "paused";
  time: number;
  speed: number;
  nextAt?: number;
  reminder: boolean;
  idleStop: boolean;
  error: string;
  view?: SessionView;
};

export class WorldSession {
  readonly id = randomUUID();
  readonly created = new Date().toISOString();
  private readonly runtime;
  private readonly recent: Event[] = [];
  private readonly outputs = new Map<string, Event>();
  private readonly active = new Map<number, Event>();
  private readonly recorded: Event[] | undefined;
  private elapsed = 0;
  private activeElapsed = 0;
  private speed: number;
  private runningSince: number | null;
  private activityAt: number;
  private reminded = 0;
  private runtimeError = "";
  saveError = "";
  timer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly loaded: WorldDirectory,
    readonly options: SessionOptions,
    now: number,
    clock: () => number,
    wake: () => void,
  ) {
    this.runningSince = this.activityAt = now;
    this.speed = options.speed ?? 1;
    this.recorded = options.record ? [] : undefined;
    const decorate = packetDecorator(this.id);
    this.runtime = createRuntime(loaded.world, loaded.initial, event => {
      decorate(event);
      this.recorded?.push(event);
      this.recent.push(event);
      if (this.recent.length > recentLimit) this.recent.shift();
      if (event.kind === "output") this.outputs.set(event.node, event);
      if (event.kind === "enter") this.active.set(event.invocation, event);
      if (event.kind === "end" || event.kind === "cancel" || event.kind === "error")
        this.active.delete(event.invocation);
      if (event.kind === "error") this.runtimeError = String(event.data.message);
    }, {run: serviceRunner(loaded), time: () => this.timeAt(clock()), wake});
  }

  private activeTimeAt(now: number) {
    return this.activeElapsed + (this.runningSince === null ? 0 : now - this.runningSince);
  }

  private timeAt(now: number) {
    return this.elapsed + (this.activeTimeAt(now) - this.activeElapsed) * worldRate(this.speed);
  }

  private checkpoint(now: number) {
    if (this.runningSince === null) return;
    this.elapsed = this.timeAt(now);
    this.activeElapsed = this.activeTimeAt(now);
    this.runningSince = now;
  }

  get idleAt() {
    return this.options.idleStop && !this.saveError ? this.activityAt + idleLimit : Infinity;
  }

  wakeAt(now: number) {
    const next = this.runtime.nextAt();
    const work = this.runningSince !== null && next !== undefined
      ? now + Math.max(0, next - this.timeAt(now)) / worldRate(this.speed)
      : Infinity;
    return Math.min(work, this.idleAt);
  }

  advance(now: number) {
    if (this.runningSince !== null) this.runtime.advanceTo(this.timeAt(now));
  }

  activity(now: number) {
    this.activityAt = now;
  }

  pause(now: number) {
    this.checkpoint(now);
    this.runningSince = null;
  }

  resume(now: number) {
    this.runningSince ??= now;
    this.saveError = "";
  }

  setSpeed(speed: number, now: number) {
    this.checkpoint(now);
    this.speed = speed;
  }

  dismissReminder(now: number) {
    this.reminded = Math.floor(this.activeTimeAt(now) / reminderInterval);
  }

  reminderDue(now: number) {
    return this.runningSince !== null && now < this.idleAt
      && this.activeTimeAt(now) >= (this.reminded + 1) * reminderInterval;
  }

  enter(start: Start, now: number) {
    if (this.runningSince === null) throw new Error("世界已暂停");
    this.runtime.submit(start);
    this.runtimeError = "";
    this.activity(now);
    this.advance(now);
  }

  snapshot(now: number, since?: string): SessionSnapshot {
    const time = this.timeAt(now);
    const cursor = `${this.id}:${this.recent.at(-1)?.id ?? 0}`;
    const status = this.runningSince === null ? "paused" : "running";
    const snapshot: SessionSnapshot = {
      id: this.id,
      cursor,
      status,
      time,
      speed: this.speed,
      nextAt: this.runtime.nextAt(),
      reminder: this.reminderDue(now),
      idleStop: this.options.idleStop,
      error: this.saveError || this.runtimeError,
    };
    if (cursor !== since) {
      const events = new Map<number, Event>();
      for (const event of this.outputs.values()) events.set(event.id, event);
      for (const event of this.active.values()) events.set(event.id, event);
      for (const event of this.recent) events.set(event.id, event);
      snapshot.view = structuredClone({
        source: this.loaded.source,
        fingerprint: this.loaded.fingerprint,
        assetBase: `/ui/run/${this.id}`,
        initial: this.runtime.initial,
        current: this.runtime.state,
        events: [...events.values()].sort((a, b) => a.id - b.id),
      });
    }
    return snapshot;
  }

  recording(): Recording | undefined {
    if (!this.recorded) return;
    const events = this.recorded;
    const error = events.find(event => event.kind === "error");
    return {
      mode: "simulation",
      complete: true,
      status: error ? "failed" : "completed",
      entry: this.loaded.world.name,
      duration: this.elapsed,
      events,
      initial: this.runtime.initial,
      final: this.runtime.state,
      coverage: [...new Set(events.filter(event => event.kind === "output")
        .map(event => `${event.node}#${event.branch}`))],
      ...(error ? { error: String(error.data.message) } : {}),
    };
  }

  close() {
    this.runtime.close();
  }
}
