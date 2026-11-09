import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const documentFile = /\.(md|markdown|txt)$/i;
const imageFile = /\.(png|jpe?g|webp|gif|avif)$/i;
const publicName = (name: string) => !!name && !name.startsWith('.') && !/[\\\u0000]/.test(name);

function docsDirectory(world: string) {
  const directory = join(world, 'docs');
  const info = lstatSync(directory, {throwIfNoEntry: false});
  if (!info) return undefined;
  if (!info.isDirectory()) throw new Error('docs 必须是世界内的实际目录');
  return directory;
}

export function listDocuments(world: string) {
  const directory = docsDirectory(world);
  const files: string[] = [];
  function walk(folder: string, prefix = '') {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      if (!publicName(entry.name)) continue;
      const path = prefix + entry.name;
      if (entry.isDirectory()) walk(join(folder, entry.name), path + '/');
      else if (entry.isFile() && documentFile.test(entry.name)) files.push(path);
    }
  }
  if (directory) walk(directory);
  return files.sort((a, b) => a.localeCompare(b, 'zh', {numeric: true}));
}

export function readDocument(world: string, path: unknown, image = false) {
  const directory = docsDirectory(world);
  if (!directory || typeof path !== 'string' || !path.split('/').every(publicName) ||
    !(image ? imageFile : documentFile).test(path)) throw new Error('请选择 docs 中的文件');
  const file = join(directory, path);
  const info = lstatSync(file, {throwIfNoEntry: false});
  if (!info?.isFile() || realpathSync.native(file) !== file) throw new Error('文档文件不存在或使用了链接');
  if (info.size > (image ? 8 : 2) * 1024 * 1024) throw new Error('文件太大，无法预览');
  return readFileSync(file);
}
