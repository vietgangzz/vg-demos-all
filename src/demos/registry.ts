import type { ComponentType } from 'react';

import CornerShop from '@/demos/corner-shop';
import DailyDrop from '@/demos/daily-drop';
import FairyGlobe from '@/demos/fairy-globe';
import Juice from '@/demos/juice';
import Library from '@/demos/library';
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
import RankUp from '@/demos/rank-up';
import SpringCard from '@/demos/spring-card';
import MarketBag from '@/demos/sticker-cart';
import Unboxing from '@/demos/unboxing';
import SpookyProgress from '@/demos/spooky-progress';
import WeekWrapped from '@/demos/week-wrapped';
import WaterDragon from '@/demos/water-dragon';
import WeeklyGacha from '@/demos/weekly-gacha';
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
    id: 'spooky-progress',
    title: 'Spooky Progress',
    description:
      "A lesson's progress bar, Halloween edition, five ways at once, stacked down a graveyard night under a big low moon, fog rolling along the bottom, dewy cobwebs in the corners and spiders (rendered in Blender) letting themselves down over it all on their threads. The bars slide in from either side, and five right answers fill them a fifth at a time, each a beat behind the one above so every answer ripples down the stack. A corked test tube fills with a glowing brew as ingredients splash in; five pumpkins on a vine are carved and lit in turn; a ghost glides along a thread of spider silk lighting lanterns; a spark burns along a fuse to a pumpkin bomb; slime oozes along a hollow bone, dripping. Then they go off one after another, top to bottom: the cork shoots out with smoke, bats and ghosts, the pumpkins flare into ghostly green fire, a spider drops in on the ghost and gets BOOed, the bomb bursts into sweets, and the slime heaves up into a goggling blob and splats all over the screen. LESSON COMPLETE, and the spiders shoot back up out of sight. Every sound made from scratch.",
    vi: {
      title: 'Thanh tiến độ Halloween',
      description:
        'Thanh tiến độ của một bài học, phiên bản Halloween, năm kiểu cùng lúc, xếp dọc trên nền nghĩa địa đêm trăng, sương mù trôi dưới chân, mạng nhện đọng sương ở hai góc và những con nhện (render bằng Blender) thả tơ đu đưa trên tất cả. Các thanh trượt vào từ hai bên, năm câu trả lời đúng lấp đầy mỗi lần một phần năm, thanh dưới chậm hơn thanh trên một nhịp nên mỗi câu đúng chạy thành sóng dọc xuống. Ống nghiệm nút bần đầy dần thuốc phát sáng khi nguyên liệu rơi vào; năm quả bí ngô lần lượt được khắc mặt và thắp nến; con ma lướt trên sợi tơ nhện thắp từng đèn lồng; tia lửa cháy dọc ngòi tới quả bom bí ngô; nhầy xanh bò dọc khúc xương rỗng, nhỏ giọt. Rồi lần lượt nổ dây chuyền từ trên xuống: nút bần bắn vèo cùng khói, dơi và hồn ma, bí ngô bùng lửa ma xanh, nhện thả xuống bị con ma hù BOO, bom nổ tung ra kẹo, nhầy phình thành quái vật mắt lồi rồi bắn khắp màn hình. LESSON COMPLETE, và lũ nhện rút tơ chạy mất. Mọi âm thanh đều tự tổng hợp.',
    },
    author: 'VG Team',
    component: SpookyProgress,
    hideClose: true,
  },
  {
    id: 'week-wrapped',
    title: 'Week Wrapped',
    description:
      "Your week, wrapped as a replay of Silver's board that starts at the end, all of it playing by itself. It opens on Gold: your row in gold foil wearing the crown, Gold's badge, GOLD LEAGUE, confetti in the air. Then the tape winds back: the confetti flies back down into the cannons, GOLD LEAGUE lifts away a letter at a time, the badge whirls backwards off into the distance, the board flies back up and slots together, Gold's world draws back into your row and the crown lifts off; then the whole week runs backwards, every kick undone, everyone's XP spinning down to Monday. Then it plays: a leg springing out of your row to boot each one you pass, a sticker over the scrubber for each day, Sunday in slow motion, and at 11:42 pm the last kick sends Mina flying. Everything stops dead, the crown drops back on, Gold floods out, the board falls away, Gold's badge slams down, and the week ends on one card.",
    vi: {
      title: 'Tổng kết tuần',
      description:
        'Tổng kết tuần là đoạn replay bảng xếp hạng giải Bạc bắt đầu từ cái kết, tất cả tự chạy. Mở ra là thế giới Vàng: hàng của bạn mạ vàng đội vương miện, huy hiệu Vàng, GOLD LEAGUE, pháo giấy đang bay. Rồi băng tua ngược: pháo giấy bay ngược về nòng, chữ GOLD LEAGUE bay lên từng chữ, huy hiệu xoay ngược bay vụt ra xa, cả bảng bay ngược lên lắp lại, thế giới Vàng co về hàng của bạn và vương miện bay khỏi đầu; rồi cả tuần chạy ngược thật nhanh, mọi cú đá rút lại, XP của mọi người quay về 0 sáng thứ Hai. Sau đó phát lại: một cái chân bật ra đá văng từng người bạn vượt, mỗi ngày một nhãn dán trên thanh tua, Chủ nhật quay chậm, và lúc 11:42 tối cú đá cuối hất Mina bay. Mọi thứ khựng lại, vương miện rơi lại lên đầu, Vàng tràn ra, cả bảng rơi xuống, huy hiệu Vàng đập xuống, và cả tuần gói lại trên một tấm thẻ.',
    },
    author: 'VG Team',
    component: WeekWrapped,
    hideClose: true,
  },
  {
    id: 'weekly-gacha',
    title: 'Weekly Gacha',
    description:
      "Your week as a gacha machine, in Rank Up's world: a glossy machine with a glass dome heaped with capsules, five slots waiting at the top. Drag round to turn its knob (or tap the button): it ratchets round, the machine rattles, and with a clunk a capsule drops out of the chute and bounces. It leaps up into the middle and shakes harder and harder as specks of light are pulled into it, until it pops: the top flies off, light blooms, and a prize rises out of it turning, a solid thing rendered in Blender, your XP, streak, lessons and time counting up under it. Next, and it flies up into its slot. The fifth capsule is gold: it shakes longest, and when it pops Gold's world floods out with confetti, and the whole week is laid out on a plate.",
    vi: {
      title: 'Gacha tuần',
      description:
        'Tuần học của bạn là một máy gacha, trong thế giới của Thăng hạng: máy bóng loáng, mái kính đầy capsule, năm ô trống chờ phía trên. Kéo vòng quanh để vặn núm (hoặc bấm nút): núm kêu tách tách, máy rung lên, rồi cạch một tiếng, một viên capsule rơi ra khỏi máng và nảy lên. Nó bật lên giữa màn hình, rung mỗi lúc một mạnh khi những đốm sáng bị hút vào, cho tới khi bật nắp: nửa trên bay vụt đi, ánh sáng loé ra, và một món quà 3D render bằng Blender xoay tròn bay lên, con số XP, chuỗi ngày, bài học và thời gian đếm lên bên dưới. Bấm tiếp, món quà bay về ô của nó. Viên thứ năm bằng vàng: rung lâu nhất, và khi bật ra thì thế giới Vàng tràn ngập kèm pháo giấy, rồi cả tuần của bạn bày ra trên một tấm kính.',
    },
    author: 'VG Team',
    component: WeeklyGacha,
    hideClose: true,
  },
  {
    id: 'rank-up',
    title: 'Rank Up',
    description:
      "The last seconds of a league week, and the promotion that comes of it, where each league is a world of its own colour. Silver's board, deep blue, you fifth, the clock running out: everyone else draws back and your row lifts out and climbs, a leg springing out of it to boot each one above you out of the way, over the promotion line, to the top. A crown drops onto you and confetti bursts. Claim it, and Silver's badge comes down onto a ribbon of gold and winds itself up, faster and faster, until it rockets off up through the clouds, the camera climbing with it, into Gold's sky; it twinkles there as a star, then falls back as a blazing Gold meteor, and everything stops dead for a beat as it lands. GOLD LEAGUE drops in a letter at a time, the leagues line up and Gold's badge stamps down onto its place. Sounds made from scratch.",
    vi: {
      title: 'Thăng hạng',
      description:
        'Những giây cuối của tuần đấu và cú thăng hạng sau đó, mỗi giải là một thế giới màu riêng. Bảng xếp hạng giải Bạc xanh thẫm, bạn đứng thứ năm, đồng hồ sắp hết: cả bảng lùi lại, hàng của bạn nổi lên và leo dần, một cái chân mọc ra đá văng từng người phía trên, vượt vạch thăng hạng, lên đỉnh. Vương miện rơi xuống, pháo giấy nổ tung. Nhận thưởng, huy hiệu Bạc đáp xuống một dải vàng rồi tự xoay mỗi lúc một nhanh, cho tới khi vút lên xuyên qua mây, máy quay bay theo, vào bầu trời giải Vàng; nó lấp lánh thành một vì sao rồi rơi trở lại thành sao băng Vàng rực lửa, mọi thứ khựng lại một nhịp khi nó chạm đất. Dòng GOLD LEAGUE rơi xuống từng chữ, các giải xếp hàng và huy hiệu Vàng đóng dấu vào chỗ của mình. Âm thanh tự tổng hợp.',
    },
    author: 'VG Team',
    component: RankUp,
    hideClose: true,
  },
  {
    id: 'daily-drop',
    title: 'Daily Drop',
    description:
      "The reward at the end of a seven-day streak, as a moment. A treasure chest bound shut in chains on a dais cut with a magic circle, in a vault, a shaft of golden light falling on it. Hold anywhere and a gold key comes up over your thumb, the glass bulb in its bow filling with light; the chest strains and shakes, its chains glowing out from the padlock, the circle filling round the dais, the light running from gold through blue and violet to legendary orange the longer you hold, the key's note rising and the phone ticking quicker in your hand. Hold it to the end and the key flies to the padlock, slides in and turns with a clack: a flash, a shockwave across the screen, and in slow motion the padlock flies apart, the chains whip off, the lid is flung open and the treasure goes up in a fountain and rains down on the dais, every knock heard and felt, all of it simulated in Blender. Then the legendary egg rises out of the chest into a fan of light, its shell cracked with fire, for you to spin with a finger and then hatch: it shakes, bursts into pieces, and Ember Drake bursts out of the fire, a baby dragon hovering over the treasure, its tail alight; tap it and it breathes fire at you; the other rewards under it (or, switched to cards, three cards to turn over). Claim, and the coins fly into your wallet as the count rolls up, the drake becomes your avatar, and light pours into your level bar until it overflows: level up. Replay runs the whole burst backwards.",
    vi: {
      title: 'Phần thưởng mỗi ngày',
      description:
        'Phần thưởng sau chuỗi bảy ngày, làm thành một khoảnh khắc. Một rương báu bị xích chặt trên bệ đá khắc vòng phép, trong hầm kho báu, một luồng sáng vàng chiếu xuống. Giữ ngón tay ở bất cứ đâu là một chiếc chìa khoá vàng hiện lên trên ngón tay, bầu thuỷ tinh ở đầu chìa dần đầy ánh sáng; rương gồng lên, rung lắc, xích sáng dần ra từ ổ khoá, vòng phép sáng dần quanh bệ, màu đổi từ vàng sang xanh, tím rồi cam huyền thoại khi bạn giữ càng lâu, tiếng chìa cao dần và máy rung dồn dập trong tay. Giữ đến cùng là chìa bay vào ổ, cắm vào và xoay cạch: một chớp sáng, sóng xung kích lan khắp màn hình, rồi chậm lại như phim: ổ khoá vỡ tung, xích văng ra, nắp bật mở, kho báu phun lên rồi rơi xuống bệ, từng tiếng va chạm đều nghe và cảm thấy được, tất cả mô phỏng vật lý trong Blender. Rồi quả trứng huyền thoại bay lên khỏi rương giữa quạt tia sáng, vỏ nứt ánh lửa, để bạn lấy ngón tay xoay rồi bấm ấp nở: trứng rung lên, vỡ tung, và Ember Drake lao ra từ lửa, một chú rồng con bay lượn trên kho báu, đuôi rực lửa; chạm vào là nó phun lửa về phía bạn; các phần thưởng khác ở bên dưới (hoặc chuyển sang chế độ thẻ để lật ba lá bài). Nhận thưởng: xu bay vào ví khi con số lăn lên, rồng lửa thành avatar của bạn, và ánh sáng rót đầy thanh kinh nghiệm cho đến khi tràn: lên cấp. Xem lại thì cả vụ nổ tua ngược.',
    },
    author: 'VG Team',
    component: DailyDrop,
    hideClose: true,
  },
  {
    id: 'water-dragon',
    title: 'Water Puppets',
    description:
      "A water puppet show on a pond at night, played sideways: a gilded dragon and a cobra in front of a village water pavilion, two dragons on its ridge facing the moon, red lanterns along its eaves, the band playing on its platform beside it, swallow-tailed flags in the five colours down both sides of the pond, a big moon coming up over the bamboo. You work the dragon the way the puppeteers do, from behind the bamboo screen: its pole sends it across the pond, its cords hold its head up, squeeze the pump for water from its mouth, press it down under the water and let it leap out. The cobra hunts it by itself and strikes; a hit knocks the other back under. Every coil that breaks the surface throws up water, every drop that falls back leaves its ring, the waves rock the lotus lamps.",
    vi: {
      title: 'Múa rối nước',
      description:
        'Một buổi múa rối nước trên mặt hồ đêm, cầm ngang máy để xem: rồng thếp vàng và rắn hổ mang trước thuỷ đình làng, lưỡng long chầu nguyệt trên nóc, đèn lồng đỏ dọc mái, phường bát âm ngồi chiếu bên cạnh, cờ đuôi nheo ngũ sắc dọc hai bên hồ, vầng trăng lớn nhô lên sau rặng tre. Bạn điều khiển rồng như nghệ nhân sau mành tre: cây sào đưa rồng đi khắp mặt hồ, các sợi dây giật để rồng ngóc đầu, bóp bơm cho rồng phun nước, ấn sào cho rồng lặn rồi thả ra để rồng phóng vọt lên. Rắn tự săn rồng và lao tới đớp; trúng đòn là con kia bị hất văng, chìm xuống nước. Mỗi khúc thân xuyên mặt nước làm nước bắn tung, mỗi giọt rơi xuống để lại một vòng sóng, và sóng làm những chiếc đèn hoa đăng bập bềnh trôi.',
    },
    author: 'VG Team',
    component: WaterDragon,
    hideClose: true,
  },
  {
    id: 'library',
    title: 'Library',
    description:
      'A music library of 10,000 songs, every screen of it real SwiftUI written in React with Expo UI. Fling through all of it while only a couple of dozen rows ever exist, search as you type, swipe a song to play it next, and open the player: the cover grows out of the mini player, sinks back when you pause, and shrinks home under your finger as you drag it down. A live meter shows the frame rate on both threads the whole time. Unfold the phone and the library opens into a sidebar and the song list side by side.',
    vi: {
      title: 'Thư viện nhạc',
      description:
        'Thư viện 10.000 bài hát, mọi màn hình đều là SwiftUI thật viết bằng React qua Expo UI. Vuốt thật nhanh qua cả thư viện mà chỉ vài chục dòng thật sự tồn tại, gõ là lọc ngay, vuốt một bài để phát tiếp theo, mở trình phát: bìa phóng ra từ mini player, lùi lại khi tạm dừng, và thu nhỏ về chỗ cũ theo ngón tay khi kéo xuống. Đồng hồ hiệu năng hiện số khung hình trên cả hai luồng suốt lúc dùng. Mở gập máy là thư viện tách thành thanh bên và danh sách bài cạnh nhau.',
    },
    author: 'VG Team',
    component: Library,
    hideClose: true,
  },
  {
    id: 'juice',
    title: 'Juice',
    description:
      'Plug in and watch your phone drink. The battery is a glass cell of liquid light: the charge comes in where the cable does, a stream of light races across the floor into the dock and pours up into the cell, and the liquid stays level as you tilt the phone. When it will be full, how fast it is charging, and how to keep the battery healthy.',
    vi: {
      title: 'Nạp pin',
      description:
        'Cắm sạc là thấy máy uống điện. Viên pin là một ống thuỷ tinh chứa ánh sáng lỏng: dòng điện vào đúng chỗ cắm cáp, một dải sáng chạy vụt qua sàn vào đế rồi trào lên trong pin, và mặt nước luôn nằm ngang khi bạn nghiêng máy. Kèm theo bao lâu nữa đầy, sạc nhanh hay chậm và cách giữ pin bền.',
    },
    author: 'VG Team',
    component: Juice,
  },
  {
    id: 'fairy-globe',
    title: 'Snow Globe',
    description:
      "Rothenburg on Christmas Eve, under glass on a music box, Santa's sleigh circling over the roofs. Wind the key in its side and the music box plays Silent Night, and the tune takes you in: through the glass after the sleigh, round the tree in the square, onto a roof and down its chimney to a present by the fire, then back out of the window as the team takes off, and out to the shelf. Shake the phone for a snowstorm; tilt it and the snow drifts.",
    vi: {
      title: 'Quả cầu tuyết',
      description:
        'Rothenburg đêm Giáng sinh trong quả cầu tuyết đặt trên hộp nhạc, xe tuần lộc của ông già Noel bay vòng trên mái nhà. Vặn chìa bên hông là hộp nhạc chơi Silent Night, và theo tiếng nhạc bạn bay vào trong: xuyên qua kính theo xe tuần lộc, vòng quanh cây thông giữa quảng trường, đáp lên mái nhà và chui xuống ống khói tới món quà bên lò sưởi, rồi lùi ra qua cửa sổ khi đoàn tuần lộc cất cánh, và trở về kệ. Lắc máy là bão tuyết; nghiêng máy là tuyết trôi theo.',
    },
    author: 'VG Team',
    component: FairyGlobe,
  },
  {
    id: 'corner-shop',
    title: 'Corner Shop',
    description:
      'A papercraft gadget shop whose front door is your folding iPhone. Open the phone and the door swings open on its hinge, the bell rings, the lights come on bulb by bulb and you walk in. Tap what you want into the bag, fold the phone to walk out, and open your own front door at home to find it all set out on your desk.',
    vi: {
      title: 'Tiệm đồ công nghệ',
      description:
        'Một tiệm đồ công nghệ bằng giấy mà cửa chính là chiếc iPhone gập. Mở máy là cửa mở theo bản lề, chuông kêu, đèn sáng từng bóng, bước vào tiệm. Chạm để bỏ đồ vào túi, gập máy để ra về, rồi mở cửa nhà mình: đồ vừa mua được bày lên bàn làm việc.',
    },
    author: 'VG Team',
    component: CornerShop,
  },
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
      'Shopping where things feel like things: 3D products lift off their cards and spin through the air into a market net bag that sags and swells with the weight. Tip the bag out and it files itself into your cart; hold to pay and everything hops back in, the drawstring is pulled and the bag is carried off, and a check is written out in Skia under a burst of confetti.',
    vi: {
      title: 'Túi đi chợ',
      description:
        'Mua sắm mà món đồ có cảm giác thật: sản phẩm 3D nhấc khỏi thẻ, xoay vòng bay vào túi lưới đi chợ, túi phình và trĩu theo sức nặng. Dốc túi ra, đồ tự xếp thành giỏ hàng; giữ để thanh toán, đồ nhảy lại vào túi, dây rút thắt lại, túi được xách đi, rồi dấu check tự vẽ bằng Skia giữa cơn mưa confetti.',
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
