import { z } from "zod";

export const PersonalOverridesSchema = z.strictObject({
  safetyNet: z.strictObject({ allow: z.array(z.string()).optional() }).optional(),
  permissions: z
    .strictObject({
      dropAsk: z.array(z.string()).optional(),
      dropDeny: z.array(z.string()).optional(),
    })
    .optional(),
});

export type PersonalOverrides = z.infer<typeof PersonalOverridesSchema>;
