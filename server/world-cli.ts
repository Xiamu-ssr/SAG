import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorldDirectory, readWorldSource } from './world-directory';
import { createInitialData } from './resource-store';

export async function worldCommand(args: string[], base = process.env.SAG_URL || 'http://127.0.0.1:4880') {
  const [command, directory] = args;
  if (command === 'check' && directory) {
    const {world} = loadWorldDirectory(resolve(directory));
    return {ok: true, name: world.name, domains: world.domains.length, nodes: world.nodes.length, fables: world.fables.length};
  }
  if (command === 'init-data' && directory) {
    const loaded = readWorldSource(resolve(directory));
    const file = join(loaded.directory, 'initial.sqlite');
    createInitialData(file, loaded.world);
    return {file};
  }
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.hash || url.search) throw new Error('SAG_URL 必须是无凭据的本地 HTTP 地址');
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(new URL('/api' + path, url), {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type':'application/json','X-SAG-Local':'1'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  };
  if (command === 'list') return request('/apps');
  if (command === 'add' && directory) {
    const spaceIndex = args.indexOf('--space');
    return request('/apps', {directory: resolve(directory), spaceId: spaceIndex < 0 ? 'local' : args[spaceIndex + 1]});
  }
  throw new Error('用法：world list | check 目录 | init-data 目录 | add 目录 [--space 空间ID]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await worldCommand(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
