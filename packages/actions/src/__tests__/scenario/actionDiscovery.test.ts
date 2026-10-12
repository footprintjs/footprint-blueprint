import { createMCPExporter } from '../../exporters.js';
import { describe, it, expect } from "vitest";
import { createActionRegistry } from "../../actionRegistry.js";
import { createActionExecutor } from "../../actionExecutor.js";
import type { ActionDefinition } from "../../types.js";

/**
 * Scenario: A platform has multiple domains with actions gated by modules.
 * Different school profiles enable different modules, so each profile
 * discovers a different subset of available actions (and MCP tools).
 */

const createStudent: ActionDefinition = {
  id: "create-student",
  name: "Create Student",
  description: "Register a new student",
  domain: "people",
  category: "crud",
  parameters: [
    { name: "name", type: "string", required: true, description: "Full name" },
    { name: "email", type: "string", required: false, description: "Email address" },
  ],
  requiredModules: ["students"],
};

const markAttendance: ActionDefinition = {
  id: "mark-attendance",
  name: "Mark Attendance",
  description: "Record student attendance for a session",
  domain: "academics",
  category: "workflow",
  parameters: [
    { name: "studentId", type: "string", required: true, description: "Student ID" },
    { name: "sessionId", type: "string", required: true, description: "Session ID" },
    { name: "present", type: "boolean", required: true, description: "Whether present" },
  ],
  requiredModules: ["students", "attendance"],
};

const scheduleClass: ActionDefinition = {
  id: "schedule-class",
  name: "Schedule Class",
  description: "Schedule a class session",
  domain: "scheduling",
  category: "workflow",
  parameters: [
    { name: "className", type: "string", required: true, description: "Class name" },
    { name: "startTime", type: "string", required: true, description: "Start time ISO" },
  ],
  requiredModules: ["scheduling"],
  capabilityId: "schedule-class",
};

const processFee: ActionDefinition = {
  id: "process-fee",
  name: "Process Fee",
  description: "Process a student fee payment",
  domain: "finance",
  category: "workflow",
  parameters: [
    { name: "studentId", type: "string", required: true, description: "Student ID" },
    { name: "amount", type: "number", required: true, description: "Payment amount" },
  ],
  requiredModules: ["students", "fees"],
};

const generateReport: ActionDefinition = {
  id: "generate-report",
  name: "Generate Report",
  description: "Generate a system report",
  domain: "admin",
  category: "report",
  parameters: [
    { name: "reportType", type: "string", required: true, description: "Type of report" },
  ],
  requiredModules: [],
};

const allActions = [createStudent, markAttendance, scheduleClass, processFee, generateReport];

describe("scenario: action discovery per school profile", () => {
  const registry = createActionRegistry({ actions: allActions });

  it("K-12 school sees full action set", () => {
    const k12Modules = new Set(["students", "attendance", "scheduling", "fees"]);
    const tools = registry.exportMetadata(k12Modules, createMCPExporter());

    expect(tools).toHaveLength(5);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("create-student");
    expect(toolNames).toContain("mark-attendance");
    expect(toolNames).toContain("schedule-class");
    expect(toolNames).toContain("process-fee");
    expect(toolNames).toContain("generate-report");
  });

  it("dance school without fees sees reduced set", () => {
    const danceModules = new Set(["students", "attendance", "scheduling"]);
    const tools = registry.exportMetadata(danceModules, createMCPExporter());

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("create-student");
    expect(toolNames).toContain("mark-attendance");
    expect(toolNames).toContain("schedule-class");
    expect(toolNames).not.toContain("process-fee");
    expect(toolNames).toContain("generate-report");
  });

  it("minimal school with only students sees student actions + reports", () => {
    const minModules = new Set(["students"]);
    const tools = registry.exportMetadata(minModules, createMCPExporter());

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("create-student");
    expect(toolNames).not.toContain("mark-attendance");
    expect(toolNames).not.toContain("schedule-class");
    expect(toolNames).not.toContain("process-fee");
    expect(toolNames).toContain("generate-report");
  });

  it("domain filtering narrows within discovered actions", () => {
    const peopleActions = registry.forDomain("people");
    expect(peopleActions).toHaveLength(1);
    expect(peopleActions[0]!.id).toBe("create-student");

    const academicActions = registry.forDomain("academics");
    expect(academicActions).toHaveLength(1);
    expect(academicActions[0]!.id).toBe("mark-attendance");
  });

  it("module filtering finds all actions requiring a module", () => {
    const studentActions = registry.forModule("students");
    expect(studentActions).toHaveLength(3); // create-student, mark-attendance, process-fee
  });

  it("MCP tools have valid JSON Schema structure", () => {
    const tools = registry.exportMetadata(new Set(["students", "attendance", "scheduling", "fees"]), createMCPExporter());

    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.inputSchema.properties).toBe("object");
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);

      // All required params exist in properties
      for (const reqName of tool.inputSchema.required) {
        expect(tool.inputSchema.properties).toHaveProperty(reqName);
      }
    }
  });

  it("executor can handle discovered actions", async () => {
    const executor = createActionExecutor(registry, undefined, { authorizer: () => true });

    const result = await executor.execute(
      "create-student",
      { name: "Alice" },
      { profileType: "k12", unitId: "school-1" },
      async (_id, input) => ({ created: true, ...(input as object) }),
    );

    expect(result.status).toBe("success");
    expect((result.result as Record<string, unknown>).created).toBe(true);
    expect(result.trace!.profileType).toBe("k12");
  });
});
