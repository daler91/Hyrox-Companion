import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

try {
  let version = '15.12.0';
  if (fs.existsSync('node_modules/cypress/package.json')) {
    const cypressPkg = JSON.parse(fs.readFileSync('node_modules/cypress/package.json', 'utf8'));
    version = cypressPkg.version;
  }

  const isWin = process.platform === 'win32';
  const npxCmd = isWin ? 'npx.cmd' : 'npx';
  const npmCmd = isWin ? 'npm.cmd' : 'npm';

  const cachePath = execFileSync(npxCmd, ['cypress', 'cache', 'path'], { encoding: 'utf8' }).trim();
  const appPath = path.join(cachePath, version, 'Cypress', 'resources', 'app');
  const simpleGitPath = path.join(appPath, 'node_modules', 'simple-git');
  const serializeJsPath = path.join(appPath, 'node_modules', 'serialize-javascript');
  const engineIoPath = path.join(appPath, 'node_modules', '@packages', 'socket', 'node_modules', 'socket.io', 'node_modules', 'engine.io');
  const flattedPath = path.join(appPath, 'node_modules', 'flatted');
  const wsPath = path.join(appPath, 'node_modules', 'ws');
  const axiosPath = path.join(appPath, 'node_modules', '@packages', 'server', 'node_modules', 'axios');

  if (fs.existsSync(appPath) && (fs.existsSync(simpleGitPath) || fs.existsSync(serializeJsPath) || fs.existsSync(engineIoPath) || fs.existsSync(flattedPath) || fs.existsSync(wsPath) || fs.existsSync(axiosPath))) {
    console.log(`Patching Cypress dependencies in ${appPath}`);

    const tempDir = path.join(appPath, '.temp-patch-deps');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'temp' }));

    const depsToInstall = [];
    if (fs.existsSync(simpleGitPath)) depsToInstall.push('simple-git@^3.32.3');
    if (fs.existsSync(serializeJsPath)) depsToInstall.push('serialize-javascript@^7.0.3');
    if (fs.existsSync(engineIoPath)) depsToInstall.push('engine.io@^5.2.1');
    if (fs.existsSync(flattedPath)) depsToInstall.push('flatted@^3.4.0');
    if (fs.existsSync(wsPath)) depsToInstall.push('ws@^7.5.10');
    if (fs.existsSync(axiosPath)) depsToInstall.push('axios@^1.7.4');

    if (depsToInstall.length > 0) {
      execFileSync(npmCmd, ['install', ...depsToInstall], { cwd: tempDir, stdio: 'inherit' });

      const sourceDir = path.join(tempDir, 'node_modules');
      if (fs.existsSync(sourceDir)) {
        if (fs.existsSync(simpleGitPath) || fs.existsSync(serializeJsPath) || fs.existsSync(flattedPath) || fs.existsSync(wsPath)) {
          fs.cpSync(sourceDir, path.join(appPath, 'node_modules'), { recursive: true });
        }

        // Copy engine.io specifically to its nested location
        if (fs.existsSync(engineIoPath)) {
          const sourceEngineIo = path.join(sourceDir, 'engine.io');
          if (fs.existsSync(sourceEngineIo)) {
             fs.cpSync(sourceEngineIo, engineIoPath, { recursive: true });
          }
        }

        // Copy axios specifically to its nested location
        if (fs.existsSync(axiosPath)) {
          const sourceAxios = path.join(sourceDir, 'axios');
          if (fs.existsSync(sourceAxios)) {
             fs.cpSync(sourceAxios, axiosPath, { recursive: true });
          }
        }

        console.log(`Successfully patched ${depsToInstall.join(', ')} in Cypress cache`);
      }
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  } else {
    console.log('Cypress dependencies path not found, skipping patch');
  }
} catch (e) {
  console.log('Failed to patch Cypress: ' + e);
}
