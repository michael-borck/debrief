// Spawn lens/speech-analyser as a child sidecar.
// First launch: bundled python-build-standalone runs setup-venv.py to create
// ~/Library/Application Support/debrief/venv/ with speech-analyser + deps
// installed via pip. Subsequent launches spawn server.py from that venv.

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

function resolvePaths() {
  const userVenv = path.join(app.getPath('userData'), 'venv');
  const winExt = process.platform === 'win32';
  const baseDir = app.isPackaged
    ? path.join(process.resourcesPath, 'embedded-server')
    : path.join(__dirname, '..', '..', 'embedded-server');
  return {
    baseDir,
    bundledPython: path.join(baseDir, 'python', winExt ? 'Scripts/python.exe' : 'bin/python3'),
    serverScript: path.join(baseDir, 'server.py'),
    setupScript: path.join(baseDir, 'setup-venv.py'),
    userVenv,
    userVenvPython: path.join(userVenv, winExt ? 'Scripts/python.exe' : 'bin/python'),
  };
}

class SidecarManager {
  constructor() {
    this.proc = null;
    this.setupProc = null;
    this.port = null;
    this.state = 'stopped'; // stopped | setting_up | starting | ready | failed
    this.lastError = null;
    this.setupSteps = [];
    this._shuttingDown = false;
    this._restartAttempt = 0;
  }

  getStatus() {
    return {
      state: this.state,
      port: this.port,
      lastError: this.lastError,
      setupSteps: this.setupSteps.slice(),
    };
  }

  async start() {
    if (['ready', 'starting', 'setting_up'].includes(this.state)) {
      return this.getStatus();
    }
    this._shuttingDown = false;
    this.lastError = null;

    const paths = resolvePaths();

    if (!fs.existsSync(paths.bundledPython)) {
      this.state = 'failed';
      this.lastError = `Bundled Python missing at ${paths.bundledPython}. Run npm run build:sidecar.`;
      console.error(`[sidecar] ${this.lastError}`);
      return this.getStatus();
    }

    if (!fs.existsSync(paths.userVenvPython)) {
      const ok = await this._runSetup(paths);
      if (!ok) {
        this.state = 'failed';
        return this.getStatus();
      }
    }

    return this._spawnServer(paths);
  }

  // First-launch venv creation. Streams STEP: lines from setup-venv.py into
  // setupSteps so the renderer (polling getStatus) can render progress.
  _runSetup(paths) {
    return new Promise((resolve) => {
      this.state = 'setting_up';
      this.setupSteps = [];
      console.log('[sidecar] running first-launch setup');

      this.setupProc = spawn(paths.bundledPython, [paths.setupScript], {
        env: { ...process.env, DEBRIEF_VENV: paths.userVenv },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';
      const handleLine = (raw) => {
        const line = raw.trim();
        if (!line) return;
        if (line.startsWith('STEP: ')) {
          const step = line.slice(6);
          this.setupSteps.push(step);
          console.log(`[sidecar setup] ${step}`);
        } else if (line.startsWith('ERROR: ')) {
          this.lastError = line.slice(7);
          console.error(`[sidecar setup] ${line}`);
        } else {
          console.log(`[sidecar setup] ${line}`);
        }
      };

      this.setupProc.stdout.on('data', (d) => {
        buffer += d.toString();
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          handleLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      });
      this.setupProc.stderr.on('data', (d) => console.error(`[sidecar setup err] ${d.toString().trim()}`));

      this.setupProc.on('error', (err) => {
        this.lastError = `Setup spawn failed: ${err.message}`;
        console.error('[sidecar]', this.lastError);
        this.setupProc = null;
        resolve(false);
      });

      this.setupProc.on('exit', (code, signal) => {
        if (buffer) handleLine(buffer);
        this.setupProc = null;
        if (this._shuttingDown) {
          resolve(false);
          return;
        }
        if (code === 0) {
          console.log('[sidecar setup] complete');
          resolve(true);
        } else {
          this.lastError = this.lastError || `Setup exited with code ${code} (signal=${signal})`;
          console.error(`[sidecar setup] failed: ${this.lastError}`);
          resolve(false);
        }
      });
    });
  }

  async _spawnServer(paths) {
    this.state = 'starting';
    this.port = await findAvailablePort(8765);
    const env = { ...process.env, HOST: '127.0.0.1', PORT: String(this.port) };
    console.log(`[sidecar] spawning server.py via user-data venv on port ${this.port}`);

    this.proc = spawn(paths.userVenvPython, [paths.serverScript], {
      env,
      cwd: paths.baseDir,
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
    if (this.setupProc) {
      try { this.setupProc.kill('SIGTERM'); } catch (_) {}
    }
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
