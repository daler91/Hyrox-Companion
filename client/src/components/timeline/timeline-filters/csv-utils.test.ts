import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CSV_TEMPLATE, downloadTemplate } from './csv-utils';

describe('csv-utils', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let originalBlob: typeof Blob;

  beforeEach(() => {
    // Save originals
    originalCreateObjectURL = global.URL.createObjectURL;
    originalRevokeObjectURL = global.URL.revokeObjectURL;
    originalBlob = global.Blob;

    // Create spies rather than direct overrides for elements
    vi.spyOn(document, 'createElement');

    // We cannot easily spyOn document.body.appendChild with a non-Node return
    // value in jsdom, so we'll mock the whole document.body.appendChild directly
    // but save it to restore later

    // Mock the global URLs safely
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    global.URL.revokeObjectURL = vi.fn();

    // Proper Mock constructor for Blob
    global.Blob = vi.fn(function(this: any, content: any[], options: any) {
      this.content = content;
      this.options = options;
    }) as any;
  });

  afterEach(() => {
    // Restore specific spyOn mocks
    vi.restoreAllMocks();

    // Restore manual assignments safely to prevent test pollution
    global.URL.createObjectURL = originalCreateObjectURL;
    global.URL.revokeObjectURL = originalRevokeObjectURL;
    global.Blob = originalBlob;
  });

  it('downloadTemplate creates a blob with correct content and triggers download', () => {
    // Create a real HTML element so jsdom's appendChild doesn't throw
    const linkMock = document.createElement('a');

    // Spy on its methods
    const clickSpy = vi.spyOn(linkMock, 'click').mockImplementation(() => {});
    const removeSpy = vi.spyOn(linkMock, 'remove').mockImplementation(() => {});

    // When document.createElement is called with 'a', return our spied mock
    (document.createElement as any).mockReturnValue(linkMock);

    // Spy on appendChild
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);

    downloadTemplate();

    // Verify Blob creation
    expect(global.Blob).toHaveBeenCalledWith([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });

    // Verify URL creation
    expect(global.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Object));

    // Verify link element creation and properties
    expect(document.createElement).toHaveBeenCalledWith('a');

    // jsdom prepends the hostname
    expect(linkMock.href).toContain('blob:fake-url');
    expect(linkMock.download).toBe('training_template.csv');

    // Verify link was added to DOM, clicked, and removed
    expect(appendChildSpy).toHaveBeenCalledWith(linkMock);
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();

    // Verify URL was revoked to prevent memory leaks
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
