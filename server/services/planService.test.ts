import { describe, it, expect, vi, beforeEach } from "vitest";
import { importPlanFromCSV } from "./planService";
import { storage } from "../storage";

// Mock the storage module
vi.mock("../storage", () => ({
  storage: {
    createTrainingPlan: vi.fn(),
    createPlanDays: vi.fn(),
    getTrainingPlan: vi.fn(),
  },
}));

// Mock the db module
vi.mock("../db", () => ({
  db: {
    transaction: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("importPlanFromCSV", () => {
  const mockUserId = "user-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully import a valid CSV", async () => {
    const csvContent = `Week,Day,Focus,Main Workout,Accessory/Engine Work,Notes
1,Monday,Strength,"Squat 3x5","Row 3x10",Good
1,Tuesday,Cardio,"Run 5k","",
2,Monday,Strength,"Squat 3x5","Row 3x10",`;

    const mockPlan = { id: "plan-1", userId: mockUserId, name: "Imported Plan", sourceFileName: null, totalWeeks: 2 };
    const mockFullPlan = { ...mockPlan, days: [] };

    vi.mocked(storage.createTrainingPlan).mockResolvedValue(mockPlan as any);
    vi.mocked(storage.createPlanDays).mockResolvedValue([] as any);
    vi.mocked(storage.getTrainingPlan).mockResolvedValue(mockFullPlan as any);

    const result = await importPlanFromCSV(csvContent, mockUserId);

    expect(result).toEqual(mockFullPlan);

    expect(storage.createTrainingPlan).toHaveBeenCalledWith({
      userId: mockUserId,
      name: "Imported Plan",
      sourceFileName: null,
      totalWeeks: 2,
    });

    expect(storage.createPlanDays).toHaveBeenCalledWith([
      {
        planId: "plan-1",
        weekNumber: 1,
        dayName: "Monday",
        focus: "Strength",
        mainWorkout: "Squat 3x5",
        accessory: "Row 3x10",
        notes: "Good",
      },
      {
        planId: "plan-1",
        weekNumber: 1,
        dayName: "Tuesday",
        focus: "Cardio",
        mainWorkout: "Run 5k",
        accessory: null,
        notes: null,
      },
      {
        planId: "plan-1",
        weekNumber: 2,
        dayName: "Monday",
        focus: "Strength",
        mainWorkout: "Squat 3x5",
        accessory: "Row 3x10",
        notes: null,
      },
    ]);

    expect(storage.getTrainingPlan).toHaveBeenCalledWith("plan-1", mockUserId);
  });

  it("should throw an error if CSV has no valid rows", async () => {
    const csvContent = `Week,Day,Focus,Main Workout,Accessory/Engine Work,Notes`;

    await expect(importPlanFromCSV(csvContent, mockUserId)).rejects.toThrow("No valid rows found in CSV");

    expect(storage.createTrainingPlan).not.toHaveBeenCalled();
    expect(storage.createPlanDays).not.toHaveBeenCalled();
  });

  it("should throw an error if CSV has no valid week numbers", async () => {
    const csvContent = `Week,Day,Focus,Main Workout,Accessory/Engine Work,Notes
,Monday,Strength,"Squat 3x5","Row 3x10",Good
Invalid,Tuesday,Cardio,"Run 5k","",`;

    await expect(importPlanFromCSV(csvContent, mockUserId)).rejects.toThrow("No valid week numbers found in CSV");

    expect(storage.createTrainingPlan).not.toHaveBeenCalled();
    expect(storage.createPlanDays).not.toHaveBeenCalled();
  });

  it("should handle 'Accessory' header as fallback for 'Accessory/Engine Work'", async () => {
    const csvContent = `Week,Day,Focus,Main Workout,Accessory,Notes
1,Monday,Strength,"Squat 3x5","Bicep Curls",Good`;

    const mockPlan = { id: "plan-1", userId: mockUserId, name: "Imported Plan", sourceFileName: null, totalWeeks: 1 };
    const mockFullPlan = { ...mockPlan, days: [] };

    vi.mocked(storage.createTrainingPlan).mockResolvedValue(mockPlan as any);
    vi.mocked(storage.createPlanDays).mockResolvedValue([] as any);
    vi.mocked(storage.getTrainingPlan).mockResolvedValue(mockFullPlan as any);

    await importPlanFromCSV(csvContent, mockUserId);

    expect(storage.createPlanDays).toHaveBeenCalledWith([
      {
        planId: "plan-1",
        weekNumber: 1,
        dayName: "Monday",
        focus: "Strength",
        mainWorkout: "Squat 3x5",
        accessory: "Bicep Curls",
        notes: "Good",
      },
    ]);
  });

  it("should use options.planName if provided", async () => {
    const csvContent = `Week,Day,Focus,Main Workout,Accessory/Engine Work,Notes\n1,Monday,Strength,"Squat","",`;
    const mockPlan = { id: "plan-1" };
    vi.mocked(storage.createTrainingPlan).mockResolvedValue(mockPlan as any);
    vi.mocked(storage.getTrainingPlan).mockResolvedValue({} as any);

    await importPlanFromCSV(csvContent, mockUserId, { planName: "My Custom Plan" });

    expect(storage.createTrainingPlan).toHaveBeenCalledWith(expect.objectContaining({
      name: "My Custom Plan",
    }));
  });

  it("should use options.fileName if planName is not provided", async () => {
    const csvContent = `Week,Day,Focus,Main Workout,Accessory/Engine Work,Notes\n1,Monday,Strength,"Squat","",`;
    const mockPlan = { id: "plan-1" };
    vi.mocked(storage.createTrainingPlan).mockResolvedValue(mockPlan as any);
    vi.mocked(storage.getTrainingPlan).mockResolvedValue({} as any);

    await importPlanFromCSV(csvContent, mockUserId, { fileName: "MyFile.csv" });

    expect(storage.createTrainingPlan).toHaveBeenCalledWith(expect.objectContaining({
      name: "MyFile",
      sourceFileName: "MyFile.csv",
    }));
  });
});
