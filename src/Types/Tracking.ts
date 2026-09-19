import { z } from 'zod';

export const TRACK_ID_LENGTH = 20;

/** The starting life a track link means when it names none. */
export const DEFAULT_TRACKED_LIFE = 20;

export const trackLinkSchema = z.object({
  v: z.literal(1),
  id: z.string().length(TRACK_ID_LENGTH),
  seats: z.array(z.string()).min(2).max(6),
  life: z.number().int().positive().optional(),
  label: z.string().max(64).optional(),
});

export type TrackLink = z.infer<typeof trackLinkSchema>;

export const seatStateSchema = z.object({
  l: z.number(),
  poi: z.number().optional(),
  cmd: z.number().optional(),
});

export type SeatState = z.infer<typeof seatStateSchema>;

export const liveNodeSchema = z.object({
  v: z.literal(1),
  st: z.enum(['live', 'offline', 'ended']),
  t0: z.number(),
  exp: z.number(),
  up: z.number(),
  wr: z.string().max(16),
  off: z.number().optional(),
  w: z.number().optional(),
  p: z.array(seatStateSchema),
});

export type LiveNode = z.infer<typeof liveNodeSchema>;
export type TrackStatus = LiveNode['st'];
