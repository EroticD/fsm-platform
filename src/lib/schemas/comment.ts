import { z } from "zod";
import { markdownSchema } from "./common";

/** En kommentar på et oppdrag eller en kunde. */
export const commentCreateSchema = z.object({
  content: markdownSchema.refine((value) => value.trim().length > 0, {
    message: "Kommentaren er tom",
  }),
});
