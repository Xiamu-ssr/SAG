import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { applyDefaults, checkData, parseWorld, type World } from '../core/model';
import type { Recording, Start } from '../core/engine';
import { createInitialData, writeResourceData, type ResourceData } from './resource-store';
import { inside, loadWorldDirectory, worldDirectoryPath, type WorldDirectory, type WebFiles } from './world-directory';
import { WorldSession, type Reminder, type SessionCommand, type SessionOptions } from './session';

export type SpaceRow = {id: string; name: string; created: string};
export type AppSummary = {id: string; name: string; directory: string; spaceId: string; builtin: boolean; fingerprint: string; description: string; domainCount: number; nodeCount: number; fableCount: number; runCount: number; created: string; updated: string; error?: string};
export type AppRow = Omit<AppSummary, 'description' | 'domainCount' | 'nodeCount' | 'fableCount' | 'runCount'> & {source: string; assetBase: string};
export type RunSummary = {id: string; appId: string; entry: string; name?: string; status: Recording['status']; created: string};
export type RunRow = {id: string; appId: string; source: string; fingerprint: string; assetBase: string; created: string; recording: Recording; saved: boolean};
export type InitialData = {data: ResourceData; fingerprint: string};
type Registered = {id: string; directory: string; spaceId: string; builtin: number; name: string; summary: string; created: string; updated: string};
type Capture = {run: RunRow; assets: WebFiles};
type StoreOptions = {now?: () => number; engineDirectory?: string};
function checkedName(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error('名称应为 1～80 个字符');
  return value.trim();
}

