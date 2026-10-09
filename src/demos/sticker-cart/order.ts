/**
 * The last order paid for in Sticker Cart, for the box that turns up in Unboxing. Until something's
 * been bought there, the box holds a sensible first order.
 */
export type ShippedOrder = { id: string; items: number[] };

let last: ShippedOrder | null = null;

export function shipOrder(order: ShippedOrder) {
  last = order;
}

export function lastShipped(): ShippedOrder {
  return last ?? { id: 'VG-2817', items: [0, 1, 3] };
}
