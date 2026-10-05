import * as allTables from '@shared/schema/tables';
import { users } from '@shared/schema/tables';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { IStorage } from '../storage';
import { generateCSV, generateJSON } from './exportService';

describe('exportService - generateCSV', () => {
  const mockUserId = 'user-1';

  const createMockStorage = (
    timeline: unknown[] = [],
    exerciseSets: unknown[] = [],
    user: unknown = null
  ): IStorage => {
    return {
      users: { getUser: vi.fn().mockResolvedValue(user) },
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
      'Date,Workout,Exercise,Category,Set #,Reps,Weight (kg),Distance (m),Time (min),Notes',
      '2023-10-01,Strength,Squat,Lower Body,1,10,135,,,Warmup'
    ].join('\n');

    expect(csv).toBe(expectedRows);
  });

  // W26 — exports must carry the unit context of the stored values so a
  // portability consumer can interpret them (values are in the user's preferred
  // unit, not SI; see shared/unitConversion.ts).
  it('labels the CSV Weight column with the user\'s weight unit', async () => {
    const timeline = [{ workoutLogId: 'w-1', date: '2023-10-01', focus: 'Strength' }];
    const exerciseSets = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        exerciseName: 'Squat',
        customLabel: null,
        category: 'Lower Body',
        setNumber: 1,
        reps: 5,
        weight: 225,
        distance: null,
        time: null,
        notes: null,
      },
    ];
    const storage = createMockStorage(timeline, exerciseSets, { weightUnit: 'lbs', distanceUnit: 'miles' });
    const csv = await generateCSV(mockUserId, storage);
    // INVERTED (audit H16). This asserted 'Distance (m)' for a fixture that
    // explicitly sets distanceUnit 'miles' -- exercise_sets.distance stores FEET
    // for that athlete, so the export was handing them feet under a metres
    // header. The weight column next to it was already preference-aware.
    expect(csv).toContain('Reps,Weight (lbs),Distance (ft)');
  });

  // D41 (CODEBASE_ANALYSIS_2026-10-03): the columns are labelled with the
  // athlete's CURRENT units, so each row has to be read through its own L4
  // stamp. A kg-to-lbs switcher's 140 kg set was exported as "140 lbs".
  it('converts each set from its stamped unit into the labelled export unit', async () => {
    const timeline = [{ workoutLogId: 'w-1', date: '2023-10-01', focus: 'Strength' }];
    const base = {
      workoutLogId: 'w-1',
      date: '2023-10-01',
      exerciseName: 'Squat',
      customLabel: null,
      category: 'Lower Body',
      reps: 5,
      time: null,
      notes: null,
    };
    const exerciseSets = [
      // Logged in kg before the switch.
      { ...base, setNumber: 1, weight: 140, weightUnit: 'kg', distance: 1000, distanceUnit: 'm' },
      // Logged in lbs after it: already in the export unit.
      { ...base, setNumber: 2, weight: 225, weightUnit: 'lbs', distance: 3000, distanceUnit: 'ft' },
      // Pre-L4 legacy row: no stamp, passes through as on every other read path.
      { ...base, setNumber: 3, weight: 100, weightUnit: null, distance: 500, distanceUnit: null },
    ];
    const storage = createMockStorage(timeline, exerciseSets, { weightUnit: 'lbs', distanceUnit: 'miles' });
    const csv = await generateCSV(mockUserId, storage);

    expect(csv).toContain('Reps,Weight (lbs),Distance (ft)');
    expect(csv).toContain('2023-10-01,Strength,Squat,Lower Body,1,5,309,3281,,');
    expect(csv).toContain('2023-10-01,Strength,Squat,Lower Body,2,5,225,3000,,');
    expect(csv).toContain('2023-10-01,Strength,Squat,Lower Body,3,5,100,500,,');
    expect(csv).not.toContain(',140,');
  });

  it('converts stamped sets in the timeline structured summary too (D41)', async () => {
    const timeline = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        type: 'Strength',
        status: 'completed',
        focus: 'Legs',
        exerciseSets: [
          {
            exerciseName: 'Squat',
            blockId: 'b1',
            stepNumber: 1,
            reps: 5,
            weight: 140,
            weightUnit: 'kg',
            distance: null,
          },
          {
            exerciseName: 'Run',
            blockId: 'b2',
            stepNumber: 1,
            weight: null,
            distance: 1000,
            distanceUnit: 'm',
          },
        ],
      },
    ];
    const storage = createMockStorage(timeline, [], { weightUnit: 'lbs', distanceUnit: 'miles' });
    const csv = await generateCSV(mockUserId, storage);

    expect(csv).toContain('Squat (5 reps · 309) | Run (3281ft)');
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
      'Date,Workout,Exercise,Category,Set #,Reps,Weight (kg),Distance (m),Time (min),Notes',
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
    athleteFacts: unknown[];
    stravaConnection: unknown;
    garminConnection: unknown;
    pushSubscriptions: unknown[];
    aiUsageLogs: unknown[];
    planDays: Array<{ id: string; planId: string }>;
    planDayStructures: Map<string, unknown[]>;
    nutrition: Record<string, unknown>;
    userKeyedRows: Record<string, unknown>;
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
      coaching: { listCoachingMaterials: vi.fn().mockResolvedValue(overrides.coachingMaterials ?? []) },
      timelineAnnotations: { list: vi.fn().mockResolvedValue(overrides.timelineAnnotations ?? []) },
      athleteFacts: { list: vi.fn().mockResolvedValue(overrides.athleteFacts ?? []) },
      push: { getSubscriptionsForUser: vi.fn().mockResolvedValue(overrides.pushSubscriptions ?? []) },
      aiUsage: { listForUser: vi.fn().mockResolvedValue(overrides.aiUsageLogs ?? []) },
      workouts: {
        getWorkoutStructuresByPlanDays: vi.fn().mockResolvedValue(overrides.planDayStructures ?? new Map()),
      },
      dataExport: {
        listLoggedExerciseSets: vi.fn().mockResolvedValue(overrides.exerciseSets ?? []),
        listPlanDaysWithSets: vi.fn().mockResolvedValue(overrides.planDays ?? []),
        listNutrition: vi.fn().mockResolvedValue(
          overrides.nutrition ?? {
            foodLog: [],
            nutritionTargets: [],
            mealTargets: [],
            foodFavorites: [],
            recipes: [],
            customFoods: [],
            customFoodServings: [],
          },
        ),
        listUserKeyedRows: vi.fn().mockResolvedValue(
          overrides.userKeyedRows ?? {
            weeklyReviews: [],
            workoutStreams: [],
            planDayMoves: [],
            planAdjustmentProposals: [],
            consents: [],
            trainingStyleHistory: [],
            analyticsResults: [],
            maf: { profile: [], testResults: [], workoutAnalysis: [] },
            recycleBin: [],
          },
        ),
      },
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
      athleteFacts: [],
      connections: { strava: null, garmin: null },
      pushSubscriptions: [],
      aiUsageLogs: [],
      nutrition: {
        foodLog: [],
        nutritionTargets: [],
        mealTargets: [],
        foodFavorites: [],
        recipes: [],
        customFoods: [],
        customFoodServings: [],
      },
      weeklyReviews: [],
      workoutStreams: [],
      planDayMoves: [],
      planAdjustmentProposals: [],
      consents: [],
      trainingStyleHistory: [],
      analyticsResults: [],
      maf: { profile: [], testResults: [], workoutAnalysis: [] },
      recycleBin: [],
    });
  });

  // P7 (CODEBASE_ANALYSIS_2026-10-03): plans used to go out as bare rows, and
  // the timeline only carries scheduled days inside a plan's lifetime, so an
  // imported plan that was never scheduled was missing from the export.
  it('exports every plan with all of its days, scheduled or not, and their structure', async () => {
    const plans = [{ id: 'plan-1', name: 'Imported, never scheduled' }, { id: 'plan-2', name: 'Live' }];
    const planDays = [
      { id: 'd1', planId: 'plan-1', scheduledDate: null, focus: 'Threshold', exerciseSets: [{ id: 's1' }] },
      { id: 'd2', planId: 'plan-1', scheduledDate: null, focus: 'Long run', exerciseSets: [] },
      { id: 'd3', planId: 'plan-2', scheduledDate: '2026-10-05', focus: 'Sled', exerciseSets: [] },
    ];
    const structure = [{ sectionType: 'main', steps: [] }];
    const storage = createMockStorage({ plans, planDays, planDayStructures: new Map([['d1', structure]]) });

    const result = await generateJSON(mockUserId, storage);

    expect(vi.mocked(storage.workouts).getWorkoutStructuresByPlanDays.mock.calls).toContainEqual([['d1', 'd2', 'd3']]);
    expect(result.plans).toEqual([
      {
        ...plans[0],
        days: [
          { ...planDays[0], structure },
          { ...planDays[1], structure: [] },
        ],
      },
      { ...plans[1], days: [{ ...planDays[2], structure: [] }] },
    ]);
  });

  it('includes the nutrition, MAF, weekly-review, stream, consent and other user-keyed rows verbatim', async () => {
    const nutrition = {
      foodLog: [{ id: 'fl1', quantityG: 150, food: { name: 'Oats', brand: null } }],
      nutritionTargets: [{ id: 'nt1', calories: 2600 }],
      mealTargets: [{ id: 'mt1', mealType: 'breakfast' }],
      foodFavorites: [{ id: 'ff1', food: { name: 'Oats', brand: null } }],
      recipes: [{ id: 'r1', name: 'Overnight oats', ingredients: [{ id: 'ri1' }] }],
      customFoods: [{ id: 'f1', name: 'Gran\'s flapjack', isPublic: false }],
      customFoodServings: [{ id: 'fs1', label: '1 bar' }],
    };
    const userKeyedRows = {
      weeklyReviews: [{ id: 'wr1', intent: 'Easy week, sleep more' }],
      workoutStreams: [{ id: 'st1', samples: { hr: [120, 131] } }],
      planDayMoves: [{ id: 'mv1', fromDate: '2026-10-01', toDate: '2026-10-02' }],
      planAdjustmentProposals: [{ id: 'pp1', userRequest: 'move my long run' }],
      consents: [{ id: 'c1', consentType: 'ai_coach', granted: true }],
      trainingStyleHistory: [{ id: 'ts1', style: 'hyrox' }],
      analyticsResults: [{ id: 'ar1', feature: 'coach_insights' }],
      maf: { profile: [{ id: 'mp1' }], testResults: [{ id: 'mtr1' }], workoutAnalysis: [{ id: 'mwa1' }] },
      recycleBin: [{ id: 'rb1', entityType: 'workout' }],
    };

    const result = await generateJSON(mockUserId, createMockStorage({ nutrition, userKeyedRows }));

    expect(result.nutrition).toEqual(nutrition);
    expect(result).toMatchObject(userKeyedRows);
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

  // W26 — the export must carry the unit context of stored weight/distance.
  it('annotates the export with the user\'s unitPreferences', async () => {
    const user = { id: mockUserId, weightUnit: 'lbs', distanceUnit: 'miles' };
    const result = await generateJSON(mockUserId, createMockStorage({ user }));

    expect(result.unitPreferences).toEqual({ weightUnit: 'lbs', distanceUnit: 'miles' });
  });

  it('defaults unitPreferences to kg/km when the user has no preference', async () => {
    const result = await generateJSON(mockUserId, createMockStorage());

    expect(result.unitPreferences).toEqual({ weightUnit: 'kg', distanceUnit: 'km' });
  });

  // D41 (CODEBASE_ANALYSIS_2026-10-03): `exerciseSets` sits under the
  // `unitPreferences` label, so its values are converted through each row's stamp.
  it('converts exerciseSets into the unitPreferences units through each row\'s stamp', async () => {
    const user = { id: mockUserId, weightUnit: 'lbs', distanceUnit: 'km' };
    const base = { workoutLogId: 'w-1', date: '2026-10-01', exerciseName: 'Squat', category: 'Lower Body', reps: 5 };
    const exerciseSets = [
      { ...base, setNumber: 1, weight: 140, weightUnit: 'kg', distance: 3281, distanceUnit: 'ft' },
      { ...base, setNumber: 2, weight: 225, weightUnit: 'lbs', distance: 400, distanceUnit: 'm' },
      { ...base, setNumber: 3, weight: null, weightUnit: null, distance: null, distanceUnit: null },
    ];
    const result = await generateJSON(mockUserId, createMockStorage({ user, exerciseSets }));

    expect(result.exerciseSets.map(({ weight, distance }) => ({ weight, distance }))).toEqual([
      { weight: 309, distance: 1000 },
      { weight: 225, distance: 400 },
      { weight: null, distance: null },
    ]);
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

  it('includes chat messages, coaching materials, custom exercises, annotations, athlete facts, and AI usage logs verbatim', async () => {
    const chatMessages = [{ id: 'm1', role: 'user', content: 'hello', timestamp: new Date() }];
    const coachingMaterials = [{ id: 'cm1', title: 'My Programming', content: 'lift heavy', type: 'principles' }];
    const customExercises = [{ id: 'ce1', name: 'Kettlebell Halo', category: 'conditioning' }];
    const timelineAnnotations = [{ id: 'a1', startDate: '2026-04-01', endDate: '2026-04-07', type: 'travel', note: 'work trip' }];
    const aiUsageLogs = [{ id: 'al1', model: 'gemini-2.0-flash', feature: 'chat', inputTokens: 100, outputTokens: 50, estimatedCostCents: 0.1, createdAt: new Date() }];
    // Retired facts too: they are still the athlete's own words.
    const athleteFacts = [{ id: 'f1', fact: 'No sled at my gym', category: 'equipment', active: false }];

    const result = await generateJSON(
      mockUserId,
      createMockStorage({ chatMessages, coachingMaterials, customExercises, timelineAnnotations, athleteFacts, aiUsageLogs }),
    );

    expect(result.chatMessages).toEqual(chatMessages);
    expect(result.coachingMaterials).toEqual(coachingMaterials);
    expect(result.customExercises).toEqual(customExercises);
    expect(result.timelineAnnotations).toEqual(timelineAnnotations);
    expect(result.athleteFacts).toEqual(athleteFacts);
    expect(result.aiUsageLogs).toEqual(aiUsageLogs);
  });

  // P7 (CODEBASE_ANALYSIS_2026-10-03): the export was a hand-picked list, so every
  // user-owned table added after it dropped out of Art. 15/20 copies silently.
  // Like tables.cascade.test.ts, this sweep is closed-world: EVERY table that
  // reaches users.id, directly or through FK parents, must name the export
  // section that carries it, or be excluded here with the reason.
  describe('covers every user-owned table', () => {
    const EXPORTED_IN: Record<string, string> = {
      users: 'profile',
      trainingPlans: 'plans',
      planDays: 'plans', // plans[].days, never-scheduled days included
      workoutLogs: 'timeline',
      // Logged sets; prescribed ones ride on plans[].days[].exerciseSets.
      exerciseSets: 'exerciseSets',
      // Hydrated onto timeline entries and plans[].days[].structure.
      workoutStructureBlocks: 'timeline',
      workoutStructureSteps: 'timeline',
      chatMessages: 'chatMessages',
      coachingMaterials: 'coachingMaterials',
      customExercises: 'customExercises',
      timelineAnnotations: 'timelineAnnotations',
      athleteFacts: 'athleteFacts',
      stravaConnections: 'connections.strava', // tokens redacted
      garminConnections: 'connections.garmin', // credentials redacted
      pushSubscriptions: 'pushSubscriptions', // encryption keys redacted
      aiUsageLogs: 'aiUsageLogs',
      foodLogEntries: 'nutrition.foodLog',
      nutritionTargets: 'nutrition.nutritionTargets',
      mealTargets: 'nutrition.mealTargets',
      foodFavorites: 'nutrition.foodFavorites',
      recipes: 'nutrition.recipes',
      recipeIngredients: 'nutrition.recipes', // recipes[].ingredients
      foods: 'nutrition.customFoods', // only the athlete's own; the rest is a shared catalogue
      foodServings: 'nutrition.customFoodServings',
      weeklyReviews: 'weeklyReviews',
      workoutLogStreams: 'workoutStreams',
      planDayMoves: 'planDayMoves',
      planAdjustmentProposals: 'planAdjustmentProposals',
      userConsents: 'consents',
      userTrainingStyle: 'trainingStyleHistory',
      analyticsResults: 'analyticsResults',
      mafProfile: 'maf.profile',
      mafTestResults: 'maf.testResults',
      mafWorkoutAnalysis: 'maf.workoutAnalysis',
      recycleBinItems: 'recycleBin',
    };

    const EXCLUDED: Record<string, string> = {
      idempotencyKeys:
        'server-internal replay cache: stored responses to the athlete\'s own requests, kept for 7 days, whose data is exported from its source tables',
      documentChunks:
        'search index derived from coaching materials: chunk copies of text exported verbatim under coachingMaterials, plus embedding vectors',
      structuredExerciseBackfillReviews:
        'server-internal bookkeeping for a data-migration job (a status and reason per migrated record), not information about the athlete',
    };

    function userOwnedTableNames(): string[] {
      const named = Object.entries(allTables).flatMap(([name, value]): [string, PgTable][] =>
        is(value, PgTable) ? [[name, value]] : [],
      );
      const nameOf = new Map<unknown, string>(named.map(([name, table]) => [table, name]));
      const parentsOf = new Map(
        named.map(([name, table]) => [
          name,
          getTableConfig(table).foreignKeys.map((fk) => nameOf.get(fk.reference().foreignTable)),
        ]),
      );
      const usersTable = nameOf.get(users);
      if (usersTable === undefined) throw new Error('The users table is not exported from @shared/schema/tables.');
      const owned = new Set<string>([usersTable]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [name, parents] of parentsOf) {
          if (!owned.has(name) && parents.some((parent) => parent !== undefined && owned.has(parent))) {
            owned.add(name);
            grew = true;
          }
        }
      }
      return [...owned].sort();
    }

    function hasPath(value: unknown, path: string): boolean {
      let node = value;
      for (const key of path.split('.')) {
        if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) return false;
        // An own property's value, read without indexing the object by key.
        node = Object.getOwnPropertyDescriptor(node, key)?.value;
      }
      return true;
    }

    it('maps every table that reaches users.id to an export section or a documented exclusion', () => {
      const owned = userOwnedTableNames();
      const unaccounted = owned.filter((name) => !(name in EXPORTED_IN) && !(name in EXCLUDED));

      expect(
        unaccounted,
        'A new user-owned table must be added to the GDPR export (generateJSON + EXPORTED_IN) or to EXCLUDED with a reason',
      ).toEqual([]);
      // Guards the guard: a schema refactor that hides tables from this sweep
      // must fail it rather than let it pass vacuously.
      expect(owned.length).toBeGreaterThanOrEqual(38);
    });

    it('names only real user-owned tables, each exactly once', () => {
      const owned = new Set(userOwnedTableNames());
      const listed = [...Object.keys(EXPORTED_IN), ...Object.keys(EXCLUDED)];

      expect(listed.filter((name) => !owned.has(name))).toEqual([]);
      expect(Object.keys(EXPORTED_IN).filter((name) => name in EXCLUDED)).toEqual([]);
    });

    it('emits every section the map names', async () => {
      const result = await generateJSON(mockUserId, createMockStorage());

      const missing = Object.entries(EXPORTED_IN)
        .filter(([, section]) => !hasPath(result, section))
        .map(([table, section]) => `${table} -> ${section}`);
      expect(missing).toEqual([]);
    });
  });
});
