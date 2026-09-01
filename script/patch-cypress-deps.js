/**
 * Postinstall: overlay newer versions of a few vulnerable packages bundled
 * INSIDE the Cypress binary (its resources/app/node_modules), so dependency
 * scanners that walk the Cypress cache stop flagging them.
 *
 * Only relevant where the Cypress binary exists — a dev checkout or the
 * Cypress CI job. Anywhere else (a production build, CYPRESS_INSTALL_BINARY=0,
 * no cache dir) it exits early and does nothing. Versions are pinned exactly:
 * a caret range here used to resolve to whatever the registry served that day,
 * so two runs could patch two different trees.
 *
 * Failures are fatal under CI (the job that runs this wants to know) and a
 * warning otherwise (a developer's `pnpm install` must never be blocked by a
 * cosmetic overlay).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PINNED = {
  'simple-git': '3.32.3',
  'serialize-javascript': '7.0.3',
  'engine.io': '5.2.1',
  flatted: '3.4.0',
  ws: '8.17.1',
  axios: '1.7.4',
  esbuild: '0.25.12',
};

function skip(reason) {
  console.log(`patch-cypress-deps: skipped (${reason})`);
}

function main() {
  if (process.env.NODE_ENV === 'production' || process.env.CYPRESS_INSTALL_BINARY === '0') {
    return skip('no Cypress binary in this environment');
  }
  const cypressPkgPath = path.resolve('node_modules/cypress/package.json');
  if (!fs.existsSync(cypressPkgPath)) return skip('cypress is not installed');
  const { version } = JSON.parse(fs.readFileSync(cypressPkgPath, 'utf8'));

  // node_modules/.bin/cypress is the binary the lockfile pinned; `npx cypress`
  // could fall back to fetching an unpinned one from the registry.
  const cypressBin = path.resolve('node_modules/.bin', process.platform === 'win32' ? 'cypress.cmd' : 'cypress');
  if (!fs.existsSync(cypressBin)) return skip('cypress launcher missing');
  const cachePath = execFileSync(cypressBin, ['cache', 'path'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
  const appPath = path.join(cachePath, version, 'Cypress', 'resources', 'app');
  if (!fs.existsSync(appPath)) return skip(`no Cypress ${version} binary in ${cachePath}`);

  const appModules = path.join(appPath, 'node_modules');
  const engineIoPath = path.join(appModules, '@packages', 'socket', 'node_modules', 'socket.io', 'node_modules', 'engine.io');
  const nestedAxiosPath = path.join(appModules, '@packages', 'server', 'node_modules', 'axios');
  const present = (name) => fs.existsSync(path.join(appModules, name));

  const wanted = Object.keys(PINNED).filter((name) => {
    if (name === 'engine.io') return fs.existsSync(engineIoPath);
    if (name === 'axios') return fs.existsSync(nestedAxiosPath);
    if (name === 'esbuild') return present('esbuild') || present('@esbuild');
    return present(name);
  });
  if (wanted.length === 0) return skip('nothing to patch');

  // Idempotence: a cached binary that was patched on an earlier run already
  // carries the pinned versions, so don't re-download them.
  const alreadyPinned = wanted.every((name) => {
    const dir = name === 'engine.io' ? engineIoPath : name === 'axios' ? nestedAxiosPath : path.join(appModules, name);
    const pkg = path.join(dir, 'package.json');
    if (!fs.existsSync(pkg)) return false;
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version === PINNED[name];
  });
  if (alreadyPinned) return skip('already patched');

  console.log(`Patching Cypress bundled dependencies in ${appPath}`);
  const tempDir = path.join(appPath, '.temp-patch-deps');
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'temp', private: true }));
    const specs = wanted.map((name) => `${name}@${PINNED[name]}`);
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock', '--save-exact', ...specs,
    ], { cwd: tempDir, stdio: 'inherit', shell: process.platform === 'win32' });

    const sourceDir = path.join(tempDir, 'node_modules');
    fs.cpSync(sourceDir, appModules, { recursive: true });

    // engine.io (and the ws it bundles) and axios live in nested trees that the
    // top-level overlay above does not reach.
    if (wanted.includes('engine.io')) {
      fs.cpSync(path.join(sourceDir, 'engine.io'), engineIoPath, { recursive: true });
      if (wanted.includes('ws')) {
        fs.cpSync(path.join(sourceDir, 'ws'), path.join(engineIoPath, 'node_modules', 'ws'), { recursive: true });
      }
    }
    const altEngineIoWs = path.join(appModules, 'engine.io', 'node_modules');
    if (wanted.includes('ws') && fs.existsSync(altEngineIoWs)) {
      fs.cpSync(path.join(sourceDir, 'ws'), path.join(altEngineIoWs, 'ws'), { recursive: true });
    }
    if (wanted.includes('axios')) {
      fs.cpSync(path.join(sourceDir, 'axios'), nestedAxiosPath, { recursive: true });
    }
    console.log(`Patched ${specs.join(', ')} in the Cypress cache`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  if (process.env.CI) {
    console.error('patch-cypress-deps: failed', err);
    process.exit(1);
  }
  console.warn(`patch-cypress-deps: failed, continuing (${err instanceof Error ? err.message : String(err)})`);
}
