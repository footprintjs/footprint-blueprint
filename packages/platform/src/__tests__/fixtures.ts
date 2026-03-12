/**
 * Shared test fixtures for @footprint/platform tests.
 *
 * Realistic SIS modules, profiles, adapters, and actions.
 */

import { defineModule, defineProfile, createModuleRegistry } from "@footprint/features";
import type { ModuleRegistry } from "@footprint/features";
import { createMemoryProfileStore } from "@footprint/tenancy";
import type { ProfileStore } from "@footprint/tenancy";
import { createAdapterRegistry } from "@footprint/adapters";
import type { AdapterRegistry, Adapter } from "@footprint/adapters";
import { createActionRegistry } from "@footprint/actions";
import type { ActionRegistry, ActionDefinition } from "@footprint/actions";

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export const studentsModule = defineModule({
  id: "students",
  name: "Student Management",
  domain: "people",
  description: "Core student records and enrollment",
  terminology: {
    student: { default: "Student", dance: "Dancer" },
    enrollment: { default: "Enrollment", dance: "Registration" },
  },
  seed: {
    default: { statuses: ["active", "inactive", "graduated"] },
    dance: { statuses: ["active", "on-break", "dropped"] },
  },
  roles: {
    canView: ["Admin", "Teacher"],
    canEdit: ["Admin"],
  },
});

export const employeesModule = defineModule({
  id: "employees",
  name: "Employee Management",
  domain: "people",
  description: "Staff and instructor records",
  terminology: {
    employee: { default: "Employee", dance: "Instructor" },
  },
  seed: {
    default: { departments: ["Admin", "Teaching"] },
    dance: { departments: ["Instruction", "Front Desk"] },
  },
  roles: {
    canView: ["Admin"],
    canEdit: ["Admin"],
  },
});

export const attendanceModule = defineModule({
  id: "attendance",
  name: "Attendance Tracking",
  domain: "academics",
  description: "Track student attendance per session",
  requires: ["students"],
  terminology: {
    session: { default: "Session", dance: "Check-in" },
    period: { default: "Period", dance: "Class Time" },
  },
  seed: {
    default: { statuses: ["present", "absent", "late", "excused"] },
    dance: { statuses: ["present", "absent", "make-up"] },
  },
  roles: {
    canMark: ["Admin", "Teacher"],
  },
});

export const feesModule = defineModule({
  id: "fees",
  name: "Fee Management",
  domain: "finance",
  description: "Tuition and fee billing",
  requires: ["students"],
  terminology: {
    fee: { default: "Fee", dance: "Tuition" },
    invoice: { default: "Invoice", dance: "Statement" },
  },
  seed: {
    default: { categories: ["tuition", "lab", "library"] },
    dance: { categories: ["monthly-tuition", "costume", "recital"] },
  },
  roles: {
    canBill: ["Admin"],
    canView: ["Admin", "Parent"],
  },
});

export const schedulingModule = defineModule({
  id: "scheduling",
  name: "Scheduling",
  domain: "academics",
  description: "Class and session scheduling",
  requires: ["students", "employees"],
  terminology: {
    schedule: { default: "Schedule", dance: "Class Schedule" },
    slot: { default: "Period", dance: "Time Slot" },
  },
  seed: {
    default: { periods: 8 },
    dance: { slots: ["morning", "afternoon", "evening"] },
  },
  roles: {
    canSchedule: ["Admin"],
  },
});

export const gradesModule = defineModule({
  id: "grades",
  name: "Grading",
  domain: "academics",
  description: "Student grade tracking and report cards",
  requires: ["students", "attendance"],
  terminology: {
    grade: { default: "Grade", dance: "Level" },
    reportCard: { default: "Report Card", dance: "Progress Report" },
  },
  seed: {
    default: { scale: ["A", "B", "C", "D", "F"] },
    dance: { scale: ["Beginner", "Intermediate", "Advanced", "Pre-Professional"] },
  },
  roles: {
    canGrade: ["Admin", "Teacher"],
  },
});

export const allModules = [
  studentsModule,
  employeesModule,
  attendanceModule,
  feesModule,
  schedulingModule,
  gradesModule,
];

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export const danceProfile = defineProfile({
  type: "dance",
  displayName: "Dance School",
  modules: ["students", "employees", "attendance", "fees", "scheduling"],
  roles: ["Owner", "Instructor", "Front Desk"],
  schedulingPattern: "time-slots",
});

