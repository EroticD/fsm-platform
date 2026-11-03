import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

import WorkforceSettingsTab from "./WorkforceSettingsTab";

const action = async () => undefined;

function props(overrides: Record<string, unknown> = {}) {
  return {
    skills: [
      {
        id: "skill-1",
        key: "hms.sja",
        label: "SJA",
        category: "HMS",
        userCount: 1,
        workOrderCount: 2,
      },
    ],
    staff: [
      {
        id: "staff-1",
        name: "Ola Montør",
        email: "ola@example.test",
        departmentId: "dep-a",
        departmentName: "Hovedavdeling",
      },
    ],
    departments: [{ id: "dep-a", name: "Hovedavdeling" }],
    selectedStaffId: "staff-1",
    userSkills: [
      {
        skillId: "skill-1",
        key: "hms.sja",
        label: "SJA",
        category: "HMS",
        level: 3,
        validUntil: new Date("2027-12-31T00:00:00.000Z"),
      },
    ],
    availability: [
      { id: "av-1", weekday: 0, startMinute: 480, endMinute: 960 },
    ],
    absences: [
      {
        id: "absence-1",
        userId: "staff-1",
        startsAt: new Date("2026-11-02T08:00:00.000Z"),
        endsAt: new Date("2026-11-02T16:00:00.000Z"),
        kind: "FERIE",
        note: "Høstferie",
      },
    ],
    capacityPlans: [
      {
        id: "plan-1",
        departmentId: "dep-a",
        departmentName: "Hovedavdeling",
        date: "2026-11-02",
        technicianId: null,
        technicianName: null,
        capacityMinutes: 480,
      },
    ],
    capacityDepartmentId: "dep-a",
    capacityFrom: "2026-11-02",
    capacityTo: "2026-11-08",
    canReadSkills: true,
    canManageUsers: true,
    canManageDispatch: true,
    createSkill: action,
    updateSkill: action,
    deleteSkill: action,
    setUserSkills: action,
    saveAvailability: action,
    createAbsence: action,
    updateAbsence: action,
    deleteAbsence: action,
    saveCapacityPlan: action,
    deleteCapacityPlan: action,
    ...overrides,
  };
}

async function render(overrides: Record<string, unknown> = {}) {
  const element = await WorkforceSettingsTab(props(overrides) as never);
  return renderToStaticMarkup(element);
}

describe("WorkforceSettingsTab", () => {
  it("viser katalog, ansattes kompetanse, fravær og kapasitetsplaner", async () => {
    const html = await render();

    expect(html).toContain("settings.workforce.skills.title");
    expect(html).toContain("settings.workforce.staff.title");
    expect(html).toContain("Ola Montør");
    expect(html).toContain("settings.workforce.userSkills.title");
    expect(html).toContain("settings.workforce.availability.title");
    expect(html).toContain("settings.workforce.absences.title");
    expect(html).toContain("Høstferie");
    expect(html).toContain("settings.workforce.capacity.title");
    expect(html).toContain("2026-11-02");
    // Nivå og gyldighetsdato er forhåndsutfylt fra tjenestelaget.
    expect(html).toContain('value="3"');
    expect(html).toContain('value="2027-12-31"');
    // Arbeidstid vises som lokal tid.
    expect(html).toContain('value="08:00"');
    expect(html).toContain('value="16:00"');
  });

  it("skjuler redigering for brukere som bare har lesetilgang", async () => {
    const html = await render({ canManageUsers: false });

    expect(html).toContain("settings.workforce.readOnlyHint");
    expect(html).not.toContain("settings.workforce.skills.create");
    expect(html).not.toContain("settings.workforce.absences.create");
    expect(html).toContain("settings.workforce.userSkills.hidden");
  });

  it("viser ikke kapasitetsplaner uten dispatch.configure", async () => {
    const html = await render({ canManageDispatch: false, capacityPlans: [] });

    expect(html).not.toContain("settings.workforce.capacity.title");
  });

  it("viser tom-tilstander uten ansatte og kompetanser", async () => {
    const html = await render({
      staff: [],
      selectedStaffId: null,
      skills: [],
      capacityPlans: [],
    });

    expect(html).toContain("settings.workforce.staff.noStaff");
    expect(html).toContain("settings.workforce.skills.empty");
    expect(html).toContain("settings.workforce.capacity.empty");
  });
});
