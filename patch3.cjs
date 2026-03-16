const fs = require('fs');

let content = fs.readFileSync('server/services/planService.test.ts', 'utf8');

const tests = `
  describe("updatePlanDayWithCleanup", () => {
    const dayId = "test-day-id";
    const userId = "test-user-id";

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should call storage.updatePlanDay when mainWorkout is not updated", async () => {
      const updates = { focus: "New Focus" };
      const expectedResult = { id: dayId, focus: "New Focus" };

      vi.mocked(storage.updatePlanDay).mockResolvedValue(expectedResult as any);

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(storage.updatePlanDay).toHaveBeenCalledTimes(1);
      expect(storage.updatePlanDay).toHaveBeenCalledWith(dayId, updates, userId);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });

    it("should handle mainWorkout update when no linked log exists", async () => {
      const updates = { mainWorkout: "New Workout" };
      const expectedResult = { id: dayId, mainWorkout: "New Workout" };

      // Mock db.transaction to execute the callback immediately
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // No linked log
        innerJoin: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([expectedResult]),
      };

      // We need to mock the second select differently from the first
      mockTx.select = vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValue([]), // linked log select
            })
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            innerJoin: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockResolvedValue([{ planDay: { id: dayId } }]) // day existence select
            })
          })
        });

      vi.mocked(db.transaction).mockImplementation(async (callback) => {
        return await callback(mockTx as any);
      });

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.delete).not.toHaveBeenCalled();
      expect(mockTx.update).toHaveBeenCalledWith(planDays);
      expect(result).toEqual(expectedResult);
    });

    it("should delete exercise sets when mainWorkout is updated and linked log exists", async () => {
      const updates = { mainWorkout: "New Workout" };
      const expectedResult = { id: dayId, mainWorkout: "New Workout" };
      const mockLinkedLog = { id: "log-id" };

      const mockTx = {
        select: vi.fn(),
        delete: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([expectedResult]),
      };

      mockTx.select = vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValue([mockLinkedLog]), // return a linked log
            })
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            innerJoin: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockResolvedValue([{ planDay: { id: dayId } }]) // day existence select
            })
          })
        });

      vi.mocked(db.transaction).mockImplementation(async (callback) => {
        return await callback(mockTx as any);
      });

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.delete).toHaveBeenCalledWith(exerciseSets);
      expect(mockTx.update).toHaveBeenCalledWith(planDays);
      expect(result).toEqual(expectedResult);
    });

    it("should return undefined if planDay does not exist or does not belong to user", async () => {
      const updates = { mainWorkout: "New Workout" };

      const mockTx = {
        select: vi.fn(),
        delete: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };

      mockTx.select = vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValue([]), // no linked log
            })
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            innerJoin: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockResolvedValue([]) // EMPTY day existence result
            })
          })
        });

      vi.mocked(db.transaction).mockImplementation(async (callback) => {
        return await callback(mockTx as any);
      });

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.update).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });
});`;

content = content.replace(/^}\);\s*$/m, tests);

fs.writeFileSync('server/services/planService.test.ts', content);
