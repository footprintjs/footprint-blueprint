import { describe, it, expect } from "vitest";
import { defineModule } from "../../defineModule.js";
import { resolveTerminology, createTermResolver } from "../../terminology.js";

const academics = defineModule({
  id: "academics",
  name: "Academics",
  domain: "academics",
  terminology: {
    grade: { default: "Grade", dance: "Level", kindergarten: "Age Group" },
    section: { default: "Section", dance: "Style", kindergarten: "Class" },
    subject: { default: "Subject", dance: "Dance Form" },
  },
});

const attendance = defineModule({
  id: "attendance",
  name: "Attendance",
  domain: "academics",
  terminology: {
    session: { default: "Session", dance: "Check-in", kindergarten: "Roll Call" },
    present: { default: "Present" },
    absent: { default: "Absent" },
  },
});

describe("resolveTerminology", () => {
  it("resolves school-type-specific labels", () => {
    const terms = resolveTerminology("dance", [academics, attendance]);

    expect(terms.grade).toBe("Level");
    expect(terms.section).toBe("Style");
    expect(terms.subject).toBe("Dance Form");
    expect(terms.session).toBe("Check-in");
  });

  it("falls back to default when no school-type label", () => {
    const terms = resolveTerminology("dance", [academics, attendance]);

    expect(terms.present).toBe("Present");
    expect(terms.absent).toBe("Absent");
  });

  it("resolves for a different profile", () => {
    const terms = resolveTerminology("kindergarten", [academics, attendance]);

    expect(terms.grade).toBe("Age Group");
    expect(terms.section).toBe("Class");
    expect(terms.session).toBe("Roll Call");
    expect(terms.subject).toBe("Subject"); // falls back to default
  });

  it("uses default for unknown profile", () => {
    const terms = resolveTerminology("unknown-type", [academics]);

    expect(terms.grade).toBe("Grade");
    expect(terms.section).toBe("Section");
  });

  it("returns empty object for modules with no terminology", () => {
    const plain = defineModule({ id: "plain", name: "Plain", domain: "x" });
    const terms = resolveTerminology("dance", [plain]);
    expect(terms).toEqual({});
  });

  it("merges terminology from multiple modules", () => {
    const terms = resolveTerminology("dance", [academics, attendance]);

    // From academics
    expect(terms.grade).toBe("Level");
    // From attendance
    expect(terms.session).toBe("Check-in");
  });
});

describe("createTermResolver", () => {
  it("resolves known keys", () => {
    const t = createTermResolver({ grade: "Level", session: "Check-in" });
    expect(t("grade")).toBe("Level");
    expect(t("session")).toBe("Check-in");
  });

  it("returns key itself for unknown keys", () => {
    const t = createTermResolver({ grade: "Level" });
    expect(t("unknown")).toBe("unknown");
  });

  it("handles empty terminology", () => {
    const t = createTermResolver({});
    expect(t("anything")).toBe("anything");
  });
});
