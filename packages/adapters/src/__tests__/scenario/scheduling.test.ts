import { describe, it, expect } from "vitest";
import { createAdapterRegistry } from "../../adapterRegistry.js";
import { createServiceBridge } from "../../serviceBridge.js";
import type { Capability, Adapter, AdapterMapping } from "../../types.js";

// ---------------------------------------------------------------------------
// Realistic scheduling scenario: K-12 vs Dance vs Music
// ---------------------------------------------------------------------------

const scheduleCapability: Capability = {
  id: "schedule-class", name: "Schedule Class", domain: "scheduling",
  description: "Create a class schedule",
};
const paymentCapability: Capability = {
  id: "process-payment", name: "Process Payment", domain: "finance",
  description: "Process a fee payment",
};

// Scheduling adapters — different implementations per school type
const fixedTimetable: Adapter = {
  id: "fixed-timetable", name: "Fixed Weekly Timetable", capabilityId: "schedule-class",
  async execute(input: any) {
    return {
      type: "fixed",
      periods: input.periods ?? 7,
      pattern: "Mon-Fri recurring",
    };
  },
};

const timeSlotScheduler: Adapter = {
  id: "time-slots", name: "Time Slot Scheduler", capabilityId: "schedule-class",
  async execute(input: any) {
    return {
      type: "slots",
      slots: input.slots ?? ["6pm-7pm", "7pm-8pm"],
      pattern: "recurring weekly slots",
    };
  },
};

const appointmentScheduler: Adapter = {
  id: "appointments", name: "Appointment Scheduler", capabilityId: "schedule-class",
  async execute(input: any) {
    return {
      type: "appointment",
      duration: input.duration ?? 30,
      pattern: "individual bookings",
    };
  },
};

// Payment adapters
const termPayment: Adapter = {
  id: "term-payment", name: "Per-Term Payment", capabilityId: "process-payment",
  async execute(input: any) {
    return { model: "per-term", amount: input.amount, term: input.term };
  },
};

const classPayment: Adapter = {
  id: "class-payment", name: "Per-Class Payment", capabilityId: "process-payment",
  async execute(input: any) {
    return { model: "per-class", amount: input.amount, classes: input.classes };
  },
};

const registry = createAdapterRegistry({
  capabilities: [scheduleCapability, paymentCapability],
  adapters: [fixedTimetable, timeSlotScheduler, appointmentScheduler, termPayment, classPayment],
  mappings: [
    {
      capabilityId: "schedule-class",
      profileAdapters: { k12: "fixed-timetable", dance: "time-slots", music: "appointments" },
    },
    {
      capabilityId: "process-payment",
      profileAdapters: { k12: "term-payment", dance: "class-payment", music: "class-payment" },
      defaultAdapterId: "term-payment",
    },
  ],
});

const bridge = createServiceBridge(registry);

describe("scenario: K-12 scheduling and payment", () => {
  it("uses fixed timetable for scheduling", async () => {
    const result = await bridge.execute("schedule-class", { periods: 8 }, { profileType: "k12", unitId: "lincoln-high" });
    expect(result.status).toBe("success");
    expect((result.result as any).type).toBe("fixed");
    expect((result.result as any).periods).toBe(8);
  });

  it("uses per-term payment", async () => {
    const result = await bridge.execute("process-payment", { amount: 500, term: "Fall 2024" }, { profileType: "k12", unitId: "lincoln-high" });
    expect(result.status).toBe("success");
    expect((result.result as any).model).toBe("per-term");
  });
});

describe("scenario: dance school scheduling and payment", () => {
  it("uses time slot scheduler", async () => {
    const result = await bridge.execute("schedule-class", { slots: ["5pm-6pm"] }, { profileType: "dance", unitId: "rhythm-studio" });
    expect(result.status).toBe("success");
    expect((result.result as any).type).toBe("slots");
  });

  it("uses per-class payment", async () => {
    const result = await bridge.execute("process-payment", { amount: 25, classes: 10 }, { profileType: "dance", unitId: "rhythm-studio" });
    expect(result.status).toBe("success");
    expect((result.result as any).model).toBe("per-class");
  });
});

describe("scenario: music school with appointments", () => {
  it("uses appointment scheduler", async () => {
    const result = await bridge.execute("schedule-class", { duration: 45 }, { profileType: "music", unitId: "harmony-school" });
    expect(result.status).toBe("success");
    expect((result.result as any).type).toBe("appointment");
    expect((result.result as any).duration).toBe(45);
  });
});

describe("scenario: unknown profile falls back to default", () => {
  it("uses default payment adapter for unknown profile", async () => {
    const result = await bridge.execute("process-payment", { amount: 100 }, { profileType: "tutoring", unitId: "tutor-center" });
    expect(result.status).toBe("success");
    expect((result.result as any).model).toBe("per-term"); // default
  });

  it("returns no-adapter for scheduling without default", async () => {
    const result = await bridge.execute("schedule-class", {}, { profileType: "tutoring", unitId: "tutor-center" });
    expect(result.status).toBe("no-adapter");
  });
});

describe("scenario: capability discovery per profile", () => {
  it("K-12 has both capabilities", () => {
    const caps = bridge.availableCapabilities("k12");
    expect(caps).toContain("schedule-class");
    expect(caps).toContain("process-payment");
  });

  it("tutoring only has payment (via default)", () => {
    const caps = bridge.availableCapabilities("tutoring");
    expect(caps).toContain("process-payment");
    expect(caps).not.toContain("schedule-class");
  });
});
