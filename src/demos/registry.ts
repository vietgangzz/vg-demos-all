import type { ComponentType } from 'react';

import MetroBoard from '@/demos/metro-board';
import MetroCinematic from '@/demos/metro-cinematic';
import MetroMorning from '@/demos/metro-morning';
import MetroMrt from '@/demos/metro-mrt';
import MetroRain from '@/demos/metro-rain';
import MetroRiver from '@/demos/metro-river';
import MetroLive from '@/demos/metro-live';
import MetroOnboard from '@/demos/metro-onboard';
import MetroTap from '@/demos/metro-tap';
import SpringCard from '@/demos/spring-card';

export type Demo = {
  /** URL-safe id, used as the route param: /demo/<id> */
  id: string;
  title: string;
  description: string;
  /** Vietnamese title and description, shown when the app is in Vietnamese */
  vi?: { title: string; description: string };
  author?: string;
  component: ComponentType;
  /** No floating close button: the demo pushes in and closes with the edge swipe instead */
  hideClose?: boolean;
};

/**
 * Add new demos here. Each demo lives in its own folder under src/demos/<id>/
 * and default-exports a full-screen component.
 */
export const demos: Demo[] = [
  {
    id: 'metro-live',
    title: 'Metro · Line 1 Live',
    description:
      'Real-map 3D Saigon with live trains (three.js + TypeGPU on WebGPU) and an Apple Maps-style native sheet.',
    vi: {
      title: 'Metro · Tuyến 1 Trực tiếp',
      description:
        'Sài Gòn 3D theo bản đồ thật, tàu chạy trực tiếp (three.js + TypeGPU trên WebGPU) và sheet native kiểu Apple Maps.',
    },
    author: 'VG Team',
    component: MetroLive,
    hideClose: true,
  },
  {
    id: 'metro-cinematic',
    title: 'Metro · Line 1 Showcase Run',
    description:
      'For recording: tap Start and your train runs Suối Tiên → Bến Thành at real speed while the camera directs itself.',
    vi: {
      title: 'Metro · Tuyến 1 Chuyến tàu',
      description: 'Để quay video: bấm Bắt đầu, tàu chạy Suối Tiên → Bến Thành theo tốc độ thật, camera tự dẫn cảnh.',
    },
    author: 'VG Team',
    component: MetroCinematic,
    hideClose: true,
  },
  {
    id: 'metro-rain',
    title: 'Metro · Line 1 Rain Run',
    description:
      'The showcase run with weather, cut to "MRT": golden hour at Suối Tiên, then wind and rain as the train rolls out.',
    vi: {
      title: 'Metro · Tuyến 1 Chuyến tàu trong mưa',
      description:
        'Chuyến tàu có thời tiết, dựng theo bài "MRT": hoàng hôn ở Suối Tiên, rồi gió mưa nổi lên khi tàu lăn bánh.',
    },
    author: 'VG Team',
    component: MetroRain,
    hideClose: true,
  },
  {
    id: 'metro-mrt',
    title: 'Metro · MRT Storm Cut',
    description:
      'The rain run from the moment the song comes in: start "MRT" on the Start press and the lightning lands on the bass.',
    vi: {
      title: 'Metro · Đoạn bão MRT',
      description: 'Đoạn bão của chuyến tàu trong mưa: bật nhạc "MRT" đúng lúc bấm Bắt đầu, sét đánh trúng nhịp bass.',
    },
    author: 'VG Team',
    component: MetroMrt,
    hideClose: true,
  },
  {
    id: 'metro-morning',
    title: 'Metro · Line 1 Autumn Morning',
    description:
      'The rain run in daylight: an autumn morning at Suối Tiên, a shower partway, with the live sheet and the arrival chime.',
    vi: {
      title: 'Metro · Tuyến 1 Sáng mùa thu',
      description: 'Chuyến tàu buổi sáng mùa thu: đi một đoạn thì mưa nhẹ, có sheet trực tiếp và chuông báo đến ga.',
    },
    author: 'VG Team',
    component: MetroMorning,
    hideClose: true,
  },
  {
    id: 'metro-river',
    title: 'Metro · Line 1 River Run',
    description:
      'From Thảo Điền over the Saigon River beside Cầu Sài Gòn, Landmark 81 ahead and a train passing on the river, on a clear autumn morning.',
    vi: {
      title: 'Metro · Tuyến 1 Qua sông Sài Gòn',
      description:
        'Từ Thảo Điền vượt sông Sài Gòn cạnh cầu Sài Gòn, Landmark 81 phía trước, tàu ngược chiều chạy ngang trên sông, sáng mùa thu.',
    },
    author: 'VG Team',
    component: MetroRiver,
    hideClose: true,
  },
  {
    id: 'metro-onboard',
    title: 'Metro · Onboard Display',
    description: 'HCMC Metro Line 1 door screen: live route, arrival chime, doors.',
    vi: {
      title: 'Metro · Màn hình trên tàu',
      description: 'Màn hình cửa tàu Metro Tuyến 1: lộ trình trực tiếp, chuông báo đến ga, cửa tàu.',
    },
    author: 'VG Team',
    component: MetroOnboard,
  },
  {
    id: 'metro-tap',
    title: 'Metro · Tap to Ride',
    description: 'Drag your metro card to the reader. Haptics thicken as it gets closer.',
    vi: {
      title: 'Metro · Chạm để đi',
      description: 'Kéo thẻ metro tới đầu đọc. Rung càng dày khi thẻ càng gần.',
    },
    author: 'VG Team',
    component: MetroTap,
  },
  {
    id: 'metro-board',
    title: 'Metro · Platform Board',
    description: 'LED dot-matrix departures with stepping ticker, column wipe and car crowding.',
    vi: {
      title: 'Metro · Bảng giờ tàu',
      description: 'Bảng LED ma trận điểm: giờ tàu, chữ chạy theo bước, hiệu ứng lật cột và độ đông từng toa.',
    },
    author: 'VG Team',
    component: MetroBoard,
  },
  {
    id: 'spring-card',
    title: 'Spring Card',
    description: 'Drag the card around, release and it springs back.',
    vi: {
      title: 'Thẻ lò xo',
      description: 'Kéo thẻ đi khắp nơi, thả ra là thẻ bật về.',
    },
    author: 'VG Team',
    component: SpringCard,
  },
];

export function getDemo(id: string | undefined) {
  return demos.find((demo) => demo.id === id);
}
