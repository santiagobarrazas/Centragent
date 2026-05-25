import { z } from "zod";

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional()
});

export const messagePaginationQuerySchema = paginationQuerySchema.extend({
  direction: z.enum(["before", "after"]).default("before")
});

export const encodeSequenceCursor = (sequenceNumber: number) =>
  sequenceNumber.toString(10);

export const decodeSequenceCursor = (cursor?: string) => {
  if (!cursor) {
    return undefined;
  }

  const value = Number.parseInt(cursor, 10);
  return Number.isFinite(value) ? value : undefined;
};
