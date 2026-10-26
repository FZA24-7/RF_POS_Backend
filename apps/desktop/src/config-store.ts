import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_SERVER_URL, normalizeServerUrl } from './policy';

export interface DesktopConfig {
  serverUrl: string;
}

/** Reads the saved server address; falls back to the default when the file is missing, unreadable or invalid. */
export const loadConfig = (file: string): DesktopConfig => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const candidate =
      typeof parsed === 'object' && parsed !== null && 'serverUrl' in parsed
        ? (parsed as { serverUrl: unknown }).serverUrl
        : undefined;
    if (typeof candidate === 'string') {
      const r = normalizeServerUrl(candidate);
      if (r.ok) return { serverUrl: r.value };
    }
  } catch {
    // missing or corrupt file: use the default
  }
  return { serverUrl: DEFAULT_SERVER_URL };
};

/** Writes the config atomically (temp file + rename) so a crash cannot leave a half-written file. */
export const saveConfig = (file: string, config: DesktopConfig): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, file);
};
