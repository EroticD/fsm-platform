import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Kundekortet for API-klienter.
 *
 * Tjenestelaget bak kundekortet laster også revisjonslogger, kommentarer,
 * oppdrag og maler som REST-klienten ikke trenger. Her hentes derfor bare
 * grunndataene, de avgrensede listene og telletallene. Portalbrukere velges
 * eksplisitt uten passord, reset-token eller 2FA-hemmeligheter.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "customers.view")) {
    return apiError("forbidden", 403, { messageKey: "errors.api.customers.forbidden" });
  }

  const { id } = await params;
  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      customerNumber: true,
      orgNumber: true,
      brandColor: true,
      logoUrl: true,
      address: true,
      postalCode: true,
      city: true,
      phone: true,
      email: true,
      notes: true,
      departmentId: true,
      responsibleTechnicianId: true,
      createdAt: true,
      updatedAt: true,
      department: { select: { id: true, name: true, isActive: true } },
      responsibleTechnician: { select: { id: true, name: true, email: true } },
      contacts: {
        orderBy: { name: "asc" },
        take: 100,
        select: { id: true, name: true, email: true, phone: true, role: true },
      },
      products: {
        orderBy: { model: "asc" },
        take: 100,
        select: {
          id: true,
          model: true,
          serialNumber: true,
          location: true,
        },
      },
      contracts: {
        orderBy: { startDate: "desc" },
        take: 50,
        select: {
          id: true,
          title: true,
          intervalMonths: true,
          startDate: true,
          nextServiceDate: true,
          isActive: true,
          departmentId: true,
          contactId: true,
          templateId: true,
          department: { select: { id: true, name: true } },
          template: { select: { id: true, title: true } },
        },
      },
      users: {
        where: { role: "CUSTOMER" },
        orderBy: { name: "asc" },
        take: 100,
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          contactId: true,
          contact: { select: { id: true, name: true } },
        },
      },
      _count: {
        select: {
          contacts: true,
          products: true,
          contracts: true,
          workOrder: true,
          attachments: true,
          users: { where: { role: "CUSTOMER" } },
        },
      },
    },
  });

  if (!customer) {
    return apiError("not_found", 404, { messageKey: "errors.api.customers.notFound" });
  }

  const { _count, ...detail } = customer;

  return apiJson({
    ...detail,
    counts: {
      contacts: _count.contacts,
      products: _count.products,
      contracts: _count.contracts,
      workOrders: _count.workOrder,
      attachments: _count.attachments,
      portalUsers: _count.users,
    },
  });
}
