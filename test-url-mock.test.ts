import { test, vi } from 'vitest';
test('url', () => {
  window.URL.createObjectURL = vi.fn();
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('mock');
});
