import { DatabaseSync } from 'node:sqlite';
import { existsSync, openSync, closeSync, rmSync } from 'node:fs';
import { checkData, type Data, type Field, type World } from '../core/model';

export type ResourceData = Record<string, Data[]>;
const quoted = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const sqlType = (field: Field) => field.type === 'number' ? 'REAL' : field.type === 'boolean' ? 'INTEGER' : 'TEXT';

export function validateData(world: World, value: unknown, maxRows = Infinity): ResourceData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('初始数据应为资源与记录的集合');
  const data = value as ResourceData;
  for (const key of Object.keys(data)) if (!world.resources.some(r => r.id === key)) throw new Error(`未声明资源 ${key}`);
  for (const resource of world.resources) {
    if (!Object.hasOwn(data, resource.id) || !Array.isArray(data[resource.id])) throw new Error(`缺少资源 ${resource.id}`);
    if (data[resource.id].length > maxRows) throw new Error(`${resource.name} 超过 ${maxRows} 条演练记录`);
    data[resource.id].forEach(row => checkData(row, resource.fields, resource.name));
  }
  return data;
}

export function readResourceData(db: DatabaseSync, world: World): ResourceData {
  db.exec('PRAGMA trusted_schema=OFF');
  const objects = db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").all();
  if (objects.some(o => o.type !== 'table' && o.type !== 'index')) throw new Error('初始库只允许数据表和索引，不允许视图或触发器');
  const tables = objects.filter(o => o.type === 'table').map(o => String(o.name));
  if (tables.length !== world.resources.length || tables.some(name => !world.resources.some(r => r.id === name))) throw new Error('initial.sqlite 的表必须与 resource 一致');
  const data: ResourceData = {};
  for (const resource of world.resources) {
    const columns = db.prepare(`PRAGMA table_info(${quoted(resource.id)})`).all();
    if (columns.length !== Object.keys(resource.fields).length || columns.some(c => !Object.hasOwn(resource.fields, String(c.name)))) throw new Error(`${resource.name} 的列必须与 field 一致`);
    const rows = db.prepare(`SELECT * FROM ${quoted(resource.id)} LIMIT 1001`).all();
    data[resource.id] = rows.map(row => Object.fromEntries(Object.entries(resource.fields).flatMap(([key, field]) => {
      let value: unknown = row[key];
      if (value === null && field.optional) return [];
      if (field.type === 'boolean' && (value === 0 || value === 1)) value = value === 1;
      if (field.type === 'object' && typeof value === 'string') {
        try { value = JSON.parse(value); } catch { throw new Error(`${resource.name}.${key} 不是有效 JSON`); }
      }
      return [[key, value]];
    })) as Data);
  }
  return validateData(world, data, 1000);
}

export function writeResourceData(db: DatabaseSync, world: World, data: ResourceData) {
  validateData(world, data);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const resource of world.resources) {
      db.exec(`DELETE FROM ${quoted(resource.id)}`);
      const names = Object.keys(resource.fields);
      const insert = db.prepare(`INSERT INTO ${quoted(resource.id)} (${names.map(quoted).join(',')}) VALUES (${names.map(() => '?').join(',')})`);
      for (const row of data[resource.id]) insert.run(...names.map(name => {
        const value = row[name];
        return value === undefined ? null : typeof value === 'boolean' ? Number(value) : typeof value === 'object' ? JSON.stringify(value) : value;
      }));
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function createInitialData(file: string, world: World) {
  if (existsSync(file)) throw new Error('initial.sqlite 已存在，拒绝覆盖');
  closeSync(openSync(file, 'wx'));
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN');
    for (const resource of world.resources) {
      db.exec(`CREATE TABLE ${quoted(resource.id)} (${Object.entries(resource.fields).map(([name, field]) => `${quoted(name)} ${sqlType(field)}${field.optional ? '' : ' NOT NULL'}`).join(',')})`);
    }
    db.exec('COMMIT; VACUUM');
  } catch (error) { db.close(); rmSync(file); throw error; }
  db.close();
}

export function readInitialData(file: string, world: World) {
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    db.exec('BEGIN');
    const check = db.prepare('PRAGMA quick_check').get();
    if (check?.quick_check !== 'ok') throw new Error('initial.sqlite 校验失败');
    const data = readResourceData(db, world);
    db.exec('COMMIT');
    return data;
  } finally { db.close(); }
}
