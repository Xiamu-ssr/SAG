import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseWorld, type World } from '../core/model';
import { readInitialData, type ResourceData } from './resource-store';

export type WebFiles = Record<string, Record<string, string>>;
export type WorldDirectory = {
  directory: string;
  source: string;
  world: World;
  initial: ResourceData;
  assets: WebFiles;
  scripts: Record<string, string>;
  fingerprint: string;
};
const extensions = /\.(html|js|mjs|css|json|map|svg|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf|wasm|mp3|wav|ogg|mp4|webm|txt)$/i;

export function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

function child(root: string, path: string) {
  if (isAbsolute(path) || !path || path.split(/[\\/]/).some(s => s === '..' || s.startsWith('.'))) throw new Error(`目录引用必须是世界内的相对路径：${path}`);
  const file = realpathSync(resolve(root, path));
  if (!inside(root, file)) throw new Error(`目录引用越过世界边界：${path}`);
  return file;
}

export function serviceScript(directory: string, script: string) {
  let path: string;
  try { path = child(directory, script); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`外部服务脚本不存在：${script}`);
    throw error;
  }
  const info = statSync(path);
  if (!info.isFile() || info.size > 1024 * 1024)
    throw new Error(`外部服务脚本应为不超过 1 MB 的文件：${script}`);
  return {path, digest: createHash('sha256').update(readFileSync(path)).digest('hex')};
}

export function worldDirectoryPath(directory: string) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('请选择世界目录，或填写绝对路径');
  const root = realpathSync.native(directory);
  if (!statSync(root).isDirectory()) throw new Error('请选择目录，不是单个文件');
  return root;
}

export function readWorldSource(directory: string) {
  const root = worldDirectoryPath(directory);
  const yaml = child(root, 'world.yaml');
  if (!statSync(yaml).isFile() || statSync(yaml).size > 512000) throw new Error('world.yaml 应为不超过 500 KB 的文件');
  const source = readFileSync(yaml, 'utf8');
  return {directory: root, source, world: parseWorld(source)};
}

export function loadWorldDirectory(directory: string): WorldDirectory {
  const loaded = readWorldSource(directory), {world} = loaded;
  if (!existsSync(join(loaded.directory, 'initial.sqlite'))) throw new Error('缺少 initial.sqlite；请用 world init-data 目录 生成空初始库');
  const initialFile = child(loaded.directory, 'initial.sqlite');
  if (!statSync(initialFile).isFile() || statSync(initialFile).size > 16 * 1024 * 1024) throw new Error('initial.sqlite 应为不超过 16 MB 的文件');
  const initial = readInitialData(initialFile, world);
  const assets: WebFiles = {};
  let files = 0, bytes = 0;
  for (const domain of world.domains) {
    if (domain.type !== 'UI' || !domain.view) continue;
    const view = child(loaded.directory, domain.view.directory);
    if (!statSync(view).isDirectory()) throw new Error(`${domain.name} 的 view.directory 不是目录`);
    const result: Record<string, string> = {};
    const walk = (folder: string, prefix = '') => {
      for (const entry of readdirSync(folder).sort()) {
        if (entry.startsWith('.')) continue;
        const path = join(folder, entry), info = lstatSync(path), key = prefix + entry;
        if (info.isSymbolicLink()) throw new Error(`前台构建目录不接受符号链接：${key}`);
        if (info.isDirectory()) { walk(path, key + '/'); continue; }
        if (!info.isFile() || !extensions.test(key)) throw new Error(`前台请引用可运行的静态构建目录，发现非浏览器文件：${key}`);
        if (++files > 512 || (bytes += info.size) > 16 * 1024 * 1024) throw new Error('前台构建产物超过 512 文件或 16 MB');
        result[key] = readFileSync(path).toString('base64');
      }
    };
    walk(view);
    if (!Object.hasOwn(result, 'index.html')) throw new Error(`${domain.name} 的前台目录缺少 index.html`);
    assets[domain.id] = result;
  }
  const scripts = Object.fromEntries(world.services.map(service =>
    [service.id, serviceScript(loaded.directory, service.script).digest]));
  const hash = createHash('sha256').update(loaded.source).update(JSON.stringify(initial)).update(JSON.stringify(assets));
  if (world.services.length) hash.update(JSON.stringify(scripts));
  return {...loaded, initial, assets, scripts, fingerprint: hash.digest('hex')};
}
