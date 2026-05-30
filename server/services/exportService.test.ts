import { describe, expect, it, vi } from 'vitest';

import type { IStorage } from '../storage';
import { generateCSV, generateJSON } from './exportService';

describe('exportService - generateCSV', () => {
  const mockUserId = 'user-1';

  const createMockStorage = (
    timeline: unknown[] = [],
    exerciseSets: unknown[] = []
  ): IStorage => {
    return {
      timeline: { getTimeline: vi.fn().mockResolvedValue(timeline) },
      analytics: { getAllExerciseSetsWithDates: vi.fn().mockResolvedValue(exerciseSets) },
    } as unknown as IStorage;
  };

  it('should generate header row for empty data', async () => {
    const storage = createMockStorage([], []);
    const csv = await generateCSV(mockUserId, storage);
    expect(csv).toBe('Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE');
  });

  it('should generate basic timeline rows without exercise sets', async () => {
    const timeline = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        type: 'Run',
        status: 'Completed',
        focus: 'Endurance',
        mainWorkout: '5k',
        accessory: 'Core',
        notes: 'Felt good',
        duration: 30,
        rpe: 5,
      },
    ];
    const storage = createMockStorage(timeline, []);
    const csv = await generateCSV(mockUserId, storage);

    const expectedRows = [
      'Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE',
      '2023-10-01,Run,Completed,Endurance,5k,Core,Felt good,30,5'
    ].join('\n');

    expect(csv).toBe(expectedRows);
  });

  it('should generate exercise sets section if present', async () => {
    const timeline = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        focus: 'Strength',
      },
    ];
    const exerciseSets = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        exerciseName: 'Squat',
        customLabel: null,
        category: 'Lower Body',
        setNumber: 1,
        reps: 10,
        weight: 135,
        distance: null,
        time: null,
        notes: 'Warmup',
      },
    ];
    const storage = createMockStorage(timeline, exerciseSets);
    const csv = await generateCSV(mockUserId, storage);

    const expectedRows = [
      'Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE',
      '2023-10-01,,,Strength,,,,,',
      '',
      '--- EXERCISE SETS (Per-Set Data) ---',
      'Date,Workout,Exercise,Category,Set #,Reps,Weight,Distance (m),Time (min),Notes',
      '2023-10-01,Strength,Squat,Lower Body,1,10,135,,,Warmup'
    ].join('\n');

    expect(csv).toBe(expectedRows);
  });

  it('should correctly escape quotes, commas, and newlines in text fields', async () => {
    const timeline = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        focus: 'Line 1\nLine 2',
        notes: 'She said, "Hello"',
        mainWorkout: 'A, B, and C',
      },
    ];
    const exerciseSets = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        exerciseName: 'Bench Press',
        customLabel: 'My "Custom" Bench',
        category: 'Upper Body',
        setNumber: 1,
        reps: 5,
        notes: 'Hard,\nheavy!',
      },
    ];
    const storage = createMockStorage(timeline, exerciseSets);
    const csv = await generateCSV(mockUserId, storage);

    const expectedRows = [
      'Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE',
      '2023-10-01,,,"Line 1\nLine 2","A, B, and C",,"She said, ""Hello""",,',
      '',
      '--- EXERCISE SETS (Per-Set Data) ---',
      'Date,Workout,Exercise,Category,Set #,Reps,Weight,Distance (m),Time (min),Notes',
      '2023-10-01,"Line 1\nLine 2","My ""Custom"" Bench",Upper Body,1,5,,,,"Hard,\nheavy!"'
    ].join('\n');

    expect(csv).toBe(expectedRows);
  });

  it('shows the race-day mainWorkout when a race day has no exercises (no empty cell)', async () => {
    // Read-time derivation gives race/shakeout/recovery days no exercise sets; the
    // CSV must fall back to mainWorkout (structuredSummary([]) and (undefined) → null).
    const timeline = [
      {
        planDayId: 'p-1',
        date: '2026-07-11',
        type: 'planned',
        status: 'planned',
        focus: 'Race Day',
        mainWorkout: 'HYROX race day. Execute your plan.',
        accessory: null,
        notes: null,
        exerciseSets: [],
      },
      {
        planDayId: 'p-2',
        date: '2026-07-18',
        type: 'planned',
        status: 'planned',
        focus: 'Race Day',
        mainWorkout: 'HYROX race day. Trust your training.',
        accessory: null,
        notes: null,
        exerciseSets: undefined,
      },
    ];
    const storage = createMockStorage(timeline, []);
    const csv = await generateCSV(mockUserId, storage);

    expect(csv).toContain('2026-07-11,planned,planned,Race Day,HYROX race day. Execute your plan.,,,,');
    expect(csv).toContain('2026-07-18,planned,planned,Race Day,HYROX race day. Trust your training.,,,,');
  });

  it('should propagate errors when storage fails', async () => {
    const storage = createMockStorage([], []);
    storage.timeline.getTimeline = vi.fn().mockRejectedValue(new Error('Storage failure'));

    await expect(generateCSV(mockUserId, storage)).rejects.toThrow('Storage failure');
  });

});

