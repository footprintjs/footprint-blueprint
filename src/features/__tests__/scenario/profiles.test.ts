import { describe, it, expect } from "vitest";
import { defineModule } from "../../defineModule.js";
import { defineProfile } from "../../defineProfile.js";
import { createModuleRegistry } from "../../moduleRegistry.js";
import { resolveProfileConfig } from "../../resolveConfig.js";
import { createFeatureGate } from "../../featureGate.js";
import { createTermResolver } from "../../terminology.js";

// ---------------------------------------------------------------------------
// Realistic SIS module definitions
// ---------------------------------------------------------------------------

const students = defineModule({
  id: "students", name: "Student Management", domain: "people",
  terminology: { student: { default: "Student", tutoring: "Learner" } },
  roles: { canEnroll: ["Admin", "Front Desk", "Owner"] },
  seed: { default: { fields: ["name", "dob", "contact"] } },
});

const families = defineModule({
  id: "families", name: "Family & Parent Portal", domain: "people",
  requires: ["students"],
  terminology: { family: { default: "Family" }, parent: { default: "Parent", kindergarten: "Guardian" } },
  roles: { canManage: ["Admin", "Principal"] },
});

const employees = defineModule({
  id: "employees", name: "Employee Management", domain: "people",
  terminology: { employee: { default: "Employee", dance: "Instructor", music: "Tutor" } },
  roles: { canManage: ["Admin", "HR", "Owner"] },
});

