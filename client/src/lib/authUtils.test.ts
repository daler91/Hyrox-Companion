import { describe, expect, it } from 'vitest';

import { getUserDisplayName } from './authUtils';

describe('getUserDisplayName', () => {
  it('uses the full name when both parts are present', () => {
    expect(getUserDisplayName({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' })).toBe('Ada Lovelace');
  });

  it('falls back to the email when either name part is missing', () => {
    expect(getUserDisplayName({ firstName: 'Ada', lastName: null, email: 'ada@example.com' })).toBe('ada@example.com');
    expect(getUserDisplayName({ firstName: null, lastName: 'Lovelace', email: 'ada@example.com' })).toBe('ada@example.com');
  });

  it('falls back to "User" with no name and no email, or no user at all', () => {
    expect(getUserDisplayName({ firstName: null, lastName: null, email: null })).toBe('User');
    for (const absent of [null, undefined]) {
      expect(getUserDisplayName(absent)).toBe('User');
    }
  });
});
