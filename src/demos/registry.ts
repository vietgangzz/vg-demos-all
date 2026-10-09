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
import PaperPlane from '@/demos/paper-plane';
import PaperPlaneChat from '@/demos/paper-plane-chat';
import SpringCard from '@/demos/spring-card';
import MarketBag from '@/demos/sticker-cart';
import Unboxing from '@/demos/unboxing';
import Weather from '@/demos/weather';
// Kept last: imported first, Market Bag crashed on opening (a worklet failing to carry its Skia
// buffers to the UI thread). Why the order matters isn't known yet.
import Fridge from '@/demos/fridge';

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
    id: 'fridge',
    title: 'Fridge',
    description:
      'Made for the folding iPhone: folded, it’s the fridge door, notes and magnets and all. Unfold it and the door swings open on the phone’s own hinge, the light flickers on and cold spills out. Drag in what you just unboxed and each thing goes where it belongs.',
    vi: {
      title: 'Tủ lạnh',
      description:
        'Dành cho iPhone gập: gập máy là cánh tủ lạnh, đủ giấy nhắn và nam châm. Mở máy ra, cửa xoay mở quanh chính bản lề của máy, đèn chớp sáng, hơi lạnh tràn ra. Kéo đồ vừa mở hộp vào, món nào tự về đúng ngăn nấy.',
    },
    author: 'VG Team',
    component: Fridge,
  },
  {
    id: 'unboxing',
    title: 'Unboxing',
    description:
      'Your order turns up as a real box: slit the tape with a box cutter, flick the flaps open, peel the seal, sweep the tissue aside, and what you bought rises out of the shred in 3D. Then stamp your rating.',
    vi: {
      title: 'Mở hộp',
      description:
        'Đơn hàng tới thành một thùng carton thật: rọc băng keo, lật nắp, bóc tem, vén giấy lụa, món đồ 3D bay lên khỏi giấy rơm. Rồi đóng dấu đánh giá.',
    },
    author: 'VG Team',
    component: Unboxing,
  },
  {
    id: 'sticker-cart',
    title: 'Market Bag',
    description:
      'Shopping where things feel like things: 3D products lift off their cards and spin through the air into a market net bag that sags and swells with the weight. Tip the bag out and it files itself into your cart.',
    vi: {
      title: 'Túi đi chợ',
      description:
        'Mua sắm mà món đồ có cảm giác thật: sản phẩm 3D nhấc khỏi thẻ, xoay vòng bay vào túi lưới đi chợ, túi phình và trĩu theo sức nặng. Dốc túi ra, đồ tự xếp thành giỏ hàng.',
    },
    author: 'VG Team',
    component: MarketBag,
  },
  {
    id: 'paper-plane-chat',
    title: 'Paper Plane · Chat',
    description:
      'Send a message and its bubble lifts off as a card of paper, folds itself into a plane and loops out of the screen. The answer flies in and opens into its bubble.',
    vi: {
      title: 'Máy bay giấy · Chat',
      description:
        'Gửi tin nhắn, bong bóng hoá thành tấm giấy, tự gấp thành máy bay rồi lượn vòng bay khỏi màn hình. Tin trả lời bay vào, mở phẳng thành bong bóng.',
    },
    author: 'VG Team',
    component: PaperPlaneChat,
  },
  {
    id: 'paper-plane',
    title: 'Paper Plane',
    description:
      'Write a note on a page from your school notebook, fold it into a paper plane and send it over the rice field at sunset. An answer flies back and opens in your hands.',
    vi: {
      title: 'Máy bay giấy',
      description:
        'Viết lên trang vở ô li, gấp thành máy bay giấy, phóng qua cánh đồng lúa lúc hoàng hôn. Thư trả lời bay về, mở ra trên tay bạn.',
    },
    author: 'VG Team',
    component: PaperPlane,
    hideClose: true,
  },
  {
    id: 'weather',
    title: 'Trời · 3D Weather',
    description:
      'Live weather as a little 3D world: puffy numerals, clouds, rain, storms, fog and haze. Swipe through now, rain, wind, sun and air; drag a chart to scrub 24 hours.',
    vi: {
      title: 'Trời · Thời tiết 3D',
      description:
        'Thời tiết trực tiếp thành một thế giới 3D nhỏ: số phồng, mây, mưa, dông, sương mù, khói bụi. Vuốt qua bây giờ, mưa, gió, mặt trời, không khí; kéo biểu đồ để tua 24 giờ.',
    },
    author: 'VG Team',
    component: Weather,
    hideClose: true,
  },
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
