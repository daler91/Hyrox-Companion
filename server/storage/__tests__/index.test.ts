import { describe, it, expect } from "vitest";
import { storage } from "../index";
import fs from "fs";
import path from "path";

describe("DatabaseStorage delegation", () => {
  it("should implement all methods defined in IStorage interface", () => {
    // Read the IStorage.ts file to extract method names
    const iStoragePath = path.join(__dirname, "../IStorage.ts");
    const content = fs.readFileSync(iStoragePath, "utf-8");

    // Simple regex to find method declarations in the interface
    // Looks for patterns like "methodName(args): Promise<Type>;"
    const methodRegex = /^\s*([a-zA-Z0-9_]+)\s*\(/gm;
    let match;
    const methods: string[] = [];

    while ((match = methodRegex.exec(content)) !== null) {
      methods.push(match[1]);
    }

    expect(methods.length).toBeGreaterThan(0);

    // Check that each method is available as a function on the storage object
    for (const method of methods) {
      // storage is typed as IStorage, but we need to access dynamically
      const storageAny = storage as any;

      expect(typeof storageAny[method]).toBe("function", `Method ${method} is missing or not a function on DatabaseStorage proxy`);
    }
  });

  it("should return undefined for non-existent properties", () => {
    const storageAny = storage as any;
    expect(storageAny.nonExistentMethod).toBeUndefined();
  });
});
