import { test, vi } from 'vitest';
test('url', () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('mock');
});
