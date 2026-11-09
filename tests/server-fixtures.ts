import type { TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { parseWorld } from '../core/model';
import { createInitialData } from '../server/resource-store';
import { Store } from '../server/store';
import { createApi } from '../server/index';
import { echoSource } from './fixtures';

export function worldFolder(root: string, name = '测试世界', source = echoSource) {
  const directory = join(root, name);
  mkdirSync(join(directory, 'frontend'), {recursive: true});
  const yaml = source.replace('name: 回声世界', 'name: ' + name);
  writeFileSync(join(directory, 'world.yaml'), yaml);
  writeFileSync(join(directory, 'frontend', 'index.html'), '<!doctype html><html><head></head><body><h1>原始界面</h1><script type="module" src="./main.js"></script></body></html>');
  writeFileSync(join(directory, 'frontend', 'main.js'), 'document.body.dataset.loaded="true";');
  createInitialData(join(directory, 'initial.sqlite'), parseWorld(yaml));
  return directory;
}
export function fixture(t: TestContext, options: ConstructorParameters<typeof Store>[2] = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sag-directory-test-'))), library = join(root, 'library');
  const directory = worldFolder(root), store = new Store(library, undefined, options);
  const nativeCalls: string[] = [];
  const api = createApi(store, 4880, {pickDirectory: async () => directory, openDirectory: async path => { nativeCalls.push(path); }});
  t.after(() => { try { store.close(); } catch {} rmSync(root, {recursive: true, force: true}); });
  function request<T = {error: string}>(method: string, path: string, body?: unknown, headers: Record<string, string | undefined> = {}): Promise<{status: number; body: T; text: string; headers: ReturnType<ServerResponse['getHeaders']>}> {
    return new Promise((resolve, reject) => {
      const socket = new Socket(), req = new IncomingMessage(socket), payload = body === undefined ? '' : JSON.stringify(body);
      req.method = method; req.url = path;
      req.headers = {host: '127.0.0.1:4880', 'x-sag-local': '1', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)), ...headers};
      const res = new ServerResponse(req);
      res.end = ((chunk?: unknown) => {
        const text = chunk === undefined ? '' : String(chunk);
        let parsed: unknown; try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({status: res.statusCode, body: parsed as T, text, headers: res.getHeaders()}); socket.destroy(); return res;
      }) as typeof res.end;
      req.on('error', reject); api(req, res);
      if (payload) req.push(Buffer.from(payload)); req.push(null);
    });
  }
  return {root, library, directory, store, request, nativeCalls};
}
