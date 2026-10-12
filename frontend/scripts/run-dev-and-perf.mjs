import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import process from 'node:process';

const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;
const DEV_PORT = 5173;
const PERF_PORT = 4173;

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runCommand(command, args, label, onLine) {
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', toWindowsCommand(command, args)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    : spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  pipeWithPrefix(child.stdout, process.stdout, `[${label}] `, onLine);
  pipeWithPrefix(child.stderr, process.stderr, `[${label}] `);

  return child;
}

function runBlockingCommand(command, args) {
  return process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', toWindowsCommand(command, args)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    })
    : spawnSync(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
}

function toWindowsCommand(command, args) {
  return [command, ...args].map(quoteWindowsArg).join(' ');
}

function quoteWindowsArg(value) {
  if (value.length === 0) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/g, '$1$1')}"`;
}

function pipeWithPrefix(stream, output, prefix, onLine) {
  let pending = '';

  stream.on('data', (chunk) => {
    pending += chunk.toString();

    while (true) {
      const newlineIndex = pending.indexOf('\n');
      if (newlineIndex < 0) break;

      const line = pending.slice(0, newlineIndex + 1);
      pending = pending.slice(newlineIndex + 1);
      output.write(prefix + line);
      onLine?.(stripAnsi(line).trim());
    }
  });

  stream.on('end', () => {
    if (pending.length > 0) {
      output.write(prefix + pending + '\n');
      onLine?.(stripAnsi(pending).trim());
      pending = '';
    }
  });
}

function stripAnsi(value) {
  return value.replace(ANSI_PATTERN, '');
}

function extractLocalUrl(line) {
  if (!line.includes('Local:')) {
    return null;
  }

  const match = line.match(/https?:\/\/\S+/u);
  return match ? match[0] : null;
}

function openUrl(url) {
  let child;

  if (process.platform === 'win32') {
    const escapedUrl = url.replace(/'/g, "''");
    child = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${escapedUrl}'`], {
      detached: true,
      stdio: 'ignore',
    });
  } else if (process.platform === 'darwin') {
    child = spawn('open', [url], {
      detached: true,
      stdio: 'ignore',
    });
  } else {
    child = spawn('xdg-open', [url], {
      detached: true,
      stdio: 'ignore',
    });
  }

  child.unref();
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, '127.0.0.1');
  });
}

async function assertPortsAvailable() {
  const unavailablePorts = [];

  if (!(await isPortAvailable(DEV_PORT))) {
    unavailablePorts.push(DEV_PORT);
  }

  if (!(await isPortAvailable(PERF_PORT))) {
    unavailablePorts.push(PERF_PORT);
  }

  if (unavailablePorts.length === 0) {
    return;
  }

  console.error(`[compare] port(s) already in use: ${unavailablePorts.join(', ')}`);
  console.error('[compare] close the existing dev/preview process, then rerun `npm run dev:compare`.');
  process.exit(1);
}

function terminateChild(child) {
  if (!child.pid) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    return;
  }

  child.kill('SIGTERM');
}

function printHelp() {
  console.log('Usage: npm run dev:compare -- [--skip-build] [--build] [--full-dev] [--open]');
  console.log('');
  console.log('Starts both the local dev server and the local perf preview server.');
  console.log('');
  console.log('  --skip-build  Reuse the existing perf build instead of rebuilding first');
  console.log('  --build       Force a fresh perf build before starting');
  console.log('  --full-dev    Use `npm run dev` instead of `npm run dev:quiet`');
  console.log('  --open        Open the dev/perf URLs automatically when both are ready');
}

if (hasFlag('--help') || hasFlag('-h')) {
  printHelp();
  process.exit(0);
}

const npmCommand = getNpmCommand();
const devScript = hasFlag('--full-dev') ? 'dev' : 'dev:quiet';
const skipBuild = hasFlag('--skip-build');
const forceBuild = hasFlag('--build');
const shouldOpenBrowser = hasFlag('--open');
const readyUrls = new Map();
let announcedReady = false;
const perfBundleExists = existsSync('dist/index.html');
const shouldBuild = forceBuild || (!skipBuild && !perfBundleExists);

await assertPortsAvailable();

function handleReady(label, line) {
  const url = extractLocalUrl(line);
  if (!url || readyUrls.has(label)) {
    return;
  }

  readyUrls.set(label, url);
  if (shouldOpenBrowser) {
    openUrl(url);
  }

  if (readyUrls.size === 2 && !announcedReady) {
    announcedReady = true;
    console.log('');
    console.log('[compare] both servers are ready');
    console.log(`[compare] dev  -> ${readyUrls.get('dev')}`);
    console.log(`[compare] perf -> ${readyUrls.get('perf')}`);
    console.log('[compare] press Ctrl+C once to stop both');
  }
}

if (shouldBuild) {
  console.log('[compare] building perf bundle first...');
  const buildResult = runBlockingCommand(npmCommand, ['run', 'build:perf']);

  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }

  console.log('[compare] perf bundle ready');
} else if (skipBuild) {
  console.log('[compare] reusing existing perf bundle (--skip-build)');
} else {
  console.log('[compare] reusing existing perf bundle (use --build to rebuild)');
}

console.log('[compare] starting dev and perf side-by-side');
console.log(`[compare] dev:  http://localhost:${DEV_PORT} (${devScript})`);
console.log(`[compare] perf: http://localhost:${PERF_PORT} (preview:perf)`);
if (shouldOpenBrowser) {
  console.log('[compare] browser tabs will open automatically when both are ready');
}
console.log('[compare] press Ctrl+C to stop both');

const children = [
  runCommand(npmCommand, ['run', devScript], 'dev', (line) => handleReady('dev', line)),
  runCommand(npmCommand, ['run', 'preview:perf'], 'perf', (line) => handleReady('perf', line)),
];

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    terminateChild(child);
  }

  process.exit(exitCode);
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;

    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      shutdown(0);
      return;
    }

    shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
