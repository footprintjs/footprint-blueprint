import { describe, it, expect } from "vitest";
import { defineProfile } from "../../defineProfile.js";

describe("defineProfile", () => {
  it("creates a valid profile definition", () => {
    const st = defineProfile({
      type: "k12",
      displayName: "K-12 School",
      modules: ["students", "academics", "attendance"],
    });

    expect(st.type).toBe("k12");
    expect(st.displayName).toBe("K-12 School");
    expect(st.modules).toEqual(["students", "academics", "attendance"]);
    expect(st.roles).toEqual([]);
    expect(st.schedulingPattern).toBe("default");
    expect(st.meta).toEqual({});
  });

  it("preserves all provided fields", () => {
    const st = defineProfile({
      type: "dance",
      displayName: "Dance School",
      modules: ["students", "attendance"],
      roles: ["Owner", "Instructor", "Front Desk"],
      schedulingPattern: "time-slots",
      meta: { maxStudents: 50 },
    });

    expect(st.roles).toEqual(["Owner", "Instructor", "Front Desk"]);
    expect(st.schedulingPattern).toBe("time-slots");
    expect(st.meta).toEqual({ maxStudents: 50 });
  });

  it("returns a frozen object", () => {
    const st = defineProfile({ type: "k12", displayName: "K-12", modules: ["students"] });

    expect(Object.isFrozen(st)).toBe(true);
    expect(Object.isFrozen(st.modules)).toBe(true);
    expect(Object.isFrozen(st.roles)).toBe(true);
    expect(Object.isFrozen(st.meta)).toBe(true);
  });

  it("throws on empty type", () => {
    expect(() => defineProfile({ type: "", displayName: "X", modules: ["x"] })).toThrow();
  });

  it("throws on missing displayName", () => {
    expect(() => defineProfile({ type: "x", displayName: "", modules: ["x"] })).toThrow();
  });

  it("throws on empty modules array", () => {
    expect(() => defineProfile({ type: "x", displayName: "X", modules: [] })).toThrow("at least one");
  });

  it("throws on type with uppercase letters", () => {
    expect(() => defineProfile({ type: "K12", displayName: "X", modules: ["x"] })).toThrow();
  });

  it("allows hyphens in type", () => {
    const st = defineProfile({ type: "after-school", displayName: "After School", modules: ["students"] });
    expect(st.type).toBe("after-school");
  });
});
