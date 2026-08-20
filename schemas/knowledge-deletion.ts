import { z } from "zod";

export const deleteKnowledgeResourceSchema = z.object({
  id: z.string().min(1),
  confirmationName: z.string().trim().min(1),
});
