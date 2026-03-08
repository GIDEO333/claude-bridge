# Zod v3 — AI-Optimized Reference

## Install
```
npm install zod
```

## Core Schema Types

```typescript
import { z } from 'zod';

// Primitives
z.string()
z.number()
z.boolean()
z.null()
z.undefined()
z.literal("value")

// Objects
const schema = z.object({
    name: z.string(),
    age: z.number().positive(),
    email: z.string().email().optional(),
});
type MyType = z.infer<typeof schema>;  // extract TypeScript type

// Arrays
z.array(z.string())
z.array(z.object({ id: z.string() })).min(1)

// Union / Enum
z.union([z.literal("a"), z.literal("b")])
z.enum(["admin", "user", "guest"])

// Transforms
z.string().transform((val) => parseInt(val))
z.union([z.literal("1"), z.literal("2")]).transform((val) => Number(val))
```

## Parsing
```typescript
// Throws ZodError if invalid
const result = schema.parse(data);

// Returns { success: true, data } or { success: false, error }
const safe = schema.safeParse(data);
if (safe.success) {
    console.log(safe.data);
} else {
    console.log(safe.error.issues);
}
```

## Modifiers
```typescript
z.string().optional()      // string | undefined
z.string().nullable()      // string | null
z.string().default("foo")  // fills in default if undefined
z.number().min(0).max(100)
z.string().min(1).max(255)
z.string().regex(/^\d+$/)
```

## Key Pattern: Schema + Infer
```typescript
export const mySchema = z.object({ ... });
export type MyType = z.infer<typeof mySchema>;
// Always use z.infer — do NOT manually write duplicate TypeScript types
```