const academics = defineModule({
  id: "academics", name: "Academic Structure", domain: "academics",
  requires: ["students"],
  terminology: {
    grade: { default: "Grade", dance: "Level", music: "Level", kindergarten: "Age Group" },
    section: { default: "Section", dance: "Style", music: "Instrument", kindergarten: "Class" },
    subject: { default: "Subject", dance: "Dance Form", music: "Music Type" },
    course: { default: "Course", dance: "Class", music: "Lesson" },
    term: { default: "Term", dance: "Season", music: "Quarter" },
  },
  seed: {
    k12: { grades: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"] },
    dance: { grades: ["Beginner", "Intermediate", "Advanced"] },
    music: { grades: ["Beginner", "Intermediate", "Advanced", "Performance"] },
    kindergarten: { grades: ["Nursery", "LKG", "UKG"] },
  },
});

const attendance = defineModule({
  id: "attendance", name: "Attendance Tracking", domain: "academics",
  requires: ["students", "academics"],
  terminology: {
    session: { default: "Session", dance: "Class Check-in", kindergarten: "Daily Roll Call" },
  },
  roles: { canMark: ["Teacher", "Instructor", "Owner"] },
  seed: {
    k12: { statuses: ["present", "absent", "late", "excused"] },
    dance: { statuses: ["present", "absent", "late"] },
    kindergarten: { statuses: ["present", "absent"] },
    default: { statuses: ["present", "absent"] },
  },
});

const scheduling = defineModule({
  id: "scheduling", name: "Scheduling", domain: "scheduling",
  requires: ["academics", "employees"],
  terminology: {
    period: { default: "Period", dance: "Time Slot", music: "Lesson Slot", kindergarten: "Activity Block" },
  },
  seed: {
    k12: { periods: 7, pattern: "fixed-weekly" },
    dance: { periods: 4, pattern: "recurring-slots" },
    music: { periods: 6, pattern: "appointments" },
  },
});

const fees = defineModule({
  id: "fees", name: "Fee Management", domain: "finance",
  requires: ["students"],
  seed: {
    k12: { model: "per-term", types: ["tuition", "registration", "materials"] },
    dance: { model: "per-class", types: ["class-fee", "costume"] },
    music: { model: "per-lesson", types: ["lesson-fee", "materials"] },
    kindergarten: { model: "monthly", types: ["monthly-fee", "supplies"] },
  },
});

const workflows = defineModule({
  id: "workflows", name: "Workflow Engine", domain: "workflow",
  seed: {
    k12: { templates: ["enrollment-approval", "transfer-request", "leave-application"] },
    dance: { templates: ["registration"] },
    default: { templates: [] },
  },
});

const streams = defineModule({ id: "streams", name: "Streams/Divisions", domain: "academics", requires: ["academics"] });
const departments = defineModule({ id: "departments", name: "Departments", domain: "org" });
const rooms = defineModule({ id: "rooms", name: "Room Management", domain: "scheduling", requires: ["scheduling"] });

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

const k12 = defineProfile({
  type: "k12", displayName: "K-12 School",
  modules: ["students", "families", "employees", "academics", "attendance", "scheduling", "fees", "workflows", "streams", "departments", "rooms"],
  roles: ["Principal", "Vice Principal", "HoD", "Teacher", "Counselor", "Admin", "HR"],
  schedulingPattern: "fixed-timetable",
});

const danceSchool = defineProfile({
  type: "dance", displayName: "Dance School",
  modules: ["students", "employees", "academics", "attendance", "scheduling", "fees"],
  roles: ["Owner", "Instructor", "Front Desk"],
  schedulingPattern: "time-slots",
});

const musicSchool = defineProfile({
  type: "music", displayName: "Music School",
  modules: ["students", "employees", "academics", "attendance", "scheduling", "fees"],
  roles: ["Owner", "Tutor", "Receptionist"],
  schedulingPattern: "appointments",
});

const kindergarten = defineProfile({
  type: "kindergarten", displayName: "Kindergarten",
  modules: ["students", "families", "employees", "academics", "attendance", "fees"],
  roles: ["Principal", "Teacher", "Caretaker", "Admin"],
  schedulingPattern: "activity-blocks",
});

const tutoring = defineProfile({
  type: "tutoring", displayName: "Tutoring Center",
  modules: ["students", "employees", "fees"],
  roles: ["Owner", "Tutor"],
  schedulingPattern: "appointments",
  meta: { maxStudents: 20 },
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = createModuleRegistry({
  modules: [students, families, employees, academics, attendance, scheduling, fees, workflows, streams, departments, rooms],
  profileTypes: [k12, danceSchool, musicSchool, kindergarten, tutoring],
});

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe("K-12 school scenario", () => {
  const config = resolveProfileConfig(registry, "k12");
  const gate = createFeatureGate(config);
  const t = createTermResolver(config.terminology);

  it("enables all 11 modules", () => {
    expect(config.enabledModules.size).toBe(11);
  });

  it("has families and departments", () => {
    expect(gate.isEnabled("families")).toBe(true);
    expect(gate.isEnabled("departments")).toBe(true);
    expect(gate.isEnabled("streams")).toBe(true);
    expect(gate.isEnabled("rooms")).toBe(true);
  });

  it("uses standard K-12 terminology", () => {
    expect(t("grade")).toBe("Grade");
    expect(t("section")).toBe("Section");
    expect(t("subject")).toBe("Subject");
    expect(t("period")).toBe("Period");
    expect(t("session")).toBe("Session");
  });

  it("has K-12 specific seed data", () => {
    expect(config.seed.academics).toEqual({ grades: expect.arrayContaining(["Grade 1", "Grade 12"]) });
    expect(config.seed.fees).toEqual({ model: "per-term", types: ["tuition", "registration", "materials"] });
    expect(config.seed.workflows).toEqual({ templates: ["enrollment-approval", "transfer-request", "leave-application"] });
  });

  it("has full role set", () => {
    expect(config.roles).toContain("Principal");
    expect(config.roles).toContain("Teacher");
    expect(config.roles).toContain("HoD");
    expect(config.roles).toContain("HR");
  });
});

describe("Dance school scenario", () => {
  const config = resolveProfileConfig(registry, "dance");
  const gate = createFeatureGate(config);
  const t = createTermResolver(config.terminology);

  it("enables 6 modules (+ academics as transitive dep)", () => {
    expect(gate.isEnabled("students")).toBe(true);
    expect(gate.isEnabled("employees")).toBe(true);
    expect(gate.isEnabled("academics")).toBe(true);
    expect(gate.isEnabled("attendance")).toBe(true);
    expect(gate.isEnabled("scheduling")).toBe(true);
    expect(gate.isEnabled("fees")).toBe(true);
  });

  it("does NOT have families, departments, streams, rooms, workflows", () => {
    expect(gate.isEnabled("families")).toBe(false);
    expect(gate.isEnabled("departments")).toBe(false);
    expect(gate.isEnabled("streams")).toBe(false);
    expect(gate.isEnabled("rooms")).toBe(false);
    expect(gate.isEnabled("workflows")).toBe(false);
  });

  it("uses dance terminology", () => {
    expect(t("grade")).toBe("Level");
    expect(t("section")).toBe("Style");
    expect(t("subject")).toBe("Dance Form");
    expect(t("period")).toBe("Time Slot");
    expect(t("session")).toBe("Class Check-in");
    expect(t("employee")).toBe("Instructor");
  });

  it("has dance-specific seed data", () => {
    expect(config.seed.academics).toEqual({ grades: ["Beginner", "Intermediate", "Advanced"] });
    expect(config.seed.fees).toEqual({ model: "per-class", types: ["class-fee", "costume"] });
    expect(config.seed.attendance).toEqual({ statuses: ["present", "absent", "late"] });
  });
});

describe("Kindergarten scenario", () => {
  const config = resolveProfileConfig(registry, "kindergarten");
  const gate = createFeatureGate(config);
  const t = createTermResolver(config.terminology);

  it("has families but NOT scheduling", () => {
    expect(gate.isEnabled("families")).toBe(true);
    expect(gate.isEnabled("scheduling")).toBe(false);
  });

  it("uses kindergarten terminology", () => {
    expect(t("grade")).toBe("Age Group");
    expect(t("section")).toBe("Class");
    expect(t("session")).toBe("Daily Roll Call");
    expect(t("parent")).toBe("Guardian");
  });

  it("has simple attendance statuses", () => {
    expect(config.seed.attendance).toEqual({ statuses: ["present", "absent"] });
  });
});

describe("Tutoring center scenario", () => {
  const config = resolveProfileConfig(registry, "tutoring");
  const gate = createFeatureGate(config);

  it("has minimal modules", () => {
    expect(gate.isEnabled("students")).toBe(true);
    expect(gate.isEnabled("employees")).toBe(true);
    expect(gate.isEnabled("fees")).toBe(true);
  });

  it("does NOT have academics, attendance, scheduling", () => {
    expect(gate.isEnabled("academics")).toBe(false);
    expect(gate.isEnabled("attendance")).toBe(false);
    expect(gate.isEnabled("scheduling")).toBe(false);
  });

  it("has only 3 modules", () => {
    expect(config.enabledModules.size).toBe(3);
  });

  it("uses 'Learner' for student", () => {
    const t = createTermResolver(config.terminology);
    expect(t("student")).toBe("Learner");
  });
});

describe("Module override scenario", () => {
  it("allows a dance school to add workflows", () => {
    const config = resolveProfileConfig(registry, "dance", [
      "students", "employees", "academics", "attendance", "scheduling", "fees", "workflows",
    ]);

    const gate = createFeatureGate(config);
    expect(gate.isEnabled("workflows")).toBe(true);
    expect(config.seed.workflows).toEqual({ templates: ["registration"] }); // dance-specific workflow seed
  });

  it("allows a tutoring center to add attendance", () => {
    const config = resolveProfileConfig(registry, "tutoring", [
      "students", "employees", "fees", "attendance",
    ]);

    const gate = createFeatureGate(config);
    expect(gate.isEnabled("attendance")).toBe(true);
    expect(gate.isEnabled("academics")).toBe(true); // transitive dep
  });
});

describe("Registry validation scenario", () => {
  it("passes validation for full registry", () => {
    const errors = registry.validate();
    expect(errors).toEqual([]);
  });
});
