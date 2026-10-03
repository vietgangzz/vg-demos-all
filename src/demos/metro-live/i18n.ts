import type { Lang } from '@/i18n/language';

export { language, useLang, type Lang } from '@/i18n/language';

/**
 * English / Vietnamese strings for Line 1 Live, in the app's language (switched on the home
 * screen): `tr(useLang())`. Station names stay Vietnamese in both: they are the names on the
 * signs.
 */

const STRINGS = {
  en: {
    title: 'Line 1 Live',
    trains: (n: number) => `${n} trains`,
    building: 'Building Saigon in 3D',
    loadingSub: (count: number, from: string, to: string) => `Line 1 · ${count} stations · ${from} → ${to}`,
    start: (from: string, to: string) => `Start · ${from} → ${to}`,
    yourTrain: 'Your train',
    pin: (eta: string) => `Your train · ${eta}`,
    search: 'Search stations',
    cancel: 'Cancel',
    lineStatus: (n: number) => `Line status · ${n} trains`,
    stations: 'Stations',
    results: 'Results',
    noMatch: (q: string) => `No stations match “${q}”`,
    noMatchHint: 'Try a name without accents, like “thu duc”.',
    underground: 'Underground',
    elevated: 'Elevated',
    terminus: 'Terminus',
    minutesFrom: (m: number) => `${m} min from Bến Thành`,
    boarding: 'Boarding',
    doorsClosing: 'Doors closing',
    arriving: 'Arriving',
    departed: 'Departed',
    at: (station: string) => `At ${station}`,
    next: (station: string) => `Next: ${station}`,
    departs: 'departs',
    arrives: 'arrives',
    trainBadge: 'TRAIN',
    trainTitle: (n: string, toward: string) => `Train ${n} · to ${toward}`,
    autumn: 'Autumn trees',
  },
  vi: {
    title: 'Tuyến 1 Trực tiếp',
    trains: (n: number) => `${n} đoàn tàu`,
    building: 'Đang dựng Sài Gòn 3D',
    loadingSub: (count: number, from: string, to: string) => `Tuyến 1 · ${count} ga · ${from} → ${to}`,
    start: (from: string, to: string) => `Bắt đầu · ${from} → ${to}`,
    yourTrain: 'Tàu của bạn',
    pin: (eta: string) => `Tàu của bạn · ${eta}`,
    search: 'Tìm ga',
    cancel: 'Huỷ',
    lineStatus: (n: number) => `Tình trạng tuyến · ${n} đoàn tàu`,
    stations: 'Các ga',
    results: 'Kết quả',
    noMatch: (q: string) => `Không có ga nào khớp “${q}”`,
    noMatchHint: 'Thử gõ không dấu, ví dụ “thu duc”.',
    underground: 'Ga ngầm',
    elevated: 'Ga trên cao',
    terminus: 'Ga đầu tuyến',
    minutesFrom: (m: number) => `${m} phút từ Bến Thành`,
    boarding: 'Đang đón khách',
    doorsClosing: 'Sắp đóng cửa',
    arriving: 'Sắp đến ga',
    departed: 'Đã rời ga',
    at: (station: string) => `Tại ${station}`,
    next: (station: string) => `Ga kế: ${station}`,
    departs: 'chạy',
    arrives: 'đến',
    trainBadge: 'TÀU',
    trainTitle: (n: string, toward: string) => `Tàu ${n} · đi ${toward}`,
    autumn: 'Cây mùa thu',
  },
} satisfies Record<Lang, Record<string, unknown>>;

/** Strings for `lang` */
export function tr(lang: Lang) {
  return STRINGS[lang];
}
