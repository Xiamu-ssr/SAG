import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { openStore, type Store } from './store';
import { isWorldSpeed } from '../core/speed';
import { pickDirectory, openDirectory } from './native';
import { listDocuments, readDocument } from './world-documents';

export function createApi(store: Store, port = 4880, native = {pickDirectory, openDirectory}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(req.headers.host || '')) return res.status(403).json({error: '仅允许本地访问'});
    if (req.path.startsWith('/api') && !['GET', 'HEAD'].includes(req.method)) {
      if (req.headers['x-sag-local'] !== '1') return res.status(403).json({error: '缺少本地请求标记'});
      if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return res.status(403).json({error: '拒绝跨站写入'});
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({limit: '600kb'}));
  app.get('/api/spaces', (_q, r) => r.json(store.listSpaces()));
  app.post('/api/spaces', (q, r) => r.json(store.createSpace(q.body?.name)));
  app.post('/api/pick-directory', async (_q, r) => {
    const selected = await native.pickDirectory();
    r.json({directory: selected ? store.externalDirectory(selected) : null});
  });
  app.get('/api/apps', (_q, r) => r.json(store.listApps()));
  app.post('/api/apps', (q, r) => {
    if (Object.keys(q.body || {}).some(key => !['directory', 'spaceId'].includes(key))) throw new Error('添加世界只接受目录和空间');
    r.json(store.addDirectory(q.body?.directory, q.body?.spaceId));
  });
  app.get('/api/apps/:id', (q, r) => r.json(store.get(q.params.id)));
  app.post('/api/apps/:id/open-directory', async (q, r) => { await native.openDirectory(store.directoryFor(q.params.id)); r.json({opened: true}); });
  app.get('/api/apps/:id/data', (q, r) => r.json(store.getData(q.params.id)));
  app.get('/api/apps/:id/documents', (q, r) => {
    r.setHeader('Cache-Control', 'no-store');
    const directory = store.directoryFor(q.params.id);
    if (q.query.path === undefined) r.json({files: listDocuments(directory)});
    else r.json({source: readDocument(directory, q.query.path).toString('utf8')});
  });
  app.get('/api/apps/:id/documents/image', (q, r) => {
    const path = q.query.path;
    const data = readDocument(store.directoryFor(q.params.id), path, true);
    r.setHeader('Cache-Control', 'no-store');
    r.type(extname(String(path))).send(data);
  });
  app.get('/api/apps/:id/runs', (q, r) => r.json(store.runs(q.params.id)));
  app.get('/api/sessions/reminder', (_q, r) => r.json(store.getReminder()));
  app.get('/api/apps/:id/session', (q, r) => {
    const since = typeof q.query.since === 'string' ? q.query.since : undefined;
    r.json(store.getSession(q.params.id, since));
  });
  app.post('/api/apps/:id/session', (q, r) => {
    const {fingerprint, record = false, idleStop = false, speed = 1} = q.body ?? {};
    if (typeof fingerprint !== 'string' || typeof record !== 'boolean' || typeof idleStop !== 'boolean')
      throw new Error('启动需要世界指纹和布尔选项');
    if (!isWorldSpeed(speed)) throw new Error('速度须在 0.1 到 10 之间');
    r.json(store.startSession(q.params.id, fingerprint, {record, idleStop, speed}));
  });
  app.post('/api/apps/:id/session/input', (q, r) => {
    const {sessionId, node, input, since} = q.body ?? {};
    if (typeof sessionId !== 'string' || typeof node !== 'string')
      throw new Error('需要运行标识和小域坐标');
    r.json(store.enterSession(q.params.id, sessionId, {node, input}, typeof since === 'string' ? since : undefined));
  });
  app.post('/api/apps/:id/session/control', (q, r) => {
    const {sessionId, action, since, speed} = q.body ?? {};
    if (typeof sessionId !== 'string') throw new Error('需要运行标识');
    const cursor = typeof since === 'string' ? since : undefined;
    if (action === 'speed') {
      if (!isWorldSpeed(speed)) throw new Error('速度须在 0.1 到 10 之间');
      return r.json(store.controlSession(q.params.id, sessionId, {speed}, cursor));
    }
    if (action !== 'pause' && action !== 'resume' && action !== 'continue' && action !== 'stop' && action !== 'activity')
      throw new Error('未知的世界运行操作');
    r.json(store.controlSession(q.params.id, sessionId, action, cursor));
  });
  app.get('/api/runs/:id', (q, r) => r.json(store.getRun(q.params.id)));
  app.use('/api', (_q, r) => r.status(404).json({error: '接口不存在'}));
  app.get('/_sag/ui.js', (_q, r) => {
    r.setHeader('Access-Control-Allow-Origin', '*');
    r.type('application/javascript').send(readFileSync(new URL('./ui-bridge.js', import.meta.url), 'utf8'));
  });
  app.use('/ui', (q, r) => {
    if (!['GET', 'HEAD'].includes(q.method)) return r.sendStatus(405);
    try {
      const world = /^\/world\/([^/]+)\/([a-f0-9]{64})\/([^/]+)\/(.+)$/.exec(q.path);
      const run = /^\/run\/([^/]+)\/([^/]+)\/(.+)$/.exec(q.path);
      if (!world && !run) return r.sendStatus(404);
      const domain = decodeURIComponent(world ? world[3] : run![2]);
      const path = decodeURIComponent(world ? world[4] : run![3]);
      if (path.split('/').some(segment => !segment || segment.startsWith('.')) || path.includes('\\')) return r.sendStatus(404);
      const asset = world ? store.worldAsset(world[1], world[2], domain, path) : store.runAsset(run![1], domain, path);
      let data = asset.data;
      const media = asset.media.length ? ' ' + asset.media.join(' ') : '';
      const base = `http://${q.headers.host}/ui/${world ? `world/${world[1]}/${world[2]}/${world[3]}` : `run/${run![1]}/${run![2]}`}/`;
      r.setHeader('Access-Control-Allow-Origin', '*');
      r.setHeader('Cache-Control', 'no-store');
      r.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:${media}; font-src 'self' data:; media-src 'self' blob:${media}; connect-src ${base}; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts allow-forms`);
      r.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      if (extname(path) === '.html') {
        const html = data.toString('utf8');
        const bridge = '<script src="/_sag/ui.js"></script>';
        data = Buffer.from(/<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, match => match + bridge) : bridge + html);
      }
      r.type(extname(path)).send(data);
    } catch (error) { r.status(404).type('text/plain').send(error instanceof Error ? error.message : String(error)); }
  });
  app.use((err: Error, _q: express.Request, r: express.Response, _n: express.NextFunction) => r.status(400).json({error: err.message}));
  return app;
}

async function start() {
  const root = dirname(dirname(fileURLToPath(import.meta.url))), port = Number(process.env.SAG_PORT || 4880);
  const store = openStore(root, process.env.SAG_DATA_DIR || join(root, '.sag'));
  const app = createApi(store, port), server = createHttpServer(app);
  server.once('close', () => store.close());
  let vite: import('vite').ViteDevServer | undefined;
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(join(root, 'dist')));
    app.get('/{*path}', (_q, r) => r.sendFile(join(root, 'dist/index.html')));
  } else {
    const {createServer} = await import('vite');
    vite = await createServer({root, server: {middlewareMode: true, hmr: {server}}, appType: 'spa'});
    app.use(vite.middlewares);
  }
  server.listen(port, '127.0.0.1', () => console.log(`SAG: http://127.0.0.1:${port}/`));
  const stop = () => {
    void vite?.close().catch(error => console.error(error));
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await start();