export class Store {
  db: DatabaseSync;
  private views = new Map<string, WorldDirectory>();
  private sessions = new Map<string, WorldSession>();
  private now: () => number;
  private engineDirectory: string;
  constructor(public directory: string, builtinDirectory?: string, options: StoreOptions = {}) {
    mkdirSync(directory, {recursive: true});
    mkdirSync(join(directory, 'runs'), {recursive: true});
    this.now = options.now ?? (() => Math.floor(performance.now()));
    this.engineDirectory = realpathSync.native(options.engineDirectory ?? fileURLToPath(new URL('../', import.meta.url)));
    // This library stores directory references, never a second editable world definition.
    this.db = new DatabaseSync(join(directory, 'library.sqlite'));
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS worlds(id TEXT PRIMARY KEY,directory TEXT NOT NULL UNIQUE,spaceId TEXT NOT NULL REFERENCES spaces(id),builtin INTEGER NOT NULL,name TEXT NOT NULL UNIQUE,summary TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,appId TEXT NOT NULL REFERENCES worlds(id),entry TEXT NOT NULL,name TEXT,status TEXT NOT NULL,created TEXT NOT NULL);`);
    this.db.prepare('INSERT OR IGNORE INTO spaces VALUES(?,?,?)').run('local', '本地工作室', new Date().toISOString());
    if (builtinDirectory) {
      try { this.addDirectory(builtinDirectory, 'local', true); }
      catch (error) { this.db.close(); throw error; }
    }
  }

  private registered(id: string): Registered {
    const row = this.db.prepare('SELECT * FROM worlds WHERE id=?').get(id) as Registered | undefined;
    if (!row) throw new Error('世界不存在');
    return row;
  }
  private countRuns(id: string) { return Number(this.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE appId=?').get(id)!.n); }
  private remember(id: string, loaded: WorldDirectory) {
    const key = id + ':' + loaded.fingerprint;
    this.views.delete(key); this.views.set(key, loaded);
    while (this.views.size > 4) this.views.delete(this.views.keys().next().value!);
  }
  private read(id: string) {
    const registered = this.registered(id), loaded = loadWorldDirectory(registered.directory);
    const duplicate = this.db.prepare('SELECT id FROM worlds WHERE name=? AND id<>?').get(loaded.world.name, id);
    if (duplicate) throw new Error(`世界名称已存在：${loaded.world.name}`);
    const summary = {fingerprint: loaded.fingerprint, description: loaded.world.description, domainCount: loaded.world.domains.length, nodeCount: loaded.world.nodes.length, fableCount: loaded.world.fables.length};
    const updated = registered.summary === JSON.stringify(summary) && registered.name === loaded.world.name ? registered.updated : new Date().toISOString();
    this.db.prepare('UPDATE worlds SET name=?,summary=?,updated=? WHERE id=?').run(loaded.world.name, JSON.stringify(summary), updated, id);
    this.remember(id, loaded);
    return {registered: {...registered, name: loaded.world.name, updated}, loaded, summary};
  }
  private row(id: string, value: Pick<ReturnType<Store['read']>, 'registered' | 'loaded'>): AppRow {
    const {registered: r, loaded} = value;
    return {id, name: r.name, directory: r.directory, spaceId: r.spaceId, builtin: !!r.builtin, fingerprint: loaded.fingerprint, source: loaded.source, assetBase: `/ui/world/${id}/${loaded.fingerprint}`, created: r.created, updated: r.updated};
  }
  listSpaces(): SpaceRow[] { return this.db.prepare('SELECT * FROM spaces ORDER BY created,rowid').all() as SpaceRow[]; }
  createSpace(name: string): SpaceRow {
    const row = {id: randomUUID(), name: checkedName(name), created: new Date().toISOString()};
    this.db.prepare('INSERT INTO spaces VALUES(?,?,?)').run(row.id, row.name, row.created);
    return row;
  }
  addDirectory(directory: string, spaceId = 'local', builtin = false): AppRow {
    if (!this.db.prepare('SELECT id FROM spaces WHERE id=?').get(spaceId)) throw new Error('空间不存在');
    const loaded = loadWorldDirectory(builtin ? directory : this.externalDirectory(directory));
    const existing = this.db.prepare('SELECT id FROM worlds WHERE directory=?').get(loaded.directory);
    if (existing) return this.get(String(existing.id));
    if (this.db.prepare('SELECT id FROM worlds WHERE name=?').get(loaded.world.name)) throw new Error(`世界名称已存在：${loaded.world.name}`);
    const id = builtin ? 'builtin-photo' : randomUUID(), created = new Date().toISOString();
    this.db.prepare('INSERT INTO worlds VALUES(?,?,?,?,?,?,?,?)').run(id, loaded.directory, spaceId, Number(builtin), loaded.world.name, '{}', created, created);
    return this.get(id);
  }
  listApps(): AppSummary[] {
    const rows = this.db.prepare('SELECT * FROM worlds ORDER BY builtin DESC,created,rowid').all() as Registered[];
    return rows.map(r => {
      try {
        const current = this.read(r.id);
        const {source: _source, assetBase: _assetBase, ...metadata} = this.row(r.id, current);
        return {...metadata, ...current.summary, runCount: this.countRuns(r.id)};
      } catch (error) {
        return {id: r.id, name: r.name, directory: r.directory, spaceId: r.spaceId, builtin: !!r.builtin,
          fingerprint: '', description: '', domainCount: 0, nodeCount: 0, fableCount: 0,
          ...JSON.parse(r.summary), runCount: this.countRuns(r.id), created: r.created, updated: r.updated, error: error instanceof Error ? error.message : String(error)};
      }
    });
  }
  get(id: string): AppRow {
    const session = this.sessions.get(id);
    return this.row(id, session ? {registered: this.registered(id), loaded: session.loaded} : this.read(id));
  }
  getData(id: string): InitialData {
    const loaded = this.sessions.get(id)?.loaded ?? this.read(id).loaded;
    return {data: structuredClone(loaded.initial), fingerprint: loaded.fingerprint};
  }
  directoryFor(id: string) {
    const directory = realpathSync.native(this.registered(id).directory);
    if (!statSync(directory).isDirectory()) throw new Error('世界目录不存在');
    return directory;
  }
  externalDirectory(path: string) {
    const directory = worldDirectoryPath(path);
    if (inside(this.engineDirectory, directory)) throw new Error('请选择 SAG 目录之外的世界文件夹');
    return directory;
  }
  runs(id: string): RunSummary[] {
    this.registered(id);
    return this.db.prepare('SELECT * FROM runs WHERE appId=? ORDER BY created DESC,rowid DESC').all(id) as RunSummary[];
  }

  startSession(appId: string, fingerprint: string, options: SessionOptions) {
    const now = this.now();
    if (this.advanceSession(appId, now)) throw new Error('世界已经启动');
    const {loaded} = this.read(appId);
    if (loaded.fingerprint !== fingerprint) throw new Error('世界目录已变化，请重新打开后启动');
    const startedAt = this.now();
    const session = new WorldSession(loaded, options, startedAt, this.now, () => {
      if (this.sessions.get(appId) === session) this.schedule(appId, session, this.now());
    });
    this.sessions.set(appId, session);
    this.schedule(appId, session, startedAt);
    return session.snapshot(startedAt);
  }

  getSession(appId: string, since?: string) {
    const now = this.now();
    return this.advanceSession(appId, now)?.snapshot(now, since) ?? null;
  }

  getReminder(): Reminder | null {
    const now = this.now();
    for (const [appId, session] of this.sessions) {
      if (session.reminderDue(now))
        return {appId, sessionId: session.id, name: session.loaded.world.name};
    }
    return null;
  }

  enterSession(appId: string, id: string, start: Start, since?: string) {
    const now = this.now(), session = this.advanceSession(appId, now);
    if (session?.id !== id) throw new Error('这次世界运行已结束');
    const node = session.loaded.world.nodes.find(item => item.id === start.node);
    if (!node) throw new Error('小域不存在');
    const input = applyDefaults(start.input, node.input);
    checkData(input, node.input, node.name + '输入');
    session.enter({node: node.id, input}, now);
    this.schedule(appId, session, now);
    return session.snapshot(now, since);
  }

  controlSession(appId: string, id: string, action: SessionCommand, since?: string) {
    const now = this.now(), session = this.advanceSession(appId, now);
    if (!session && action === 'stop') return null;
    if (session?.id !== id) throw new Error('这次世界运行已结束');
    session.activity(now);
    if (action === 'stop') {
      this.finishSession(appId, session, now);
      return null;
    }
    if (action === 'pause') session.pause(now);
    if (action === 'resume') session.resume(now);
    if (typeof action === 'object') session.setSpeed(action.speed, now);
    if (action === 'continue' || action === 'pause') session.dismissReminder(now);
    this.schedule(appId, session, now);
    return action === 'activity' ? null : session.snapshot(now, since);
  }

  private advanceSession(appId: string, now: number) {
    const session = this.sessions.get(appId);
    if (!session) return;
    const deadline = session.idleAt;
    session.advance(Math.min(now, deadline));
    if (now >= deadline) {
      try {
        this.finishSession(appId, session, deadline);
        return;
      } catch {
        // A failed save leaves the frozen world available for retry.
      }
    }
    this.schedule(appId, session, now);
    return session;
  }

  private schedule(appId: string, session: WorldSession, now: number) {
    clearTimeout(session.timer);
    const wakeAt = session.wakeAt(now);
    if (Number.isFinite(wakeAt)) {
      session.timer = setTimeout(() => this.advanceSession(appId, this.now()), Math.ceil(Math.max(0, wakeAt - now)));
      session.timer.unref();
    }
  }

  private finishSession(appId: string, session: WorldSession, now: number) {
    session.pause(now);
    clearTimeout(session.timer);
    const recording = session.recording();
    if (recording) {
      const {id, loaded, created} = session;
      const run: RunRow = {
        id, appId, created, recording, saved: true,
        source: loaded.source, fingerprint: loaded.fingerprint, assetBase: `/ui/run/${id}`,
      };
      try { this.archive({run, assets: loaded.assets}, loaded.world); }
      catch (error) {
        session.saveError = `保存留影失败：${error instanceof Error ? error.message : String(error)}`;
        throw new Error(session.saveError);
      }
    }
    session.close();
    this.sessions.delete(appId);
  }

  private file(id: string) { return join(this.directory, 'runs', id + '.sqlite'); }
  private capture(id: string): Capture {
    if (!this.db.prepare('SELECT id FROM runs WHERE id=?').get(id)) throw new Error('留影不存在');
    const db = new DatabaseSync(this.file(id), {readOnly: true});
    try { return JSON.parse(String(db.prepare('SELECT document FROM _sag_capture').get()!.document)) as Capture; }
    finally { db.close(); }
  }
  getRun(id: string) { return this.capture(id).run; }
  private archive(capture: Capture, world: World) {
    const {run} = capture;
    const file = this.file(run.id);
    if (existsSync(file)) throw new Error('留影文件已存在，拒绝覆盖');
    try {
      createInitialData(file, world);
      const db = new DatabaseSync(file);
      try {
        writeResourceData(db, world, run.recording.final);
        db.exec('CREATE TABLE _sag_capture(document TEXT NOT NULL)');
        db.prepare('INSERT INTO _sag_capture VALUES(?)').run(JSON.stringify(capture));
      } finally { db.close(); }
      this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)')
        .run(run.id, run.appId, run.recording.entry, world.name, run.recording.status, run.created);
    } catch (error) { if (existsSync(file)) rmSync(file); throw error; }
  }
  worldAsset(id: string, fingerprint: string, domain: string, path: string) {
    const key = id + ':' + fingerprint;
    const loaded = this.views.get(key) || this.read(id).loaded;
    if (loaded.fingerprint !== fingerprint) throw new Error('世界目录已变化，请重新打开');
    return this.asset(loaded.assets, domain, path, loaded.world);
  }
  runAsset(id: string, domain: string, path: string) {
    const session = [...this.sessions.values()].find(session => session.id === id);
    if (session) return this.asset(session.loaded.assets, domain, path, session.loaded.world);
    const capture = this.capture(id);
    const world = path.endsWith('.html') ? parseWorld(capture.run.source) : undefined;
    return this.asset(capture.assets, domain, path, world);
  }
  private asset(assets: WebFiles, domain: string, path: string, world?: World) {
    if (!Object.hasOwn(assets, domain) || !Object.hasOwn(assets[domain], path)) throw new Error('前台文件不存在');
    return {
      data: Buffer.from(assets[domain][path], 'base64'),
      media: world?.domains.find(item => item.id === domain)?.view?.media ?? [],
    };
  }
  close() {
    for (const [appId, session] of this.sessions) {
      const now = Math.min(this.now(), session.idleAt);
      session.advance(now);
      try { this.finishSession(appId, session, now); }
      catch (error) { session.close(); console.error(error); }
    }
    this.sessions.clear();
    this.views.clear();
    this.db.close();
  }
}

export function openStore(root: string, directory = join(root, '.sag')) {
  return new Store(directory, join(root, 'examples', 'photo-recognition'), {engineDirectory: root});
}
