const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

try {
  const cachePath = execSync('npx cypress cache path', { encoding: 'utf8' }).trim();
  const version = '15.12.0';
  const appPath = path.join(cachePath, version, 'Cypress', 'resources', 'app');

  if (fs.existsSync(appPath)) {
    console.log(`Patching simple-git in ${appPath}`);
    execSync('npm install simple-git@^3.32.3 --no-save', { cwd: appPath, stdio: 'inherit' });
    console.log('Successfully patched simple-git in Cypress cache');
  } else {
    console.log('Cypress app path not found, skipping patch');
  }
} catch (e) {
  console.log('Failed to patch Cypress: ' + e);
}
