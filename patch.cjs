const fs = require('fs');

const path = 'client/src/components/timeline/__tests__/TimelineFilters.test.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldCode = `    const mockCreateObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const mockRevokeObjectURL = vi.fn();

    vi.stubGlobal("URL", { ...global.URL, createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });`;

const newCode = `    window.URL.createObjectURL = vi.fn();
    window.URL.revokeObjectURL = vi.fn();
    const mockCreateObjectURL = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue("blob:mock-url");
    const mockRevokeObjectURL = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});`;

content = content.replace(oldCode, newCode);
fs.writeFileSync(path, content);
