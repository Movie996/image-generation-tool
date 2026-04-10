/**
 * Launcher - starts server as a background daemon process
 * Runs hidden, survives parent process exit.
 */

import { spawn, exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;

let serverProcess = null;

const color = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function log(msg) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`${color.dim(`[${time}]`)} ${msg}`);
}

// Write PID file so stop.bat can find us
function writePidFile() {
  const pidPath = path.join(PROJECT_ROOT, '.server.pid');
  fs.writeFileSync(pidPath, process.pid.toString());
}

function startServer() {
  return new Promise((resolve, reject) => {
    log(color.cyan('Starting server...'));

    serverProcess = spawn('node', ['--env-file=.env', 'server/app.js'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,   // KEY: detach from parent
      windowsHide: true,
    });

    // Unref so parent can exit without killing this
    serverProcess.unref();

    let started = false;

    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      for (const line of text.trim().split('\n')) {
        if (line.trim()) console.log(`  ${line}`);
      }
      if (!started) {
        started = true;
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const text = data.toString();
      for (const line of text.trim().split('\n')) {
        if (line.trim()) console.log(`  ${color.red(line)}`);
      }
    });

    serverProcess.on('exit', (code) => {
      log(color.red(`Server exited with code: ${code}`));
      serverProcess = null;
    });

    serverProcess.on('error', (err) => {
      log(color.red(`Failed to start: ${err.message}`));
      reject(err);
    });

    setTimeout(() => {
      if (!started) resolve();
    }, 5000);
  });
}

function openBrowser() {
  const cmd = process.platform === 'win32'
    ? `start "" "${URL}"`
    : process.platform === 'darwin'
      ? `open "${URL}"`
      : `xdg-open "${URL}"`;

  exec(cmd);
}

async function main() {
  console.clear();
  console.log('');
  console.log('======================================');
  console.log('  Image Tool - Background Mode');
  console.log(`  URL: ${URL}`);
  console.log('======================================');
  console.log('');

  try {
    await startServer();
    log(color.green('[OK] Server is running'));
    writePidFile();

    // Keep this process alive to manage the child
    log(color.dim('Running... close this window or run stop.bat to exit'));
    log('');

    setInterval(() => {
      // Heartbeat: check if server is still alive
      if (serverProcess && serverProcess.exitCode !== null) {
        log(color.yellow('Server died, restarting...'));
        startServer().catch(() => {});
      }
    }, 10000);

  } catch (err) {
    log(color.red(`Startup failed: ${err.message}`));
    process.exit(1);
  }
}

function shutdown(signal) {
  log(color.yellow(`Received ${signal}, shutting down...`));
  
  // Clean up PID file
  try {
    const pidPath = path.join(PROJECT_ROOT, '.server.pid');
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
  } catch (_) {}

  if (serverProcess) {
    if (process.platform === 'win32') {
      exec(`taskkill /PID ${serverProcess.pid} /T /F`, () => {});
    } else {
      serverProcess.kill('SIGTERM');
    }
  }
  
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main();
