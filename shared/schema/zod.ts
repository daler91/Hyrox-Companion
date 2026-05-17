import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { createSchemaFactory } from "drizzle-zod";
import { z } from "zod";

// Zod v4 does not propagate late prototype patches to already-instantiated
// schemas, so the `.openapi()` extension must run before any schema is
// created. Keeping it in this shared factory makes every schema module use
// the same patched zod instance.
extendZodWithOpenApi(z);

// Bind drizzle-zod to our `z` instance so the schemas it emits share our
// ZodObject constructor, which is required for the `.openapi()` prototype
// patch above to apply.
const { createInsertSchema } = createSchemaFactory({ zodInstance: z });

export { createInsertSchema, z };
