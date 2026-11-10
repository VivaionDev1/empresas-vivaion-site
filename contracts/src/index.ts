import { z } from "zod";

const absoluteHttps = z.string().url().refine((value) => value.startsWith("https://"), "HTTPS URL required");

export const catalogProductSchema = z.object({
  id: z.string().regex(/^(pos|formacao|curso-livre):[a-z0-9-]+$/),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["pos", "formacao", "curso-livre"]),
  title: z.string().trim().min(3).max(240),
  summary: z.string().trim().min(1).max(1500),
  canonicalUrl: absoluteHttps,
  area: z.string().trim().min(1).max(160),
  audienceLabel: z.string().max(400),
  audienceRestrictions: z.string().max(1000).nullable(),
  deliveryMode: z.enum(["live", "recorded", "online", "hybrid", "in-person", "unspecified"]),
  commercialStage: z.enum(["available", "prelaunch", "closed"]),
  tags: z.array(z.string().max(100)).max(40),
  themes: z.array(z.string().max(100)).max(20),
  workload: z.string().max(80).nullable(),
  imageUrl: absoluteHttps.nullable(),
}).strict().superRefine((item, context) => {
  if (item.id !== item.kind + ":" + item.slug) {
    context.addIssue({ code: "custom", message: "Product ID must match kind:slug" });
  }
  if (new URL(item.canonicalUrl).hostname !== "vivaion.com.br" &&
      new URL(item.canonicalUrl).hostname !== "www.vivaion.com.br") {
    context.addIssue({ code: "custom", message: "Canonical URL must be on the Vivaion institutional domain" });
  }
});

export const catalogFeedSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  products: z.array(catalogProductSchema).max(1000),
}).strict().superRefine((feed, context) => {
  const ids = new Set<string>();
  for (const [index, product] of feed.products.entries()) {
    if (ids.has(product.id)) {
      context.addIssue({ code: "custom", path: ["products", index, "id"], message: "Duplicate product ID" });
    }
    ids.add(product.id);
  }
});

export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type CatalogFeed = z.infer<typeof catalogFeedSchema>;
