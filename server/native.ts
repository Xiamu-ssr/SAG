import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export async function pickDirectory() {
  if (process.platform !== 'darwin') throw new Error('当前系统请直接填写目录绝对路径');
  try {
    const {stdout} = await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择 SAG 世界目录")'], {timeout: 120000, maxBuffer: 8192});
    return stdout.trim() || null;
  } catch (error) {
    if (String((error as {stderr?: string}).stderr).includes('(-128)')) return null;
    throw new Error('文件夹选择未完成；也可以直接填写目录路径');
  }
}

export async function openDirectory(directory: string) {
  if (process.platform === 'darwin') await run('open', [directory]);
  else if (process.platform === 'win32') await run('explorer.exe', [directory]);
  else await run('xdg-open', [directory]);
}
