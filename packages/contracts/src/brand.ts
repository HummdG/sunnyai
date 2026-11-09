import { z } from 'zod';

/**
 * Installer branding: a custom logo and assistant name that replace the Sunny
 * character in the widget. Absent means Sunny.
 */

/** Every effect the logo can play while Sunny is busy. */
export const LOGO_EFFECTS = [
  'comet',
  'draw',
  'charge',
  'shimmer',
  'rings',
  'march',
  'segments',
] as const;
export type LogoEffect = (typeof LOGO_EFFECTS)[number];

/** Effects drawn along a verified outline trace. */
export const OUTLINE_EFFECTS: readonly LogoEffect[] = ['comet', 'draw', 'rings', 'march'];
/** Effects drawn on the logo's own mask. */
export const STENCIL_EFFECTS: readonly LogoEffect[] = ['charge', 'shimmer', 'segments'];

/** A stored brand asset id: 16 hex characters. */
export const BRAND_ASSET_ID = /^[a-f0-9]{16}$/;

/** Where a brand image is served from. Anchored to a widget id; no traversal. */
export const brandAssetPathSchema = z
  .string()
  .regex(/^\/v1\/widget\/brand\/w_[a-z0-9]{10,40}\/[a-f0-9]{16}(-mask)?\.png$/);

/** An outline as straight path commands only: M, L, Z and numbers. */
export const outlineSchema = z
  .string()
  .max(60_000)
  .regex(/^[MLZ0-9 .-]*$/);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const brandSchema = z.object({
  icon: z.object({
    path: brandAssetPathSchema,
    maskPath: brandAssetPathSchema.nullable(),
    width: z.number().int().min(1).max(512),
    height: z.number().int().min(1).max(512),
    outline: outlineSchema.nullable(),
  }),
  wordmark: z
    .object({
      path: brandAssetPathSchema,
      width: z.number().int().min(1).max(1200),
      height: z.number().int().min(1).max(300),
    })
    .nullable(),
  effects: z.array(z.enum(LOGO_EFFECTS)).max(7),
  colors: z.object({ primary: hex, glow: hex }),
});
export type Brand = z.infer<typeof brandSchema>;

/** What the assistant calls itself. No newlines or markup, so it is safe in a prompt. */
export const assistantNameSchema = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N} .'&-]{0,39}$/u);
