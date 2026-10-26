import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, saveConfig } from '../src/config-store';
import { DEFAULT_SERVER_URL } from '../src/policy';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mafk-cfg-'));

describe('config store', () => {
  it('falls back to the default when missing, corrupt or invalid', () => {
    const dir = tmp();
    const file = path.join(dir, 'config.json');
    expect(loadConfig(file).serverUrl).toBe(DEFAULT_SERVER_URL);
    fs.writeFileSync(file, '{ not json');
    expect(loadConfig(file).serverUrl).toBe(DEFAULT_SERVER_URL);
    fs.writeFileSync(file, JSON.stringify({ serverUrl: 'javascript:alert(1)' }));
    expect(loadConfig(file).serverUrl).toBe(DEFAULT_SERVER_URL);
    fs.writeFileSync(file, JSON.stringify({ serverUrl: 42 }));
    expect(loadConfig(file).serverUrl).toBe(DEFAULT_SERVER_URL);
    fs.writeFileSync(file, 'null');
    expect(loadConfig(file).serverUrl).toBe(DEFAULT_SERVER_URL);
  });

  it('round-trips a saved address, creates the folder and leaves no temp file behind', () => {
    const dir = path.join(tmp(), 'nested', 'deeper');
    const file = path.join(dir, 'config.json');
    saveConfig(file, { serverUrl: 'http://192.168.1.10:4000' });
    expect(loadConfig(file).serverUrl).toBe('http://192.168.1.10:4000');
    expect(fs.readdirSync(dir)).toEqual(['config.json']);
  });
});
