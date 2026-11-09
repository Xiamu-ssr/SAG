import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const {文本} = JSON.parse(readFileSync(0, 'utf8'));
const key = createHash('sha256').update(文本).digest('hex').slice(0, 16);
const audio = `speech/${key}.mp3`;
console.log(JSON.stringify(existsSync(new URL(`../frontend/${audio}`, import.meta.url)) ? {音频地址: audio} : {}));
