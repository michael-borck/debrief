// Spawn lens/speech-analyser as a child sidecar, monitor /healthz, restart on crash.

const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const READY_TIMEOUT_MS = 30000;
const HEALTHZ_POLL_INTERVAL_MS = 250;
const RESTART_BACKOFF_MS = [1000, 2000, 5000, 30000];

function findAvailablePort(startPort = 8765) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findAvailablePort(startPort + 1)));
  });
}

function resolveLaunch() {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binPath = path.join(process.resourcesPath, 'embedded-server', `embedded-server${ext}`);
    return { mode: 'binary', cmd: binPath, args: [], cwd: undefined };
  }
  const root = path.join(__dirname, '..', '..', 'embedded-server');
  const venvPython = process.platform === 'win32'
    ? path.join(root, 'venv', 'Scripts', 'python.exe')
    : path.join(root, 'venv', 'bin', 'python');
  const serverPy = path.join(root, 'server.py');
  return { mode: 'venv', cmd: venvPython, args: [serverPy], cwd: root };
}

class SidecarManager {
  constructor() {
    this.proc = null;
    this.port = null;
    this.state = 'stopped';
    this.lastError = null;
    this._shuttingDown = false;
    this._restartAttempt = 0;
  }

  getStatus() {
    return { state: this.state, port: this.port, lastError: this.lastError };
  }

  async start() {
    if (this.state === 'ready' || this.state === 'starting') {
      return this.getStatus();
    }
    this._shuttingDown = false;
    this.state = 'starting';
    this.lastError = null;

    const resolved = resolveLaunch();
    if (!fs.existsSync(resolved.cmd)) {
      this.state = 'failed';
      this.lastError = resolved.mode === 'venv'
        ? `Sidecar venv missing at ${resolved.cmd}. Bootstrap with: python3 -m venv embedded-server/venv && embedded-server/venv/bin/pip install -r embedded-server/requirements.txt`
        : `Sidecar binary missing at ${resolved.cmd}`;
      console.error(`[sidecar] ${this.lastError}`);
      return this.getStatus();
    }

    this.port = await findAvailablePort(8765);
    const env = { ...process.env, HOST: '127.0.0.1', PORT: String(this.port) };
    console.log(`[sidecar] spawning (${resolved.mode}) on port ${this.port}`);

    this.proc = spawn(resolved.cmd, resolved.args, {
      env,
      cwd: resolved.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (d) => console.log(`[sidecar] ${d.toString().trim()}`));
    this.proc.stderr.on('data', (d) => console.error(`[sidecar] ${d.toString().trim()}`));

    this.proc.on('error', (err) => {
      console.error('[sidecar] spawn error:', err);
      this.lastError = err.message;
      this.state = 'failed';
      this.proc = null;
    });

    this.proc.on('exit', (code, signal) => {
      console.log(`[sidecar] exited code=${code} signal=${signal}`);
      this.proc = null;
      // Distinguish a deliberate stop (don't restart) from a crash.
      if (this._shuttingDown) {
        this.state = 'stopped';
        return;
      }
      this._scheduleRestart();
    });

    const ready = await this._waitForHealthz();
    if (ready) {
      this.state = 'ready';
      this._restartAttempt = 0;
      console.log(`[sidecar] ready on http://127.0.0.1:${this.port}`);
    } else {
      this.state = 'failed';
      this.lastError = `Sidecar did not respond to /healthz within ${READY_TIMEOUT_MS}ms`;
      console.error(`[sidecar] ${this.lastError}`);
      this._kill();
    }
    return this.getStatus();
  }

  async stop() {
    this._shuttingDown = true;
    await this._kill();
    this.state = 'stopped';
  }

  async restart() {
    await this.stop();
    this._shuttingDown = false;
    this._restartAttempt = 0;
    return this.start();
  }

  // Resolves only when the child has actually exited — callers can rely
  // on this to gate Electron shutdown so we don't leak the Python process.
  _kill() {
    if (!this.proc) return Promise.resolve();
    const p = this.proc;
    return new Promise((resolve) => {
      let killTimer = null;
      const finish = () => { clearTimeout(killTimer); resolve(); };
      p.once('exit', finish);
      try {
        p.kill('SIGTERM');
        // SIGKILL fallback — uvicorn occasionally ignores SIGTERM during model load.
        killTimer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} }, 3000);
      } catch (err) {
        console.error('[sidecar] kill error:', err);
        finish();
      }
    });
  }

  _scheduleRestart() {
    const attempt = this._restartAttempt;
    if (attempt >= RESTART_BACKOFF_MS.length) {
      this.state = 'failed';
      this.lastError = `Sidecar crashed ${attempt} times; giving up. Call sidecar.restart() to retry.`;
      console.error(`[sidecar] ${this.lastError}`);
      return;
    }
    const delay = RESTART_BACKOFF_MS[attempt];
    this._restartAttempt += 1;
    console.log(`[sidecar] restart attempt ${attempt + 1} in ${delay}ms`);
    setTimeout(() => {
      if (this._shuttingDown) return;
      this.start();
    }, delay);
  }

  async _waitForHealthz() {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    const url = `http://127.0.0.1:${this.port}/healthz`;
    while (Date.now() < deadline) {
      if (!this.proc) return false;
      try {
        const res = await fetch(url);
        if (res.ok) return true;
      } catch (_) {
        // not bound yet
      }
      await new Promise((r) => setTimeout(r, HEALTHZ_POLL_INTERVAL_MS));
    }
    return false;
  }
}

module.exports = { SidecarManager };
