import { describe, expect, it } from "vitest";
import { canUseCustomerTransfer } from "./guard";

const activeAdmin = {
  role: "ADMIN",
  isActive: true,
  permissions: [],
  roleDefinition: { permissions: [] },
};

describe("kundeoverføring: administratorkontroll", () => {
  it("slipper inn aktiv administrator med settings.manage", () => {
    expect(
      canUseCustomerTransfer({
        ...activeAdmin,
        permissions: ["settings.manage"],
      }),
    ).toBe(true);
  });

  it("avviser inaktiv administrator", () => {
    expect(
      canUseCustomerTransfer({
        ...activeAdmin,
        isActive: false,
        permissions: ["settings.manage"],
      }),
    ).toBe(false);
  });

  it("avviser kontor selv om de har settings.manage", () => {
    expect(
      canUseCustomerTransfer({
        role: "OFFICE",
        isActive: true,
        permissions: ["settings.manage"],
        roleDefinition: { permissions: ["settings.manage"] },
      }),
    ).toBe(false);
  });

  it("avviser montør og kundeportal", () => {
    expect(
      canUseCustomerTransfer({
        role: "TECHNICIAN",
        isActive: true,
        permissions: ["settings.manage"],
      }),
    ).toBe(false);
    expect(
      canUseCustomerTransfer({
        role: "CUSTOMER",
        isActive: true,
        permissions: ["settings.manage"],
      }),
    ).toBe(false);
  });

  it("avviser manglende eller deaktivert bruker", () => {
    expect(canUseCustomerTransfer(null)).toBe(false);
    expect(canUseCustomerTransfer({ role: "ADMIN", isActive: false })).toBe(false);
  });
});
