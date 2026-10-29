import layout from '../../../assets/weekly-gacha/art/layout.json';

/**
 * Your week, a capsule at a time, and the art it's drawn with (scripts/blender/weekly_gacha.py).
 * The colours are Rank Up's: the same deep blue world, the same gold, the same type.
 */

export { CONFETTI, MOLTEN, ROUNDED, TONE, WORLD } from '../rank-up/data';

export const MACHINE = require('../../../assets/weekly-gacha/art/machine.png');
export const KNOB = require('../../../assets/weekly-gacha/art/knob.png');
/** Where the knob and the chute are on the machine's picture, as fractions of it */
export const LAYOUT = layout;

export type Colour = 'blue' | 'orange' | 'navy' | 'pearl' | 'gold';
export const CAPSULE: Record<Colour, { top: number; bottom: number }> = {
  blue: {
    top: require('../../../assets/weekly-gacha/art/capsule-blue-top.png'),
    bottom: require('../../../assets/weekly-gacha/art/capsule-blue-bottom.png'),
  },
  orange: {
    top: require('../../../assets/weekly-gacha/art/capsule-orange-top.png'),
    bottom: require('../../../assets/weekly-gacha/art/capsule-orange-bottom.png'),
  },
  navy: {
    top: require('../../../assets/weekly-gacha/art/capsule-navy-top.png'),
    bottom: require('../../../assets/weekly-gacha/art/capsule-navy-bottom.png'),
  },
  pearl: {
    top: require('../../../assets/weekly-gacha/art/capsule-pearl-top.png'),
    bottom: require('../../../assets/weekly-gacha/art/capsule-pearl-bottom.png'),
  },
  gold: {
    top: require('../../../assets/weekly-gacha/art/capsule-gold-top.png'),
    bottom: require('../../../assets/weekly-gacha/art/capsule-gold-bottom.png'),
  },
};

export type Item = 'bolt' | 'flame' | 'books' | 'hourglass' | 'trophy';
/** Each prize turning round once, FRAMES frames in an atlas COLS across */
export const ITEM: Record<Item, number> = {
  bolt: require('../../../assets/weekly-gacha/art/item-bolt.png'),
  flame: require('../../../assets/weekly-gacha/art/item-flame.png'),
  books: require('../../../assets/weekly-gacha/art/item-books.png'),
  hourglass: require('../../../assets/weekly-gacha/art/item-hourglass.png'),
  trophy: require('../../../assets/weekly-gacha/art/item-trophy.png'),
};

export type Prize = {
  item: Item;
  colour: Colour;
  /** What it counts up to, and how that's written */
  value: number;
  show: (n: number) => string;
  /** Under the number, and a line under that */
  label: string;
  line: string;
};

const grouped = (n: number) => Math.round(n).toLocaleString('en-US');

/** The week, in the order the capsules come out: the last one's the big one */
export const WEEK: Prize[] = [
  {
    item: 'bolt',
    colour: 'blue',
    value: 1935,
    show: grouped,
    label: 'XP earned',
    line: 'Your best week yet, 412 up on last',
  },
  { item: 'flame', colour: 'orange', value: 12, show: grouped, label: 'day streak', line: 'Not a single day missed' },
  {
    item: 'books',
    colour: 'navy',
    value: 23,
    show: grouped,
    label: 'lessons done',
    line: 'Mostly Spanish. ¡Muy bien!',
  },
  {
    item: 'hourglass',
    colour: 'pearl',
    value: 192,
    show: (n) => `${Math.floor(Math.round(n) / 60)}h ${String(Math.round(n) % 60).padStart(2, '0')}m`,
    label: 'spent learning',
    line: 'Night owl: most of it after 10 pm',
  },
  {
    item: 'trophy',
    colour: 'gold',
    value: 1,
    show: () => 'Gold',
    label: 'league, promoted',
    line: '#1 in Silver with 1,935 XP',
  },
];

export const WEEK_NAME = 'Week 43';
