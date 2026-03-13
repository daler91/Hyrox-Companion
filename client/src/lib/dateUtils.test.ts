import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toISODateString,
  getTodayString,
  getStartOfWeek,
  getEndOfWeek,
  getStartOfWeekString,
  getEndOfWeekString,
  isDateInRange,
  isDateInCurrentWeek,
  isDatePast,
  isDateFuture,
  isDateToday,
  formatTime,
  getCurrentTimeString
} from './dateUtils';

describe('dateUtils', () => {
  describe('toISODateString', () => {
    it('should format a date as YYYY-MM-DD', () => {
      const date = new Date('2023-10-15T10:30:00Z');
      expect(toISODateString(date)).toBe('2023-10-15');
    });

    it('should handle leap years', () => {
      const date = new Date('2024-02-29T12:00:00Z');
      expect(toISODateString(date)).toBe('2024-02-29');
    });

    it('should correctly pad single digit months and days', () => {
      const date = new Date('2023-05-05T12:00:00Z');
      expect(toISODateString(date)).toBe('2023-05-05');
    });

    it('should correctly handle end of year boundaries', () => {
      const date = new Date('2023-12-31T23:59:59Z');
      expect(toISODateString(date)).toBe('2023-12-31');
    });

    it('should correctly handle start of year boundaries', () => {
      const date = new Date('2024-01-01T00:00:00Z');
      expect(toISODateString(date)).toBe('2024-01-01');
    });

    it('should strip time components regardless of time of day', () => {
      const morningDate = new Date('2023-08-15T00:00:01Z');
      expect(toISODateString(morningDate)).toBe('2023-08-15');

      const eveningDate = new Date('2023-08-15T23:59:59Z');
      expect(toISODateString(eveningDate)).toBe('2023-08-15');
    });
  });

  describe('Functions relying on current time', () => {
    const mockNow = new Date('2023-10-18T12:00:00Z'); // A Wednesday

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('getTodayString', () => {
      it('should return the current date in YYYY-MM-DD format', () => {
        expect(getTodayString()).toBe('2023-10-18');
      });
    });

    describe('getStartOfWeek', () => {
      it('should return Sunday when weekStartsOn is 0 (default)', () => {
        const start = getStartOfWeek();
        expect(start.getDay()).toBe(0);
        expect(toISODateString(start)).toBe('2023-10-15');
        expect(start.getHours()).toBe(0);
        expect(start.getMinutes()).toBe(0);
        expect(start.getSeconds()).toBe(0);
        expect(start.getMilliseconds()).toBe(0);
      });

      it('should return Monday when weekStartsOn is 1', () => {
        const start = getStartOfWeek(undefined, 1);
        expect(start.getDay()).toBe(1);
        expect(toISODateString(start)).toBe('2023-10-16');
      });

      it('should correctly calculate start of week for a specific date', () => {
        const specificDate = new Date('2023-10-21T15:00:00Z'); // Saturday
        const start = getStartOfWeek(specificDate);
        expect(toISODateString(start)).toBe('2023-10-15');
      });
    });

    describe('getEndOfWeek', () => {
      it('should return Saturday when weekStartsOn is 0 (default)', () => {
        const end = getEndOfWeek();
        expect(end.getDay()).toBe(6);
        expect(toISODateString(end)).toBe('2023-10-21');
        expect(end.getHours()).toBe(23);
        expect(end.getMinutes()).toBe(59);
        expect(end.getSeconds()).toBe(59);
        expect(end.getMilliseconds()).toBe(999);
      });

      it('should return Sunday when weekStartsOn is 1', () => {
        const end = getEndOfWeek(undefined, 1);
        expect(end.getDay()).toBe(0);
        expect(toISODateString(end)).toBe('2023-10-22');
      });
    });

    describe('getStartOfWeekString', () => {
      it('should return string representation of start of week', () => {
        expect(getStartOfWeekString()).toBe('2023-10-15');
        expect(getStartOfWeekString(undefined, 1)).toBe('2023-10-16');
      });
    });

    describe('getEndOfWeekString', () => {
      it('should return string representation of end of week', () => {
        expect(getEndOfWeekString()).toBe('2023-10-21');
        expect(getEndOfWeekString(undefined, 1)).toBe('2023-10-22');
      });
    });

    describe('isDateInCurrentWeek', () => {
      it('should return true for dates in current week', () => {
        expect(isDateInCurrentWeek('2023-10-15')).toBe(true);
        expect(isDateInCurrentWeek('2023-10-18')).toBe(true);
        expect(isDateInCurrentWeek('2023-10-21')).toBe(true);
      });

      it('should return false for dates outside current week', () => {
        expect(isDateInCurrentWeek('2023-10-14')).toBe(false);
        expect(isDateInCurrentWeek('2023-10-22')).toBe(false);
      });

      it('should respect weekStartsOn parameter', () => {
        // Monday week start: Oct 16 to Oct 22
        expect(isDateInCurrentWeek('2023-10-15', 1)).toBe(false);
        expect(isDateInCurrentWeek('2023-10-22', 1)).toBe(true);
      });
    });

    describe('isDatePast', () => {
      it('should return true for past dates', () => {
        expect(isDatePast('2023-10-17')).toBe(true);
        expect(isDatePast('2022-10-18')).toBe(true);
      });

      it('should return false for today and future dates', () => {
        expect(isDatePast('2023-10-18')).toBe(false);
        expect(isDatePast('2023-10-19')).toBe(false);
      });
    });

    describe('isDateFuture', () => {
      it('should return true for future dates', () => {
        expect(isDateFuture('2023-10-19')).toBe(true);
        expect(isDateFuture('2024-10-18')).toBe(true);
      });

      it('should return false for today and past dates', () => {
        expect(isDateFuture('2023-10-18')).toBe(false);
        expect(isDateFuture('2023-10-17')).toBe(false);
      });
    });

    describe('isDateToday', () => {
      it('should return true for today', () => {
        expect(isDateToday('2023-10-18')).toBe(true);
      });

      it('should return false for other dates', () => {
        expect(isDateToday('2023-10-17')).toBe(false);
        expect(isDateToday('2023-10-19')).toBe(false);
      });
    });

    describe('formatTime', () => {
      it('should format time correctly', () => {
        // The locale string might vary depending on the environment running the tests.
        // We'll mock it slightly or check the general format to avoid flaky tests due to locale.
        const mockTime = new Date('2023-10-18T14:30:00');
        const formatted = formatTime(mockTime);
        // It should contain the hours and minutes in some form, typically HH:MM or h:mm AM/PM
        expect(formatted).toMatch(/([0-9]{1,2}):([0-9]{2})/);
      });
    });

    describe('getCurrentTimeString', () => {
      it('should return formatted current time', () => {
        const timeStr = getCurrentTimeString();
        expect(typeof timeStr).toBe('string');
        expect(timeStr).toMatch(/([0-9]{1,2}):([0-9]{2})/);
      });
    });
  });

  describe('isDateInRange', () => {
    it('should return true when date is between start and end', () => {
      expect(isDateInRange('2023-10-15', '2023-10-01', '2023-10-31')).toBe(true);
    });

    it('should return true when date equals start', () => {
      expect(isDateInRange('2023-10-01', '2023-10-01', '2023-10-31')).toBe(true);
    });

    it('should return true when date equals end', () => {
      expect(isDateInRange('2023-10-31', '2023-10-01', '2023-10-31')).toBe(true);
    });

    it('should return false when date is before start', () => {
      expect(isDateInRange('2023-09-30', '2023-10-01', '2023-10-31')).toBe(false);
    });

    it('should return false when date is after end', () => {
      expect(isDateInRange('2023-11-01', '2023-10-01', '2023-10-31')).toBe(false);
    });
  });
});
