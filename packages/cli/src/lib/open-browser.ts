import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/** Open a URL in the default browser. Best-effort; never throws. */
export function openBrowser(url: string): void {
  const os = platform();
  try {
    if (os === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    if (os === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
      return;
    }
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Browser open is optional; the URL is always printed to stdout.
  }
}
