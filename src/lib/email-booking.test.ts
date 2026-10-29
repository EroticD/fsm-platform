import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    branding: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
  },
  sendMail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: mocks.sendMail }),
  },
}));

import { sendBookingNotification } from "./email";

type OfficeUser = {
  email: string | null;
  departmentId: string;
  role: string;
  isActive: boolean;
};

const officeUsers: OfficeUser[] = [
  {
    email: "kontor-a@example.test",
    departmentId: "dep-a",
    role: "OFFICE",
    isActive: true,
  },
  {
    email: "admin-a@example.test",
    departmentId: "dep-a",
    role: "ADMIN",
    isActive: true,
  },
  {
    email: "kontor-b@example.test",
    departmentId: "dep-b",
    role: "OFFICE",
    isActive: true,
  },
];

const booking = {
  title: "Årlig service",
  description: "Trenger service.",
  customerName: "Kunde AS",
  bookedBy: "Kari",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMTP_USER = "smtp@example.test";
  process.env.SMTP_PASS = "hemmelig";

  mocks.prisma.branding.findFirst.mockResolvedValue(null);
  mocks.sendMail.mockResolvedValue({});
  // Etterligner databasen: bare aktive ADMIN/OFFICE i riktig avdeling.
  mocks.prisma.user.findMany.mockImplementation(
    async ({
      where,
    }: {
      where: {
        departmentId?: string;
        role?: { in?: string[] };
        isActive?: boolean;
      };
    }) =>
      officeUsers
        .filter(
          (user) =>
            user.departmentId === where.departmentId &&
            where.role?.in?.includes(user.role) &&
            user.isActive === where.isActive,
        )
        .map((user) => ({ email: user.email })),
  );
});

afterEach(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

describe("sendBookingNotification", () => {
  it("spør bare etter aktive ADMIN/OFFICE i destinasjonsavdelingen", async () => {
    await sendBookingNotification("dep-a", null, booking);

    expect(mocks.prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        departmentId: "dep-a",
        role: { in: ["ADMIN", "OFFICE"] },
        isActive: true,
      },
      select: { email: true },
      take: 100,
    });
  });

  it("sender én e-post per mottaker og aldri til en annen avdeling", async () => {
    const result = await sendBookingNotification("dep-a", null, booking);

    expect(result).toEqual({ officeSent: 2, customerSent: false });
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);

    const recipients = mocks.sendMail.mock.calls.map(
      (call) => (call[0] as { to: string }).to,
    );
    expect(recipients).toEqual([
      "kontor-a@example.test",
      "admin-a@example.test",
    ]);
    for (const to of recipients) {
      expect(to).not.toContain(",");
    }
    expect(recipients).not.toContain("kontor-b@example.test");
  });

  it("sender ingenting når avdelingen ikke har kontorbrukere", async () => {
    const result = await sendBookingNotification("dep-tom", null, booking);

    expect(result).toEqual({ officeSent: 0, customerSent: false });
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("nøytraliserer URL-er i brukerstyrt tittel og beskrivelse", async () => {
    await sendBookingNotification("dep-a", null, {
      ...booking,
      title: "Se https://phish.test",
      description: "Gå til www.evil.test eller evil.test/path",
    });

    const mail = mocks.sendMail.mock.calls[0][0] as {
      subject: string;
      html: string;
    };
    expect(mail.subject).not.toContain("phish.test");
    expect(mail.html).not.toContain("phish.test");
    expect(mail.html).not.toContain("evil.test");
    expect(mail.html).toContain("[lenke fjernet]");
  });
});
