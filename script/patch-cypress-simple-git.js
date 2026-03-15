import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

try {
  let version = '15.12.0';
  if (fs.existsSync('node_modules/cypress/package.json')) {
    const cypressPkg = JSON.parse(fs.readFileSync('node_modules/cypress/package.json', 'utf8'));
    version = cypressPkg.version;
  }
  const cachePath = execFileSync('npx', ['cypress', 'cache', 'path'], { encoding: 'utf8', shell: true }).trim();
  const appPath = path.join(cachePath, version, 'Cypress', 'resources', 'app');
  const simpleGitPath = path.join(appPath, 'node_modules', 'simple-git');

  if (fs.existsSync(appPath) && fs.existsSync(simpleGitPath)) {
    console.log(`Patching simple-git in ${appPath}`);

    const tempDir = path.join(appPath, '.temp-simple-git');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'temp' }));

    execFileSync('npm', ['install', 'simple-git@^3.32.3'], { cwd: tempDir, stdio: 'inherit', shell: true });

    const sourceDir = path.join(tempDir, 'node_modules');
    if (fs.existsSync(sourceDir)) {
      // copy everything in the temp node_modules to the app node_modules
      fs.cpSync(sourceDir, path.join(appPath, 'node_modules'), { recursive: true });
      console.log('Successfully patched simple-git in Cypress cache');
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  } else {
    console.log('Cypress simple-git path not found, skipping patch');
  }
} catch (e) {
  console.log('Failed to patch Cypress: ' + e);
}
