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
        // Find lines with multiple standard ternaries ? and :
        // This is a naive heuristic, let's just use string counting
        const qCount = (line.match(/\?/g) || []).length;
        const qDotCount = (line.match(/\?\./g) || []).length;
        const qColonCount = (line.match(/\?:/g) || []).length;
        const qTernaryCount = qCount - qDotCount - qColonCount;

        if (qTernaryCount > 1 && !line.includes('?.') && !line.includes('?:')) {
            console.log(`${file}:${index + 1}: ${line.trim()}`);
        }
    });
}
