/**
 * What the shop sells. Each product is a little 3D model (see products3d.ts): Market Bag shows them
 * as renders baked from those models, Unboxing as the models themselves.
 */

export type Category = 'Gear' | 'Style' | 'Home' | 'Food';
export const CATEGORIES: ('All' | Category)[] = ['All', 'Gear', 'Style', 'Home', 'Food'];

export type Product = {
  id: number;
  name: string;
  /** A few words under the name */
  note: string;
  /** A line or two about it, for its detail page */
  about: string;
  category: Category;
  /** Price in đồng */
  price: number;
  /** For the product wherever it's named in text */
  art: string;
  /** The card's colour */
  tint: string;
};

export const PRODUCTS: Product[] = [
  {
    id: 0,
    name: 'Studio Headphones',
    note: 'Wireless · ANC',
    about: 'Over-ear, with 40 hours of battery and noise cancelling that quiets a bus ride to nothing.',
    category: 'Gear',
    price: 2490000,
    art: '🎧',
    tint: '#E9E4FF',
  },
  {
    id: 1,
    name: 'Court Sneakers',
    note: 'Leather · EU 42',
    about: 'White full-grain leather on a gum sole, stitched all the way round. Breaks in, never down.',
    category: 'Style',
    price: 1850000,
    art: '👟',
    tint: '#FFE7DA',
  },
  {
    id: 2,
    name: 'Film Camera',
    note: '35mm · 1978',
    about: 'A rangefinder from 1978, serviced and light-sealed. Loaded with a roll of Portra to start.',
    category: 'Gear',
    price: 3200000,
    art: '📷',
    tint: '#E3F1FF',
  },
  {
    id: 3,
    name: 'Robusta Beans',
    note: 'Đắk Lắk · 500g',
    about: 'Robusta from the hills above Buôn Ma Thuột, roasted plain and dark. Made for phin and condensed milk.',
    category: 'Food',
    price: 185000,
    art: '🫘',
    tint: '#F3E8DC',
  },
  {
    id: 4,
    name: 'Monstera',
    note: 'Ø 18 cm pot',
    about: 'Monstera deliciosa with big split leaves, in a terracotta pot. Likes bright shade and a weekly drink.',
    category: 'Home',
    price: 320000,
    art: '🪴',
    tint: '#E2F5E5',
  },
  {
    id: 5,
    name: 'Sunglasses',
    note: 'Polarised',
    about: 'Tortoiseshell acetate frames with green polarised lenses that cut the glare off the river.',
    category: 'Style',
    price: 690000,
    art: '🕶️',
    tint: '#FFF3C9',
  },
  {
    id: 6,
    name: 'Teddy',
    note: 'Handmade',
    about: 'Sewn by hand in Hội An from soft wool felt, with a red silk bow.',
    category: 'Home',
    price: 280000,
    art: '🧸',
    tint: '#FCE6EE',
  },
  {
    id: 7,
    name: 'Skateboard',
    note: 'Maple deck',
    about: 'Seven-ply Canadian maple, medium concave, on 52 mm wheels for the park and the street.',
    category: 'Gear',
    price: 1250000,
    art: '🛹',
    tint: '#E6F7F4',
  },
  {
    id: 8,
    name: 'Desk Lamp',
    note: 'Brass · warm',
    about: 'A brass arm and an enamel shade on a weighted base. Warm light, angled where you need it.',
    category: 'Home',
    price: 540000,
    art: '💡',
    tint: '#FFF6DE',
  },
  {
    id: 9,
    name: 'Guitar',
    note: 'Acoustic',
    about: 'A solid spruce top on a mahogany body, strung light and set up low so it plays easy.',
    category: 'Gear',
    price: 2790000,
    art: '🎸',
    tint: '#FFE9E2',
  },
  {
    id: 10,
    name: 'Backpack',
    note: 'Waxed canvas',
    about: 'Waxed canvas and leather, with a padded sleeve for a laptop and room for a day out.',
    category: 'Style',
    price: 890000,
    art: '🎒',
    tint: '#E6EEFF',
  },
  {
    id: 11,
    name: 'Watermelon',
    note: 'Long An · 3 kg',
    about: 'Sweet, red to the rind, from the fields of Long An. Picked the morning it ships.',
    category: 'Food',
    price: 45000,
    art: '🍉',
    tint: '#E8F7E0',
  },
  {
    id: 12,
    name: 'Fresh Milk',
    note: 'Ba Vì · 1 litre',
    about: 'Pasteurised the morning it was milked, on the hills of Ba Vì. No sugar, nothing added.',
    category: 'Food',
    price: 42000,
    art: '🥛',
    tint: '#E4F1FB',
  },
  {
    id: 13,
    name: 'Free-range Eggs',
    note: 'Tray of ten',
    about: 'From hens that scratch round an orchard in Hưng Yên. Deep orange yolks, thick whites.',
    category: 'Food',
    price: 38000,
    art: '🥚',
    tint: '#FBF1E4',
  },
  {
    id: 14,
    name: 'Coconut Ice Cream',
    note: 'Bến Tre · 450 ml',
    about: 'Churned with coconut milk and toasted flakes from Bến Tre. Soft straight out of the freezer.',
    category: 'Food',
    price: 65000,
    art: '🍨',
    tint: '#E2F4EE',
  },
  {
    id: 15,
    name: 'Cát Hòa Lộc Mango',
    note: 'Tiền Giang · 1 kg',
    about: 'Long, golden and fragrant, ripened on the tree. Best cold, cut into cheeks.',
    category: 'Food',
    price: 95000,
    art: '🥭',
    tint: '#FFF2D6',
  },
];

export const formatVnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN').replace(/,/g, '.')} ₫`;
