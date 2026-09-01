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
import os from 'node:os';
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

const IS_WINDOWS = process.platform === 'win32';

function skip(reason) {
  // `reason` is one of the static strings in this file — never a path or a secret.
  // bearer:disable javascript_lang_logger_leak
  console.log(`patch-cypress-deps: skipped (${reason})`);
}

/**
 * Resolve the Cypress binary's bundled app directory, or return a skip reason.
 * node_modules/.bin/cypress is the binary the lockfile pinned; `npx cypress`
 * could fall back to fetching an unpinned one from the registry.
 */
function locateCypressApp() {
  if (process.env.NODE_ENV === 'production' || process.env.CYPRESS_INSTALL_BINARY === '0') {
    return { reason: 'no Cypress binary in this environment' };
  }
  const cypressPkgPath = path.resolve('node_modules/cypress/package.json');
  if (!fs.existsSync(cypressPkgPath)) return { reason: 'cypress is not installed' };
  const { version } = JSON.parse(fs.readFileSync(cypressPkgPath, 'utf8'));

  const cypressBin = path.resolve('node_modules/.bin', IS_WINDOWS ? 'cypress.cmd' : 'cypress');
  if (!fs.existsSync(cypressBin)) return { reason: 'cypress launcher missing' };
  const cachePath = execFileSync(cypressBin, ['cache', 'path'], { encoding: 'utf8' }).trim();
  const appPath = path.join(cachePath, version, 'Cypress', 'resources', 'app');
  if (!fs.existsSync(appPath)) return { reason: 'no Cypress binary in the cache' };
  return { appPath };
}

/** Where each pinned package lives inside the Cypress app; two are nested. */
function bundledPackageDirs(appModules) {
  return {
    'engine.io': path.join(appModules, '@packages', 'socket', 'node_modules', 'socket.io', 'node_modules', 'engine.io'),
    axios: path.join(appModules, '@packages', 'server', 'node_modules', 'axios'),
  };
}

function bundledDir(appModules, nested, name) {
  // Every path here is rooted in the lockfile-pinned Cypress launcher's own
  // cache directory and `name` is a key of PINNED above; nothing from a
  // request or the network reaches it.
  // bearer:disable javascript_lang_path_traversal
  return nested[name] ?? path.join(appModules, name);
}

/** The pinned packages the Cypress app actually bundles. */
function selectWanted(appModules, nested) {
  return new Set(
    Object.keys(PINNED).filter((name) => {
      if (name === 'esbuild') {
        return fs.existsSync(path.join(appModules, 'esbuild')) || fs.existsSync(path.join(appModules, '@esbuild'));
      }
      return fs.existsSync(bundledDir(appModules, nested, name));
    }),
  );
}

/** Idempotence: a cached binary patched on an earlier run already carries the pins. */
function alreadyPinned(appModules, nested, wanted) {
  return [...wanted].every((name) => {
    // bearer:disable javascript_lang_path_traversal
    const pkg = path.join(bundledDir(appModules, nested, name), 'package.json');
    if (!fs.existsSync(pkg)) return false;
    // bearer:disable javascript_lang_path_traversal
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version === PINNED[name];
  });
}

/** npm-install the pinned versions into a staging dir; returns its node_modules. */
function stagePinned(tempDir, specs) {
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'temp', private: true }));
  execFileSync(IS_WINDOWS ? 'npm.cmd' : 'npm', [
    'install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock', '--save-exact', ...specs,
  ], { cwd: tempDir, stdio: 'inherit' });
  return path.join(tempDir, 'node_modules');
}

/**
 * Copy one package as a plain directory: no `.bin`, no symlinks, and the
 * destination replaced whole so nothing stale survives underneath.
 */
function overlayPackage(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, filter: (entry) => path.basename(entry) !== '.bin' });
}

/** Overlay every staged package (pins + their transitive deps) onto the app. */
function overlayTopLevel(sourceDir, appModules) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (!entry.name.startsWith('@')) {
      overlayPackage(path.join(sourceDir, entry.name), path.join(appModules, entry.name));
      continue;
    }
    for (const scoped of fs.readdirSync(path.join(sourceDir, entry.name), { withFileTypes: true })) {
      if (!scoped.isDirectory()) continue;
      overlayPackage(path.join(sourceDir, entry.name, scoped.name), path.join(appModules, entry.name, scoped.name));
    }
  }
}

/** engine.io (and the ws it bundles) and axios live in nested trees the top-level overlay does not reach. */
function overlayNested(sourceDir, appModules, nested, wanted) {
  if (wanted.has('engine.io')) {
    overlayPackage(path.join(sourceDir, 'engine.io'), nested['engine.io']);
    if (wanted.has('ws')) {
      overlayPackage(path.join(sourceDir, 'ws'), path.join(nested['engine.io'], 'node_modules', 'ws'));
    }
  }
  const altEngineIoModules = path.join(appModules, 'engine.io', 'node_modules');
  if (wanted.has('ws') && fs.existsSync(altEngineIoModules)) {
    overlayPackage(path.join(sourceDir, 'ws'), path.join(altEngineIoModules, 'ws'));
  }
  if (wanted.has('axios')) {
    overlayPackage(path.join(sourceDir, 'axios'), nested.axios);
  }
}

function main() {
  const located = locateCypressApp();
  if (located.reason) return skip(located.reason);
  const { appPath } = located;
  const appModules = path.join(appPath, 'node_modules');
  const nested = bundledPackageDirs(appModules);

  const wanted = selectWanted(appModules, nested);
  if (wanted.size === 0) return skip('nothing to patch');
  if (alreadyPinned(appModules, nested, wanted)) return skip('already patched');

  // The Cypress cache path is worth having in the build log; it is a local
  // directory, not a credential.
  // bearer:disable javascript_lang_logger_leak
  console.log(`Patching Cypress bundled dependencies in ${appPath}`);

  // The staging dir lives OUTSIDE the Cypress tree. It used to be
  // `<app>/.temp-patch-deps`, and a blanket copy of its node_modules dragged
  // npm's `.bin/*` symlinks along, rewritten to point INTO that staging path;
  // once the staging dir was deleted and the (cached) binary reused on the next
  // run, cpSync met a dest symlink resolving to its own source and threw
  // ERR_FS_CP_EINVAL — a failure the old script silently swallowed, so the CI
  // cache was never actually patched.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cypress-patch-deps-'));
  try {
    const specs = [...wanted].map((name) => `${name}@${PINNED[name]}`);
    const sourceDir = stagePinned(tempDir, specs);
    overlayTopLevel(sourceDir, appModules);
    overlayNested(sourceDir, appModules, nested, wanted);
    // `specs` are the pinned name@version strings above — static data.
    // bearer:disable javascript_lang_logger_leak
    console.log(`Patched ${specs.join(', ')} in the Cypress cache`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  // The error is an npm/fs failure from a build-time script with no request
  // or credential in scope; the stack is what a CI log needs to debug it.
  if (process.env.CI) {
    // bearer:disable javascript_lang_logger_leak
    console.error('patch-cypress-deps: failed', err);
    process.exit(1);
  }
  // bearer:disable javascript_lang_logger_leak
  console.warn(`patch-cypress-deps: failed, continuing (${err instanceof Error ? err.message : String(err)})`);
}