describe('exportService - generateJSON (GDPR Art. 15 data export)', () => {
  const mockUserId = 'user-1';

  // Mock storage that satisfies every namespace `generateJSON` calls into.
  // Defaults to empty results so individual tests can override only what
  // they care about.
  const createMockStorage = (overrides: Partial<{
    user: unknown;
    timeline: unknown[];
    plans: unknown[];
    exerciseSets: unknown[];
    chatMessages: unknown[];
    coachingMaterials: unknown[];
    customExercises: unknown[];
    timelineAnnotations: unknown[];
    stravaConnection: unknown;
    garminConnection: unknown;
    pushSubscriptions: unknown[];
    aiUsageLogs: unknown[];
  }> = {}): IStorage => {
    return {
      users: {
        getUser: vi.fn().mockResolvedValue(overrides.user ?? null),
        getAllChatMessagesForExport: vi.fn().mockResolvedValue(overrides.chatMessages ?? []),
        getCustomExercises: vi.fn().mockResolvedValue(overrides.customExercises ?? []),
        getStravaConnection: vi.fn().mockResolvedValue(overrides.stravaConnection ?? undefined),
        getGarminConnection: vi.fn().mockResolvedValue(overrides.garminConnection ?? undefined),
      },
      timeline: { getTimeline: vi.fn().mockResolvedValue(overrides.timeline ?? []) },
      plans: { listTrainingPlans: vi.fn().mockResolvedValue(overrides.plans ?? []) },
      analytics: { getAllExerciseSetsWithDates: vi.fn().mockResolvedValue(overrides.exerciseSets ?? []) },
      coaching: { listCoachingMaterials: vi.fn().mockResolvedValue(overrides.coachingMaterials ?? []) },
      timelineAnnotations: { list: vi.fn().mockResolvedValue(overrides.timelineAnnotations ?? []) },
      push: { getSubscriptionsForUser: vi.fn().mockResolvedValue(overrides.pushSubscriptions ?? []) },
      aiUsage: { listForUser: vi.fn().mockResolvedValue(overrides.aiUsageLogs ?? []) },
    } as unknown as IStorage;
  };

  it('emits all GDPR-relevant top-level sections', async () => {
    const result = await generateJSON(mockUserId, createMockStorage());

    expect(result).toMatchObject({
      exportFormatVersion: 1,
      exportedAt: expect.any(String),
      profile: null,
      timeline: [],
      plans: [],
      exerciseSets: [],
      chatMessages: [],
      coachingMaterials: [],
      customExercises: [],
      timelineAnnotations: [],
      connections: { strava: null, garmin: null },
      pushSubscriptions: [],
      aiUsageLogs: [],
    });
  });

  it('returns an ISO-8601 timestamp for exportedAt', async () => {
    const result = await generateJSON(mockUserId, createMockStorage());

    // Parse-roundtrip; if exportedAt isn't ISO-8601, this throws.
    expect(new Date(result.exportedAt).toISOString()).toBe(result.exportedAt);
  });

  it('includes the user profile when present', async () => {
    const user = { id: mockUserId, email: 'athlete@example.com', firstName: 'Sam' };
    const result = await generateJSON(mockUserId, createMockStorage({ user }));

    expect(result.profile).toEqual(user);
  });

  it('strips Strava access and refresh tokens from the export', async () => {
    const stravaConn = {
      id: 'sc-1',
      userId: mockUserId,
      stravaAthleteId: '12345',
      accessToken: 'sk-secret-access',
      refreshToken: 'sk-secret-refresh',
      expiresAt: new Date('2026-06-01T00:00:00Z'),
      scope: 'read,activity:read',
      lastSyncedAt: new Date('2026-05-30T12:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const result = await generateJSON(mockUserId, createMockStorage({ stravaConnection: stravaConn }));

    expect(result.connections.strava).toBeDefined();
    expect(result.connections.strava).toMatchObject({
      stravaAthleteId: '12345',
      scope: 'read,activity:read',
      tokensRedacted: true,
    });
    // Critical: tokens must not appear anywhere in the serialized export.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sk-secret-access');
    expect(serialized).not.toContain('sk-secret-refresh');
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('refreshToken');
  });

  it('strips encrypted Garmin credentials and OAuth tokens from the export', async () => {
    const garminConn = {
      id: 'gc-1',
      userId: mockUserId,
      garminDisplayName: 'samrunner',
      encryptedEmail: 'v1:iv:tag:ciphertext-email',
      encryptedPassword: 'v1:iv:tag:ciphertext-pw',
      encryptedOauth1Token: 'v1:iv:tag:ciphertext-oauth1',
      encryptedOauth2Token: 'v1:iv:tag:ciphertext-oauth2',
      tokenExpiresAt: new Date('2026-06-01T00:00:00Z'),
      lastSyncedAt: new Date('2026-05-30T12:00:00Z'),
      lastError: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const result = await generateJSON(mockUserId, createMockStorage({ garminConnection: garminConn }));

    expect(result.connections.garmin).toBeDefined();
    expect(result.connections.garmin).toMatchObject({
      garminDisplayName: 'samrunner',
      credentialsRedacted: true,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('ciphertext-email');
    expect(serialized).not.toContain('ciphertext-pw');
    expect(serialized).not.toContain('ciphertext-oauth1');
    expect(serialized).not.toContain('ciphertext-oauth2');
    expect(serialized).not.toContain('encryptedEmail');
    expect(serialized).not.toContain('encryptedPassword');
  });

  it('reduces push subscriptions to endpoint only (no p256dh / auth keys)', async () => {
    const subs = [
      {
        id: 'ps-1',
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        p256dh: 'BASE64_PUBLIC_KEY_p256dh',
        auth: 'BASE64_AUTH_SECRET',
      },
    ];
    const result = await generateJSON(mockUserId, createMockStorage({ pushSubscriptions: subs }));

    expect(result.pushSubscriptions).toEqual([{ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('BASE64_PUBLIC_KEY_p256dh');
    expect(serialized).not.toContain('BASE64_AUTH_SECRET');
    expect(serialized).not.toContain('p256dh');
  });

  it('includes chat messages, coaching materials, custom exercises, annotations, and AI usage logs verbatim', async () => {
    const chatMessages = [{ id: 'm1', role: 'user', content: 'hello', timestamp: new Date() }];
    const coachingMaterials = [{ id: 'cm1', title: 'My Programming', content: 'lift heavy', type: 'principles' }];
    const customExercises = [{ id: 'ce1', name: 'Kettlebell Halo', category: 'conditioning' }];
    const timelineAnnotations = [{ id: 'a1', startDate: '2026-04-01', endDate: '2026-04-07', type: 'travel', note: 'work trip' }];
    const aiUsageLogs = [{ id: 'al1', model: 'gemini-2.0-flash', feature: 'chat', inputTokens: 100, outputTokens: 50, estimatedCostCents: 0.1, createdAt: new Date() }];

    const result = await generateJSON(
      mockUserId,
      createMockStorage({ chatMessages, coachingMaterials, customExercises, timelineAnnotations, aiUsageLogs }),
    );

    expect(result.chatMessages).toEqual(chatMessages);
    expect(result.coachingMaterials).toEqual(coachingMaterials);
    expect(result.customExercises).toEqual(customExercises);
    expect(result.timelineAnnotations).toEqual(timelineAnnotations);
    expect(result.aiUsageLogs).toEqual(aiUsageLogs);
  });
});
