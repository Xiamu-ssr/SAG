import {execFile} from 'node:child_process';
import type {ServiceRunner} from '../core/engine';
import {serviceScript, type WorldDirectory} from './world-directory';

export function serviceRunner(loaded: WorldDirectory): ServiceRunner {
  return async (service, input, signal) => {
    const {path, digest} = serviceScript(loaded.directory, service.script);
    if (digest !== loaded.scripts[service.id])
      throw new Error('服务脚本已修改，请重新启动世界');
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, ['--', path], {
        cwd: loaded.directory,
        signal,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        killSignal: 'SIGKILL',
      }, (error, stdout) => {
        if (!error) resolve(stdout);
        else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
          reject(new Error('脚本输出超过 1 MB'));
        else if (error.killed && !signal.aborted)
          reject(new Error('脚本执行超过 60 秒'));
        else reject(new Error(`脚本执行失败（${error.code ?? error.signal ?? '未知错误'}）`));
      });
      // A script may exit before consuming stdin. The process callback reports its exit.
      child.stdin?.on('error', () => {});
      child.stdin?.end(JSON.stringify(input));
    });
    try { return JSON.parse(stdout); }
    catch { throw new Error('脚本标准输出应为一个 JSON 对象'); }
  };
}
