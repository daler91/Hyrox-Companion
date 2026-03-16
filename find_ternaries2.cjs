const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            if (!file.includes('node_modules') && !file.includes('.git') && !file.includes('dist') && !file.includes('build') && !file.includes('coverage')) {
                results = results.concat(walk(file));
            }
        } else {
            if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk('.');
for (const file of files) {
    if (file.includes('node_modules') || file.includes('coverage') || file.includes('dist')) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
        // Find nested ternaries spanning multiple lines by counting ? and :
        // This is tricky, let's just grep for the specific pattern `\?.*\?.*:.*:` or similar
        // Let's actually look for lines that have a single ? but are followed by another ? before a ; or new assignment
    });
}
