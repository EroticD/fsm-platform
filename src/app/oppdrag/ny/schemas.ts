import { z } from "zod";

export const createWorkOrderSchema = z.object({
  title: z.string().min(1, "Tittel er påkrevd"),
  description: z.string().optional(),
  customerId: z.string().optional(),
  contactId: z.string().optional(),
  scheduledFor: z.string().min(1, "Dato er påkrevd"),
  scheduledTo: z.string().optional(),
  technicianIds: z.array(z.string()).optional(),
  templateIds: z.array(z.string()).optional(),
}).refine(
  (data) => !data.scheduledTo || data.scheduledTo >= data.scheduledFor,
  { message: "Sluttdato kan ikke være før startdato", path: ["scheduledTo"] }
);

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
