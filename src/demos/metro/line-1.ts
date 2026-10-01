/**
 * HCMC Metro Line 1 (Bến Thành – Suối Tiên).
 * Design-concept data: travel times and door sides are illustrative, not official.
 */

export const LINE_1 = {
  number: '1',
  name: 'Line 1',
  color: '#E4252C',
  colorDeep: '#9E1218',
};

export type Station = {
  code: string;
  name: string;
  /** English landmark name, when the station has one */
  english?: string;
  /** Minutes from Bến Thành */
  minutes: number;
  doorSide: 'left' | 'right';
  underground?: boolean;
};

export const STATIONS: Station[] = [
  { code: '01', name: 'Bến Thành', english: 'Central Market', minutes: 0, doorSide: 'right', underground: true },
  { code: '02', name: 'Nhà hát Thành phố', english: 'Opera House', minutes: 2, doorSide: 'right', underground: true },
  { code: '03', name: 'Ba Son', minutes: 4, doorSide: 'left', underground: true },
  { code: '04', name: 'Văn Thánh', minutes: 7, doorSide: 'left' },
  { code: '05', name: 'Tân Cảng', minutes: 9, doorSide: 'left' },
  { code: '06', name: 'Thảo Điền', minutes: 12, doorSide: 'left' },
  { code: '07', name: 'An Phú', minutes: 14, doorSide: 'left' },
  { code: '08', name: 'Rạch Chiếc', minutes: 17, doorSide: 'left' },
  { code: '09', name: 'Phước Long', minutes: 19, doorSide: 'left' },
  { code: '10', name: 'Bình Thái', minutes: 21, doorSide: 'left' },
  { code: '11', name: 'Thủ Đức', minutes: 24, doorSide: 'left' },
  { code: '12', name: 'Khu Công nghệ cao', english: 'Hi-Tech Park', minutes: 26, doorSide: 'left' },
  { code: '13', name: 'Đại học Quốc gia', english: 'National University', minutes: 28, doorSide: 'left' },
  { code: '14', name: 'Bến xe Suối Tiên', english: 'Suoi Tien Terminal', minutes: 30, doorSide: 'right' },
];

/** "Bến xe Suối Tiên" -> "BEN XE SUOI TIEN", for LED boards that only have ASCII glyphs */
export function toAscii(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Distance-based fare in VND: 7.000 ₫ base, +1.000 ₫ per station, capped at 20.000 ₫ */
export function fareBetween(from: number, to: number) {
  const hops = Math.abs(to - from);
  return Math.min(20000, 7000 + hops * 1000);
}

export function formatVnd(amount: number) {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}
