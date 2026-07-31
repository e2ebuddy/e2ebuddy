import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import path from 'node:path';

export type UserDataLayout = {
  root: string;
  config: string;
  storage: string;
  branding: string;
  reports: string;
  screenshots: string;
  recordings: string;
  db: string;
  configFile: string;
  secretsFile: string;
};

/** Resolve the platform-native user data root for e2ebuddy. */
export function resolveUserDataRoot(override?: string): string {
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  const fromEnv = process.env.E2EBUDDY_DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'e2ebuddy');
    case 'win32':
      return path.join(
        process.env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming'),
        'e2ebuddy',
      );
    default:
      return path.join(
        process.env.XDG_DATA_HOME?.trim() || path.join(home, '.local', 'share'),
        'e2ebuddy',
      );
  }
}

export function resolveUserDataLayout(override?: string): UserDataLayout {
  const root = resolveUserDataRoot(override);
  return {
    root,
    config: path.join(root, 'config'),
    storage: path.join(root, 'storage'),
    branding: path.join(root, 'branding'),
    reports: path.join(root, 'reports'),
    screenshots: path.join(root, 'screenshots'),
    recordings: path.join(root, 'recordings'),
    db: path.join(root, 'db'),
    configFile: path.join(root, 'config', 'settings.json'),
    secretsFile: path.join(root, 'config', 'secrets.json'),
  };
}

/** Create all user-data directories (idempotent). */
export async function ensureUserDataDirectories(
  layout: UserDataLayout = resolveUserDataLayout(),
): Promise<UserDataLayout> {
  const directories = [
    layout.root,
    layout.config,
    layout.storage,
    layout.branding,
    layout.reports,
    layout.screenshots,
    layout.recordings,
    layout.db,
  ];
  for (const directory of directories) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  return layout;
}

export async function isWritableDirectory(directory: string): Promise<boolean> {
  try {
    await mkdir(directory, { recursive: true });
    const probe = path.join(directory, `.write-probe-${process.pid}`);
    await writeFile(probe, 'ok', { flag: 'w' });
    await unlink(probe).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
