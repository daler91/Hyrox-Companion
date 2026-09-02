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

/**
 * The directories this run works in, resolved once by main(). Every path is
 * rooted in the lockfile-pinned Cypress launcher's own cache directory (or a
 * fresh temp dir); nothing from a request or the network reaches them. Held
 * here rather than threaded through parameters so the helpers below stay
 * small and read the layout directly.
 */
const layout = {
  appPath: '',
  appModules: '',
  /** The two pinned packages that live in nested trees inside the app. */
  nested: { 'engine.io': '', axios: '' },
  /** The staging install: a fresh temp dir and, once stagePinned() has run, its node_modules. */
  tempDir: '',
  sourceDir: '',
};

// The three helpers below take a package NAME (always a key of PINNED, or a
// directory name read from the staging install) and join it onto a directory
// from `layout`. Bearer reads any function parameter as dynamic input; these
// never carry request or network data, so the joins are suppressed here with
// that justification rather than threaded through more module state.

function skip(reason) {
  // `reason` is one of the static strings in this file — never a path or a secret.
  // bearer:disable javascript_lang_logger_leak
  console.log(`patch-cypress-deps: skipped (${reason})`);
}

/**
 * Resolve the Cypress binary's bundled app directory into `layout`, or return
 * a skip reason. node_modules/.bin/cypress is the binary the lockfile pinned;
 * `npx cypress` could fall back to fetching an unpinned one from the registry.
 */
function locateCypressApp() {
  if (process.env.NODE_ENV === 'production' || process.env.CYPRESS_INSTALL_BINARY === '0') {
    return 'no Cypress binary in this environment';
  }
  const cypressPkgPath = path.resolve('node_modules/cypress/package.json');
  if (!fs.existsSync(cypressPkgPath)) return 'cypress is not installed';
  const { version } = JSON.parse(fs.readFileSync(cypressPkgPath, 'utf8'));

  const cypressBin = path.resolve('node_modules/.bin', IS_WINDOWS ? 'cypress.cmd' : 'cypress');
  if (!fs.existsSync(cypressBin)) return 'cypress launcher missing';
  const cachePath = execFileSync(cypressBin, ['cache', 'path'], { encoding: 'utf8' }).trim();
  const appPath = path.join(cachePath, version, 'Cypress', 'resources', 'app');
  if (!fs.existsSync(appPath)) return 'no Cypress binary in the cache';

  const appModules = path.join(appPath, 'node_modules');
  layout.appPath = appPath;
  layout.appModules = appModules;
  layout.nested['engine.io'] = path.join(appModules, '@packages', 'socket', 'node_modules', 'socket.io', 'node_modules', 'engine.io');
  layout.nested.axios = path.join(appModules, '@packages', 'server', 'node_modules', 'axios');
  return null;
}

/** Where a pinned package lives inside the Cypress app. */
function bundledDir(name) {
  // bearer:disable javascript_lang_path_traversal
  return layout.nested[name] ?? path.join(layout.appModules, name);
}

/** The pinned packages the Cypress app actually bundles. */
function selectWanted() {
  return new Set(
    Object.keys(PINNED).filter((name) => {
      if (name === 'esbuild') {
        return fs.existsSync(path.join(layout.appModules, 'esbuild')) || fs.existsSync(path.join(layout.appModules, '@esbuild'));
      }
      return fs.existsSync(bundledDir(name));
    }),
  );
}

/** Idempotence: a cached binary patched on an earlier run already carries the pins. */
function alreadyPinned(wanted) {
  return [...wanted].every((name) => {
    // bearer:disable javascript_lang_path_traversal
    const pkg = path.join(bundledDir(name), 'package.json');
    if (!fs.existsSync(pkg)) return false;
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version === PINNED[name];
  });
}

/** npm-install the pinned versions into the staging dir; records its node_modules in `layout`. */
function stagePinned(specs) {
  fs.writeFileSync(path.join(layout.tempDir, 'package.json'), JSON.stringify({ name: 'temp', private: true }));
  execFileSync(IS_WINDOWS ? 'npm.cmd' : 'npm', [
    'install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock', '--save-exact', ...specs,
  ], { cwd: layout.tempDir, stdio: 'inherit' });
  layout.sourceDir = path.join(layout.tempDir, 'node_modules');
}

/**
 * Copy one staged package onto the app as a plain directory: no `.bin`, no
 * symlinks, and the destination replaced whole so nothing stale survives
 * underneath. `from` is relative to the staging node_modules, `to` absolute.
 */
function overlayPackage(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  // bearer:disable javascript_lang_path_traversal
  fs.cpSync(path.join(layout.sourceDir, from), to, {
    recursive: true,
    filter: (entry) => path.basename(entry) !== '.bin',
  });
}

/** Overlay every staged package (pins + their transitive deps) onto the app. */
function overlayTopLevel() {
  for (const entry of fs.readdirSync(layout.sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (!entry.name.startsWith('@')) {
      overlayPackage(entry.name, path.join(layout.appModules, entry.name));
      continue;
    }
    const scopeDir = path.join(layout.sourceDir, entry.name);
    for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
      if (!scoped.isDirectory()) continue;
      overlayPackage(path.join(entry.name, scoped.name), path.join(layout.appModules, entry.name, scoped.name));
    }
  }
}

/** engine.io (and the ws it bundles) and axios live in nested trees the top-level overlay does not reach. */
function overlayNested(wanted) {
  if (wanted.has('engine.io')) {
    overlayPackage('engine.io', layout.nested['engine.io']);
    if (wanted.has('ws')) {
      overlayPackage('ws', path.join(layout.nested['engine.io'], 'node_modules', 'ws'));
    }
  }
  const altEngineIoModules = path.join(layout.appModules, 'engine.io', 'node_modules');
  if (wanted.has('ws') && fs.existsSync(altEngineIoModules)) {
    overlayPackage('ws', path.join(altEngineIoModules, 'ws'));
  }
  if (wanted.has('axios')) {
    overlayPackage('axios', layout.nested.axios);
  }
}

function main() {
  const skipReason = locateCypressApp();
  if (skipReason) return skip(skipReason);

  const wanted = selectWanted();
  if (wanted.size === 0) return skip('nothing to patch');
  if (alreadyPinned(wanted)) return skip('already patched');

  // The Cypress cache path is worth having in the build log; it is a local
  // directory, not a credential.
  // bearer:disable javascript_lang_logger_leak
  console.log(`Patching Cypress bundled dependencies in ${layout.appPath}`);

  // The staging dir lives OUTSIDE the Cypress tree. It used to be
  // `<app>/.temp-patch-deps`, and a blanket copy of its node_modules dragged
  // npm's `.bin/*` symlinks along, rewritten to point INTO that staging path;
  // once the staging dir was deleted and the (cached) binary reused on the next
  // run, cpSync met a dest symlink resolving to its own source and threw
  // ERR_FS_CP_EINVAL — a failure the old script silently swallowed, so the CI
  // cache was never actually patched.
  layout.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cypress-patch-deps-'));
  try {
    const specs = [...wanted].map((name) => `${name}@${PINNED[name]}`);
    stagePinned(specs);
    overlayTopLevel();
    overlayNested(wanted);
    // `specs` are the pinned name@version strings above — static data.
    // bearer:disable javascript_lang_logger_leak
    console.log(`Patched ${specs.join(', ')} in the Cypress cache`);
  } finally {
    fs.rmSync(layout.tempDir, { recursive: true, force: true });
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