export const k12Profile = defineProfile({
  type: "k12",
  displayName: "K-12 School",
  modules: ["students", "employees", "attendance", "fees", "scheduling", "grades"],
  roles: ["Principal", "Teacher", "Counselor", "Parent"],
  schedulingPattern: "fixed-timetable",
});

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function createTestRegistry(): ModuleRegistry {
  return createModuleRegistry({
    modules: allModules,
    profileTypes: [danceProfile, k12Profile],
  });
}

export function createTestProfileStore(): ProfileStore & {
  addBinding(binding: { unitId: string; profileType: string; createdAt: string }): void;
} {
  return createMemoryProfileStore([
    { unitId: "dance-studio-1", profileType: "dance", createdAt: "2024-01-01" },
    { unitId: "k12-school-1", profileType: "k12", createdAt: "2024-01-01" },
  ]);
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

const enrollAdapter: Adapter = {
  id: "default-enroll",
  name: "Default Enrollment",
  capabilityId: "enroll",
  async execute(input: unknown, _context) {
    const data = input as { studentName: string };
    return { enrolled: true, studentName: data.studentName, id: "stu-001" };
  },
};

const danceEnrollAdapter: Adapter = {
  id: "dance-enroll",
  name: "Dance Enrollment",
  capabilityId: "enroll",
  async execute(input: unknown, _context) {
    const data = input as { studentName: string };
    return { registered: true, dancerName: data.studentName, id: "dnc-001" };
  },
};

const scheduleAdapter: Adapter = {
  id: "fixed-timetable",
  name: "Fixed Timetable Scheduler",
  capabilityId: "schedule",
  async execute(input: unknown, _context) {
    const data = input as { className: string };
    return { scheduled: true, className: data.className, pattern: "fixed" };
  },
};

const timeSlotsAdapter: Adapter = {
  id: "time-slots",
  name: "Time Slots Scheduler",
  capabilityId: "schedule",
  async execute(input: unknown, _context) {
    const data = input as { className: string };
    return { scheduled: true, className: data.className, pattern: "slots" };
  },
};

export function createTestAdapterRegistry(): AdapterRegistry {
  return createAdapterRegistry({
    capabilities: [
      { id: "enroll", name: "Enroll Student", domain: "people", description: "Enroll a student into the system" },
      { id: "schedule", name: "Schedule Class", domain: "scheduling", description: "Schedule a class session" },
    ],
    adapters: [enrollAdapter, danceEnrollAdapter, scheduleAdapter, timeSlotsAdapter],
    mappings: [
      { capabilityId: "enroll", profileAdapters: { k12: "default-enroll", dance: "dance-enroll" } },
      { capabilityId: "schedule", profileAdapters: { k12: "fixed-timetable", dance: "time-slots" } },
    ],
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const enrollStudentAction: ActionDefinition = {
  id: "enroll-student",
  name: "Enroll Student",
  description: "Enroll a new student into the system",
  domain: "people",
  category: "crud",
  capabilityId: "enroll",
  parameters: [
    { name: "studentName", type: "string", required: true, description: "Full name of the student" },
  ],
  requiredModules: ["students"],
};

export const scheduleClassAction: ActionDefinition = {
  id: "schedule-class",
  name: "Schedule Class",
  description: "Schedule a new class session",
  domain: "scheduling",
  category: "workflow",
  capabilityId: "schedule",
  parameters: [
    { name: "className", type: "string", required: true, description: "Name of the class" },
    { name: "time", type: "string", required: true, description: "Preferred time slot" },
  ],
  requiredModules: ["scheduling"],
};

export const gradeStudentAction: ActionDefinition = {
  id: "grade-student",
  name: "Grade Student",
  description: "Assign a grade to a student",
  domain: "academics",
  category: "workflow",
  parameters: [
    { name: "studentId", type: "string", required: true, description: "Student ID" },
    { name: "grade", type: "string", required: true, description: "Grade to assign" },
  ],
  requiredModules: ["grades"],
};

export function createTestActionRegistry(): ActionRegistry {
  return createActionRegistry({
    actions: [enrollStudentAction, scheduleClassAction, gradeStudentAction],
  });
}
