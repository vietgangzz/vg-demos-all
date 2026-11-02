import type { BakeData, Place } from './bake';

/** Written by scripts/blender/corner_shop_bake.py: each place's bake, once it has one */
export const BAKED: Partial<Record<Place, { data: BakeData; maps: number[] }>> = {};
