import { resolve } from 'node:path';
import { simulate } from '../core/engine';
import { loadWorldDirectory } from './world-directory';
import { reference } from '../core/coordinate';
import { serviceRunner } from './services';
try {
  const [directory, node, input] = process.argv.slice(2);
  if (!directory || !node || !input) throw new Error('用法：simulate 世界目录 [大域:domain/小域:node] \'{"字段":"值"}\'');
  const loaded = loadWorldDirectory(resolve(directory));
  const recording = await simulate(loaded.world, {node: reference(node, 'node'), input: JSON.parse(input)}, loaded.initial, serviceRunner(loaded));
  console.log(JSON.stringify(recording, null, 2));
  if (recording.status === 'failed') process.exitCode = 1;
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
