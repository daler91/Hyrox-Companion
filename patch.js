const fs = require('fs');

let content = fs.readFileSync('client/src/hooks/__tests__/usePlanImport.test.tsx', 'utf-8');

content = content.replace("value: 'C:\\\\fakepath\\\\test.txt'", "value: 'test.txt'");
content = content.replace("value: 'C:\\\\fakepath\\\\plan.csv'", "value: 'plan.csv'");

content = content.replace(/const originalFileReader = global\.FileReader;\s+global\.FileReader = vi\.fn\(\(\) => mockFileReader\) as any;/g, "vi.stubGlobal('FileReader', vi.fn(() => mockFileReader));");
content = content.replace(/global\.FileReader = originalFileReader;/g, "vi.unstubAllGlobals();");

// Replace the mockFileReader 'this: any' and 'as any' as well
content = content.replace(/function\(this: any\)/g, "function(this: { onload: (event: unknown) => void })");
content = content.replace(/this\.onload\(\{ target: \{ result: csvContent \} \} as any\);/g, "this.onload({ target: { result: csvContent } });");

fs.writeFileSync('client/src/hooks/__tests__/usePlanImport.test.tsx', content);
