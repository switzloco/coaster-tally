/**
 * @fileOverview Offline-first NIAAA Standard Drink reconciler & 100+ beverage reference database.
 *
 * Works 100% deterministically in browser or server with zero network calls:
 * - Recognizes 100+ beers, wines, spirits, classic cocktails, seltzers, ciders, sake/soju,
 *   zero-proof/NA options, and "clear day" / "alcohol free" entries.
 * - Parses multipliers ("2 hazy IPAs", "3 Miller Lites", "double G&T", "half bottle cab")
 *   and explicit volumes/ABVs ("16oz 6.8%", "375ml 14%", "5oz wine").
 */

import {
  calculateStandardUnits,
  getSunnySwapSuggestion,
  mlToOz,
  type DrinkCategory,
} from './drink-units';

export interface DrinkDatabaseProfile {
  id: string;
  canonicalName: string;
  category: DrinkCategory;
  keywords: string[];
  defaultVolumeOz: number;
  defaultAbvPct: number;
  zeroProof?: boolean;
  clearDay?: boolean;
  /** Default single-bottle volume in oz for wine/spirits when "bottle" is specified */
  bottleVolumeOz?: number;
}

export const DRINK_CATEGORY_DEFAULTS: Record<
  DrinkCategory,
  { volumeOz: number; abvPct: number }
> = {
  beer: { volumeOz: 12, abvPct: 5.0 },
  wine: { volumeOz: 5, abvPct: 12.0 },
  spirits: { volumeOz: 1.5, abvPct: 40.0 },
  cocktail: { volumeOz: 4, abvPct: 22.0 },
  seltzer: { volumeOz: 12, abvPct: 5.0 },
  'zero-proof': { volumeOz: 12, abvPct: 0 },
  'clear-day': { volumeOz: 0, abvPct: 0 },
};

export interface ReconciledDrink {
  name: string;
  canonicalName: string;
  category: DrinkCategory;
  quantity: number;
  volumeOz: number;
  unitVolumeOz: number;
  abvPct: number;
  units: number;
  standardUnits: number;
  isZeroProof: boolean;
  zeroProof: boolean;
  isClearDay: boolean;
  matched: boolean;
  alternativeSuggested?: string;
}

const WINE_BOTTLE_OZ = mlToOz(750); // ~25.36 fl oz
const SOJU_BOTTLE_OZ = mlToOz(360); // ~12.17 fl oz

export const DRINK_DATABASE: ReadonlyArray<DrinkDatabaseProfile> = [
  // ── Clear Day Triggers ─────────────────────────────────────────────────────
  {
    id: 'clear-day',
    canonicalName: 'Clear Day (Alcohol-Free)',
    category: 'clear-day',
    keywords: [
      'clear day',
      'alcohol free day',
      'alcohol-free day',
      'alcohol free',
      'alcohol-free',
      'af day',
      'dry day',
      'zero drinks',
      'no alcohol today',
      'sober day',
      'took the night off',
    ],
    defaultVolumeOz: 0,
    defaultAbvPct: 0,
    clearDay: true,
  },

  // ── Zero-Proof / Non-Alcoholic Beverages ──────────────────────────────────
  {
    id: 'athletic-run-wild',
    canonicalName: 'Athletic Run Wild NA IPA',
    category: 'zero-proof',
    keywords: ['athletic run wild', 'run wild', 'athletic brewing', 'athletic ipa'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'athletic-upside-dawn',
    canonicalName: 'Athletic Upside Dawn NA Golden',
    category: 'zero-proof',
    keywords: ['athletic upside dawn', 'upside dawn'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'athletic-free-wave',
    canonicalName: 'Athletic Free Wave NA Hazy',
    category: 'zero-proof',
    keywords: ['athletic free wave', 'free wave', 'athletic hazy'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'heineken-zero',
    canonicalName: 'Heineken 0.0',
    category: 'zero-proof',
    keywords: ['heineken 0.0', 'heineken 0', 'heineken zero'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'corona-cero',
    canonicalName: 'Corona Non-Alcoholic',
    category: 'zero-proof',
    keywords: ['corona non-alcoholic', 'corona cero', 'corona zero', 'corona sunbrew'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'guinness-zero',
    canonicalName: 'Guinness 0.0',
    category: 'zero-proof',
    keywords: ['guinness 0.0', 'guinness 0', 'guinness zero'],
    defaultVolumeOz: 14.9,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'budweiser-zero',
    canonicalName: 'Budweiser Zero',
    category: 'zero-proof',
    keywords: ['budweiser zero', 'bud zero'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'stella-liberte',
    canonicalName: 'Stella Artois Liberte 0.0',
    category: 'zero-proof',
    keywords: ['stella liberte', 'stella zero', 'stella 0.0'],
    defaultVolumeOz: 11.2,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'hoppy-refresher',
    canonicalName: 'Lagunitas Hoppy Refresher',
    category: 'zero-proof',
    keywords: ['hoppy refresher', 'lagunitas hoppy refresher', 'lagunitas ipna'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'hop-water',
    canonicalName: 'Hop Water (Zero-Proof)',
    category: 'zero-proof',
    keywords: ['hop water', 'hoplark', 'sierra nevada hop splash', 'hop splash'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'phony-negroni',
    canonicalName: 'St. Agrestis Phony Negroni',
    category: 'zero-proof',
    keywords: ['phony negroni', 'st agrestis phony', 'na negroni', 'non-alcoholic negroni'],
    defaultVolumeOz: 6.8,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'seedlip',
    canonicalName: 'Seedlip Botanical Zero-Proof',
    category: 'zero-proof',
    keywords: ['seedlip', 'seedlip garden', 'seedlip spice', 'seedlip grove'],
    defaultVolumeOz: 10,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'ghia',
    canonicalName: 'Ghia Non-Alcoholic Spritz',
    category: 'zero-proof',
    keywords: ['ghia', 'ghia spritz', 'le spritz'],
    defaultVolumeOz: 8,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'sparkling-yuzu',
    canonicalName: 'Sparkling Yuzu Tonic',
    category: 'zero-proof',
    keywords: ['sparkling yuzu', 'yuzu soda', 'yuzu tonic', 'yuzu spritz'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'ginger-hibiscus',
    canonicalName: 'Ginger Hibiscus Fizz',
    category: 'zero-proof',
    keywords: ['ginger hibiscus', 'hibiscus spritz', 'hibiscus fizz', 'hibiscus tea'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'kombucha',
    canonicalName: 'Kombucha (Non-Alcoholic)',
    category: 'zero-proof',
    keywords: ['kombucha', 'gts kombucha', 'health-ade'],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'na-beer-generic',
    canonicalName: 'Non-Alcoholic Beer',
    category: 'zero-proof',
    keywords: [
      'non-alcoholic beer',
      'non alcoholic beer',
      'na beer',
      'n/a beer',
      'na ipa',
      'zero proof beer',
      'zero-proof beer',
      'odouls',
      "o'doul's",
    ],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },
  {
    id: 'mocktail-generic',
    canonicalName: 'Zero-Proof Mocktail',
    category: 'zero-proof',
    keywords: [
      'mocktail',
      'zero proof',
      'zero-proof',
      'virgin mojito',
      'virgin margarita',
      'virgin bloody mary',
      'shirley temple',
      'club soda and lime',
      'club soda lime',
      'soda water and lime',
      'tonic and lime',
      'bitters and soda',
      'sparkling water',
      'seltzer water',
      'na wine',
      'non-alcoholic wine',
    ],
    defaultVolumeOz: 12,
    defaultAbvPct: 0,
    zeroProof: true,
  },

  // ── Light Beers ────────────────────────────────────────────────────────────
  {
    id: 'miller-lite',
    canonicalName: 'Miller Lite',
    category: 'beer',
    keywords: ['miller lite', 'miller light'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.2,
  },
  {
    id: 'coors-light',
    canonicalName: 'Coors Light',
    category: 'beer',
    keywords: ['coors light'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.2,
  },
  {
    id: 'bud-light',
    canonicalName: 'Bud Light',
    category: 'beer',
    keywords: ['bud light'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.2,
  },
  {
    id: 'michelob-ultra',
    canonicalName: 'Michelob Ultra',
    category: 'beer',
    keywords: ['michelob ultra', 'mich ultra'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.2,
  },
  {
    id: 'amstel-light',
    canonicalName: 'Amstel Light',
    category: 'beer',
    keywords: ['amstel light'],
    defaultVolumeOz: 12,
    defaultAbvPct: 3.5,
  },
  {
    id: 'corona-light',
    canonicalName: 'Corona Light',
    category: 'beer',
    keywords: ['corona light', 'corona premier'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.0,
  },
  {
    id: 'light-beer',
    canonicalName: 'Light Beer',
    category: 'beer',
    keywords: ['light beer', 'lite beer'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.2,
  },

  // ── Macro, Pilsners & Lagers ──────────────────────────────────────────────
  {
    id: 'budweiser',
    canonicalName: 'Budweiser',
    category: 'beer',
    keywords: ['budweiser'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },
  {
    id: 'coors-banquet',
    canonicalName: 'Coors Banquet',
    category: 'beer',
    keywords: ['coors banquet', 'coors original'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },
  {
    id: 'miller-high-life',
    canonicalName: 'Miller High Life',
    category: 'beer',
    keywords: ['miller high life', 'high life'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.6,
  },
  {
    id: 'pbr',
    canonicalName: 'Pabst Blue Ribbon',
    category: 'beer',
    keywords: ['pbr', 'pabst blue ribbon', 'pabst'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.8,
  },
  {
    id: 'modelo',
    canonicalName: 'Modelo Especial',
    category: 'beer',
    keywords: ['modelo especial', 'modelo negra', 'modelo'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.4,
  },
  {
    id: 'corona',
    canonicalName: 'Corona Extra',
    category: 'beer',
    keywords: ['corona extra', 'corona familiar', 'corona'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.6,
  },
  {
    id: 'stella-artois',
    canonicalName: 'Stella Artois',
    category: 'beer',
    keywords: ['stella artois', 'stella'],
    defaultVolumeOz: 11.2,
    defaultAbvPct: 5.0,
  },
  {
    id: 'heineken',
    canonicalName: 'Heineken',
    category: 'beer',
    keywords: ['heineken'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },
  {
    id: 'peroni',
    canonicalName: 'Peroni Nastro Azzurro',
    category: 'beer',
    keywords: ['peroni'],
    defaultVolumeOz: 11.2,
    defaultAbvPct: 5.1,
  },
  {
    id: 'sapporo',
    canonicalName: 'Sapporo Premium',
    category: 'beer',
    keywords: ['sapporo'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.9,
  },
  {
    id: 'asahi',
    canonicalName: 'Asahi Super Dry',
    category: 'beer',
    keywords: ['asahi'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.2,
  },
  {
    id: 'dos-equis',
    canonicalName: 'Dos Equis',
    category: 'beer',
    keywords: ['dos equis', 'xx lager'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.2,
  },
  {
    id: 'pacifico',
    canonicalName: 'Pacifico Clara',
    category: 'beer',
    keywords: ['pacifico'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.4,
  },
  {
    id: 'pilsner',
    canonicalName: 'Pilsner',
    category: 'beer',
    keywords: ['pilsner', 'pils', 'urquell'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },
  {
    id: 'lager',
    canonicalName: 'Lager',
    category: 'beer',
    keywords: ['lager', 'helles', 'mexican lager'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },
  {
    id: 'kolsch',
    canonicalName: 'Kolsch',
    category: 'beer',
    keywords: ['kolsch', 'kölsch'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.8,
  },

  // ── Craft Beers, IPAs, Stouts, Sours & Ciders ─────────────────────────────
  {
    id: 'guinness',
    canonicalName: 'Guinness Draught',
    category: 'beer',
    keywords: ['guinness draught', 'guinness'],
    defaultVolumeOz: 14.9,
    defaultAbvPct: 4.2,
  },
  {
    id: 'blue-moon',
    canonicalName: 'Blue Moon Belgian White',
    category: 'beer',
    keywords: ['blue moon', 'belgian white', 'witbier'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.4,
  },
  {
    id: 'allagash-white',
    canonicalName: 'Allagash White',
    category: 'beer',
    keywords: ['allagash white', 'allagash'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.2,
  },
  {
    id: 'hefeweizen',
    canonicalName: 'Hefeweizen / Wheat Beer',
    category: 'beer',
    keywords: ['hefeweizen', 'wheat beer', 'wheat ale'],
    defaultVolumeOz: 16,
    defaultAbvPct: 5.4,
  },
  {
    id: 'pale-ale',
    canonicalName: 'Pale Ale',
    category: 'beer',
    keywords: ['pale ale', 'sierra nevada pale ale', 'sierra nevada'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.6,
  },
  {
    id: 'amber-ale',
    canonicalName: 'Amber / Brown Ale',
    category: 'beer',
    keywords: ['amber ale', 'brown ale', 'red ale', 'fat tire'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.5,
  },
  {
    id: 'session-ipa',
    canonicalName: 'Session IPA',
    category: 'beer',
    keywords: ['session ipa', 'all day ipa'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.7,
  },
  {
    id: 'hazy-ipa',
    canonicalName: 'Hazy IPA',
    category: 'beer',
    keywords: ['hazy ipa', 'juicy ipa', 'neipa', 'new england ipa'],
    defaultVolumeOz: 16,
    defaultAbvPct: 6.8,
  },
  {
    id: 'triple-ipa',
    canonicalName: 'Triple IPA',
    category: 'beer',
    keywords: ['triple ipa', 'tipa'],
    defaultVolumeOz: 16,
    defaultAbvPct: 10.0,
  },
  {
    id: 'double-ipa',
    canonicalName: 'Double / Imperial IPA',
    category: 'beer',
    keywords: ['double ipa', 'imperial ipa', 'dipa', 'pliny', 'voodoo ranger imperial'],
    defaultVolumeOz: 16,
    defaultAbvPct: 8.5,
  },
  {
    id: 'craft-ipa',
    canonicalName: 'Craft IPA',
    category: 'beer',
    keywords: ['craft ipa', 'west coast ipa', 'ipa', 'lagunitas ipa'],
    defaultVolumeOz: 16,
    defaultAbvPct: 7.0,
  },
  {
    id: 'imperial-stout',
    canonicalName: 'Imperial Stout',
    category: 'beer',
    keywords: ['imperial stout', 'barrel aged stout', 'russian imperial stout'],
    defaultVolumeOz: 12,
    defaultAbvPct: 10.5,
  },
  {
    id: 'stout',
    canonicalName: 'Stout / Porter',
    category: 'beer',
    keywords: ['stout', 'porter', 'milk stout'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.8,
  },
  {
    id: 'sour-beer',
    canonicalName: 'Sour Ale / Gose',
    category: 'beer',
    keywords: ['sour beer', 'sour ale', 'gose', 'berliner weisse', 'fruited sour'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.2,
  },
  {
    id: 'belgian-tripel',
    canonicalName: 'Belgian Tripel',
    category: 'beer',
    keywords: ['belgian tripel', 'tripel', 'quadrupel', 'belgian strong'],
    defaultVolumeOz: 12,
    defaultAbvPct: 9.0,
  },
  {
    id: 'hard-cider',
    canonicalName: 'Hard Cider',
    category: 'beer',
    keywords: ['hard cider', 'cider', 'angry orchard', 'ace cider', 'dry cider'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },
  {
    id: 'hard-kombucha',
    canonicalName: 'Hard Kombucha',
    category: 'beer',
    keywords: ['hard kombucha', 'juneshine', 'boochcraft'],
    defaultVolumeOz: 12,
    defaultAbvPct: 6.0,
  },
  {
    id: 'beer-generic',
    canonicalName: 'Beer',
    category: 'beer',
    keywords: ['craft beer', 'draft beer', 'draught', 'beer', 'ale', 'brewski'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },

  // ── Hard Seltzers & Canned RTDs ───────────────────────────────────────────
  {
    id: 'white-claw',
    canonicalName: 'White Claw Hard Seltzer',
    category: 'seltzer',
    keywords: ['white claw'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },
  {
    id: 'truly',
    canonicalName: 'Truly Hard Seltzer',
    category: 'seltzer',
    keywords: ['truly', 'truly seltzer'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },
  {
    id: 'high-noon',
    canonicalName: 'High Noon Sun Sips',
    category: 'seltzer',
    keywords: ['high noon'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.5,
  },
  {
    id: 'topo-chico-hard',
    canonicalName: 'Topo Chico Hard Seltzer',
    category: 'seltzer',
    keywords: ['topo chico hard seltzer', 'topo chico seltzer', 'hard topo chico'],
    defaultVolumeOz: 12,
    defaultAbvPct: 4.7,
  },
  {
    id: 'twisted-tea',
    canonicalName: 'Twisted Tea',
    category: 'seltzer',
    keywords: ['twisted tea', 'hard iced tea'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },
  {
    id: 'cutwater',
    canonicalName: 'Cutwater Canned Cocktail',
    category: 'cocktail',
    keywords: ['cutwater', 'cutwater margarita', 'cutwater mai tai'],
    defaultVolumeOz: 12,
    defaultAbvPct: 12.5,
  },
  {
    id: 'hard-seltzer',
    canonicalName: 'Hard Seltzer',
    category: 'seltzer',
    keywords: ['hard seltzer', 'seltzer', 'surfside', 'spiked seltzer'],
    defaultVolumeOz: 12,
    defaultAbvPct: 5.0,
  },

  // ── Wines, Sparkling, Sake & Soju ─────────────────────────────────────────
  {
    id: 'cabernet',
    canonicalName: 'Cabernet Sauvignon',
    category: 'wine',
    keywords: ['cabernet sauvignon', 'cabernet', 'cab sauv', 'cab'],
    defaultVolumeOz: 5,
    defaultAbvPct: 14.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'pinot-noir',
    canonicalName: 'Pinot Noir',
    category: 'wine',
    keywords: ['pinot noir'],
    defaultVolumeOz: 5,
    defaultAbvPct: 13.5,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'merlot',
    canonicalName: 'Merlot',
    category: 'wine',
    keywords: ['merlot'],
    defaultVolumeOz: 5,
    defaultAbvPct: 13.5,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'malbec',
    canonicalName: 'Malbec',
    category: 'wine',
    keywords: ['malbec'],
    defaultVolumeOz: 5,
    defaultAbvPct: 14.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'syrah',
    canonicalName: 'Syrah / Shiraz',
    category: 'wine',
    keywords: ['syrah', 'shiraz'],
    defaultVolumeOz: 5,
    defaultAbvPct: 14.5,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'zinfandel',
    canonicalName: 'Zinfandel',
    category: 'wine',
    keywords: ['zinfandel', 'zin'],
    defaultVolumeOz: 5,
    defaultAbvPct: 14.5,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'bold-red-wine',
    canonicalName: 'Bold Red Wine',
    category: 'wine',
    keywords: ['bold red', 'bordeaux', 'barolo', 'nebbiolo', 'chianti', 'tempranillo', 'sangiovese'],
    defaultVolumeOz: 6,
    defaultAbvPct: 14.5,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'red-wine',
    canonicalName: 'Red Wine',
    category: 'wine',
    keywords: ['red wine', 'vino tinto'],
    defaultVolumeOz: 5,
    defaultAbvPct: 13.5,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'chardonnay',
    canonicalName: 'Chardonnay',
    category: 'wine',
    keywords: ['chardonnay', 'chard'],
    defaultVolumeOz: 5,
    defaultAbvPct: 13.5,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'sauvignon-blanc',
    canonicalName: 'Sauvignon Blanc',
    category: 'wine',
    keywords: ['sauvignon blanc', 'sauv blanc', 'sancerre'],
    defaultVolumeOz: 5,
    defaultAbvPct: 12.5,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'pinot-grigio',
    canonicalName: 'Pinot Grigio / Gris',
    category: 'wine',
    keywords: ['pinot grigio', 'pinot gris', 'albariño', 'albarino'],
    defaultVolumeOz: 5,
    defaultAbvPct: 12.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'riesling',
    canonicalName: 'Riesling',
    category: 'wine',
    keywords: ['riesling'],
    defaultVolumeOz: 5,
    defaultAbvPct: 11.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'white-wine',
    canonicalName: 'White Wine',
    category: 'wine',
    keywords: ['white wine', 'chablis', 'chenin blanc'],
    defaultVolumeOz: 5,
    defaultAbvPct: 12.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'rose-wine',
    canonicalName: 'Rose Wine',
    category: 'wine',
    keywords: ['rosé', 'rose wine', 'frosé', 'frose', 'glass of rose', 'glass of rosé'],
    defaultVolumeOz: 5,
    defaultAbvPct: 12.5,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'orange-wine',
    canonicalName: 'Orange / Skin-Contact Wine',
    category: 'wine',
    keywords: ['orange wine', 'skin contact wine', 'skin-contact'],
    defaultVolumeOz: 5,
    defaultAbvPct: 12.5,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'champagne',
    canonicalName: 'Champagne / Sparkling Wine',
    category: 'wine',
    keywords: ['champagne', 'prosecco', 'cava', 'sparkling wine', 'cremant', 'brut'],
    defaultVolumeOz: 5,
    defaultAbvPct: 12.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'port-wine',
    canonicalName: 'Port / Sherry',
    category: 'wine',
    keywords: ['port wine', 'tawny port', 'sherry', 'madeira'],
    defaultVolumeOz: 3,
    defaultAbvPct: 20.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'sake',
    canonicalName: 'Sake',
    category: 'wine',
    keywords: ['sake', 'junmai', 'nigori'],
    defaultVolumeOz: 5,
    defaultAbvPct: 15.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'soju',
    canonicalName: 'Soju',
    category: 'wine',
    keywords: ['soju', 'jinro', 'chum churum'],
    defaultVolumeOz: SOJU_BOTTLE_OZ,
    defaultAbvPct: 13.0,
    bottleVolumeOz: SOJU_BOTTLE_OZ,
  },
  {
    id: 'wine-generic',
    canonicalName: 'Table Wine',
    category: 'wine',
    keywords: ['wine', 'vino', 'natural wine', 'house red', 'house white'],
    defaultVolumeOz: 5,
    defaultAbvPct: 12.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },

  // ── Spirits (Neat / Rocks / Shots) ────────────────────────────────────────
  {
    id: 'bourbon',
    canonicalName: 'Whiskey / Bourbon',
    category: 'spirits',
    keywords: ['bourbon', 'whiskey', 'whisky', 'rye whiskey', 'tennessee whiskey'],
    defaultVolumeOz: 1.5,
    defaultAbvPct: 40.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'scotch',
    canonicalName: 'Scotch Whisky',
    category: 'spirits',
    keywords: ['scotch', 'single malt'],
    defaultVolumeOz: 1.5,
    defaultAbvPct: 43.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'vodka',
    canonicalName: 'Vodka',
    category: 'spirits',
    keywords: ['vodka'],
    defaultVolumeOz: 1.5,
    defaultAbvPct: 40.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'tequila',
    canonicalName: 'Tequila',
    category: 'spirits',
    keywords: ['tequila', 'blanco', 'reposado', 'anejo'],
    defaultVolumeOz: 1.5,
    defaultAbvPct: 40.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'mezcal',
    canonicalName: 'Mezcal',
    category: 'spirits',
    keywords: ['mezcal'],
    defaultVolumeOz: 1.5,
    defaultAbvPct: 42.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'gin',
    canonicalName: 'Gin',
    category: 'spirits',
    keywords: ['gin'],
    defaultVolumeOz: 1.5,
    defaultAbvPct: 40.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'rum',
    canonicalName: 'Rum',
    category: 'spirits',
    keywords: ['rum', 'spiced rum', 'dark rum'],
    defaultVolumeOz: 1.5,
    defaultAbvPct: 40.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'cognac',
    canonicalName: 'Brandy / Cognac',
    category: 'spirits',
    keywords: ['cognac', 'brandy', 'hennessy'],
    defaultVolumeOz: 1.5,
    defaultAbvPct: 40.0,
    bottleVolumeOz: WINE_BOTTLE_OZ,
  },
  {
    id: 'amaro',
    canonicalName: 'Amaro / Digestif',
    category: 'spirits',
    keywords: ['amaro', 'fernet', 'chartreuse', 'campari', 'jagermeister'],
    defaultVolumeOz: 1.5,
    defaultAbvPct: 35.0,
  },
  {
    id: 'shot-generic',
    canonicalName: 'Spirit Shot',
    category: 'spirits',
    keywords: ['shot', 'jigger', 'dram'],
    defaultVolumeOz: 1.5,
    defaultAbvPct: 40.0,
  },

  // ── Classic Cocktails ─────────────────────────────────────────────────────
  {
    id: 'margarita',
    canonicalName: 'Margarita',
    category: 'cocktail',
    keywords: ['margarita', 'spicy margarita', 'cadillac margarita', 'marg'],
    defaultVolumeOz: 4.5,
    defaultAbvPct: 22.0, // ~1.7u
  },
  {
    id: 'negroni',
    canonicalName: 'Negroni',
    category: 'cocktail',
    keywords: ['negroni', 'boulevardier'],
    defaultVolumeOz: 3.0,
    defaultAbvPct: 28.0, // 1.4u
  },
  {
    id: 'old-fashioned',
    canonicalName: 'Old Fashioned',
    category: 'cocktail',
    keywords: ['old fashioned', 'old-fashioned'],
    defaultVolumeOz: 2.5,
    defaultAbvPct: 35.0, // 1.5u
  },
  {
    id: 'manhattan',
    canonicalName: 'Manhattan',
    category: 'cocktail',
    keywords: ['manhattan'],
    defaultVolumeOz: 3.0,
    defaultAbvPct: 32.0, // 1.6u
  },
  {
    id: 'espresso-martini',
    canonicalName: 'Espresso Martini',
    category: 'cocktail',
    keywords: ['espresso martini'],
    defaultVolumeOz: 3.5,
    defaultAbvPct: 24.0, // 1.4u
  },
  {
    id: 'dirty-martini',
    canonicalName: 'Dirty Martini',
    category: 'cocktail',
    keywords: ['dirty martini', 'vodka martini', 'gin martini', 'martini'],
    defaultVolumeOz: 3.5,
    defaultAbvPct: 32.0, // 1.9u
  },
  {
    id: 'aperol-spritz',
    canonicalName: 'Aperol Spritz',
    category: 'cocktail',
    keywords: ['aperol spritz', 'hugo spritz', 'spritz'],
    defaultVolumeOz: 6.0,
    defaultAbvPct: 11.0, // 1.1u
  },
  {
    id: 'mimosa',
    canonicalName: 'Mimosa / Bellini',
    category: 'cocktail',
    keywords: ['mimosa', 'bellini'],
    defaultVolumeOz: 5.0,
    defaultAbvPct: 9.0, // 0.8u
  },
  {
    id: 'moscow-mule',
    canonicalName: 'Moscow Mule',
    category: 'cocktail',
    keywords: ['moscow mule', 'kentucky mule', 'mexican mule'],
    defaultVolumeOz: 6.0,
    defaultAbvPct: 11.0, // 1.1u
  },
  {
    id: 'gin-and-tonic',
    canonicalName: 'Gin & Tonic',
    category: 'cocktail',
    keywords: ['gin and tonic', 'gin & tonic', 'g&t', 'g & t'],
    defaultVolumeOz: 6.0,
    defaultAbvPct: 10.0, // 1.0u (allows "double G&T" -> 2.0u)
  },
  {
    id: 'vodka-soda',
    canonicalName: 'Vodka Soda / Highball',
    category: 'cocktail',
    keywords: [
      'vodka soda',
      'vodka and soda',
      'vodka tonic',
      'vodka and tonic',
      'tequila soda',
      'tequila and soda',
      'whiskey ginger',
      'whiskey and ginger',
      'rum and coke',
      'rum & coke',
      'jack and coke',
      'whiskey and coke',
      'highball',
      'ranch water',
    ],
    defaultVolumeOz: 6.0,
    defaultAbvPct: 10.0, // 1.0u
  },
  {
    id: 'whiskey-sour',
    canonicalName: 'Whiskey Sour',
    category: 'cocktail',
    keywords: ['whiskey sour', 'amaretto sour'],
    defaultVolumeOz: 4.0,
    defaultAbvPct: 20.0, // 1.3u
  },
  {
    id: 'paloma',
    canonicalName: 'Paloma',
    category: 'cocktail',
    keywords: ['paloma'],
    defaultVolumeOz: 6.0,
    defaultAbvPct: 11.0, // 1.1u
  },
  {
    id: 'bloody-mary',
    canonicalName: 'Bloody Mary',
    category: 'cocktail',
    keywords: ['bloody mary', 'michelada'],
    defaultVolumeOz: 6.0,
    defaultAbvPct: 10.0, // 1.0u
  },
  {
    id: 'mojito',
    canonicalName: 'Mojito',
    category: 'cocktail',
    keywords: ['mojito'],
    defaultVolumeOz: 6.0,
    defaultAbvPct: 11.0, // 1.1u
  },
  {
    id: 'cosmopolitan',
    canonicalName: 'Cosmopolitan',
    category: 'cocktail',
    keywords: ['cosmopolitan', 'cosmo'],
    defaultVolumeOz: 3.5,
    defaultAbvPct: 23.0, // 1.3u
  },
  {
    id: 'daiquiri',
    canonicalName: 'Daiquiri',
    category: 'cocktail',
    keywords: ['daiquiri'],
    defaultVolumeOz: 3.5,
    defaultAbvPct: 23.0, // 1.3u
  },
  {
    id: 'mai-tai',
    canonicalName: 'Mai Tai / Tiki Cocktail',
    category: 'cocktail',
    keywords: ['mai tai', 'zombie', 'painkiller', 'pina colada', 'piña colada'],
    defaultVolumeOz: 5.0,
    defaultAbvPct: 24.0, // 2.0u
  },
  {
    id: 'long-island',
    canonicalName: 'Long Island Iced Tea',
    category: 'cocktail',
    keywords: ['long island iced tea', 'long island'],
    defaultVolumeOz: 6.0,
    defaultAbvPct: 25.0, // 2.5u
  },
  {
    id: 'cocktail-generic',
    canonicalName: 'Classic Cocktail',
    category: 'cocktail',
    keywords: ['cocktail', 'mixed drink', 'craft cocktail', 'sazerac', 'paper plane', 'vesper'],
    defaultVolumeOz: 4.0,
    defaultAbvPct: 30.0, // 2.0u
  },
];

// Precompute keyword search index sorted longest-keyword-first so specific matches
// ("phony negroni", "heineken 0.0", "double ipa") always outrank generic ("negroni", "heineken", "ipa").
interface IndexedKeyword {
  profile: DrinkDatabaseProfile;
  keyword: string;
  regex: RegExp;
}

const KEYWORD_INDEX: IndexedKeyword[] = DRINK_DATABASE.flatMap((profile) =>
  profile.keywords.map((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      profile,
      keyword,
      regex: new RegExp(`(?:^|[^a-z0-9])${escaped}(?:s|es)?(?=$|[^a-z0-9])`, 'i'),
    };
  })
).sort((a, b) => b.keyword.length - a.keyword.length);

const WORD_NUMBER_MAP: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  couple: 2,
  pair: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  half: 0.5,
};

function findDrinkProfile(text: string): DrinkDatabaseProfile | null {
  for (const entry of KEYWORD_INDEX) {
    if (entry.regex.test(text)) {
      return entry.profile;
    }
  }
  return null;
}

function parseExplicitVolumeOz(lower: string): number | null {
  const ozMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|oz|ounces?)\b/);
  if (ozMatch) {
    const val = Number(ozMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  const mlMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:ml|milliliters?)\b/);
  if (mlMatch) {
    const val = mlToOz(Number(mlMatch[1]));
    if (val > 0) return val;
  }

  const literMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:l|liters?)\b/);
  if (literMatch) {
    const val = mlToOz(Number(literMatch[1]) * 1000);
    if (val > 0) return val;
  }

  return null;
}

function parseExplicitAbvPct(lower: string): number | null {
  const pctMatch = lower.match(/(\d+(?:\.\d+)?)\s*%\s*(?:abv)?/);
  if (pctMatch) {
    const val = Number(pctMatch[1]);
    if (Number.isFinite(val) && val >= 0 && val <= 100) return val;
  }

  const abvMatch = lower.match(/\babv\s*[:=]?\s*(\d+(?:\.\d+)?)\b/);
  if (abvMatch) {
    const val = Number(abvMatch[1]);
    if (Number.isFinite(val) && val >= 0 && val <= 100) return val;
  }

  return null;
}

function parseQuantityAndVessel(
  lower: string,
  profile: DrinkDatabaseProfile | null
): { quantity: number; vesselVolumeOz: number | null } {
  let quantity = 1;
  let vesselVolumeOz: number | null = null;

  // Check half-bottle / bottle first before generic multipliers
  const isHalfBottle = /\bhalf(?:\s+a)?\s+bottle\b/.test(lower);
  const isBottle = !isHalfBottle && /\bbottle\b/.test(lower);

  if (isHalfBottle) {
    vesselVolumeOz = profile?.bottleVolumeOz
      ? Math.round((profile.bottleVolumeOz / 2) * 100) / 100
      : mlToOz(375); // ~12.68oz
  } else if (isBottle) {
    if (profile?.category === 'beer' || profile?.category === 'seltzer') {
      vesselVolumeOz = 12;
    } else {
      vesselVolumeOz = profile?.bottleVolumeOz ?? WINE_BOTTLE_OZ;
    }
  } else if (/\bpitcher\b/.test(lower)) {
    vesselVolumeOz = 60;
  } else if (/\bcarafe\b/.test(lower)) {
    vesselVolumeOz = mlToOz(500);
  } else if (/\bstovepipe\b/.test(lower)) {
    vesselVolumeOz = 19.2;
  } else if (/\b(?:pint|tallboy|tall\s+boy|pounder)\b/.test(lower)) {
    vesselVolumeOz = 16;
  } else if (/\bcan\b/.test(lower) && profile?.category === 'beer') {
    vesselVolumeOz = 12;
  } else if (/\b(?:large\s+glass|heavy\s+pour)\b/.test(lower) && profile?.category === 'wine') {
    vesselVolumeOz = 8;
  }

  // Multiplier extraction (careful not to confuse "double IPA" / "triple IPA" with 2x / 3x!)
  const strippedStyle = lower
    .replace(/\b(?:double|imperial|triple)\s+ipa\b/g, '')
    .replace(/\b0\.0\b/g, '');

  const xCountMatch = strippedStyle.match(/\b(\d+(?:\.\d+)?)\s*x\b/);
  const leadingCountMatch = strippedStyle.match(/^\s*(\d+(?:\.\d+)?)\b(?!\s*(?:%|oz|fl\.?\s*oz|ml|l\b))/);
  const wordCountMatch = strippedStyle.match(
    /^\s*(?:a\s+)?(couple|pair|one|two|three|four|five|six|seven|eight|half)\b(?:\s+of)?/
  );

  if (xCountMatch) {
    const q = Number(xCountMatch[1]);
    if (Number.isFinite(q) && q > 0 && q <= 30) quantity = q;
  } else if (leadingCountMatch) {
    const q = Number(leadingCountMatch[1]);
    if (Number.isFinite(q) && q > 0 && q <= 30) quantity = q;
  } else if (wordCountMatch && !isHalfBottle) {
    quantity = WORD_NUMBER_MAP[wordCountMatch[1]] ?? 1;
  }

  if (/\bdouble\b/.test(strippedStyle) && quantity === 1) {
    quantity = 2;
  } else if (/\btriple\b/.test(strippedStyle) && quantity === 1) {
    quantity = 3;
  }

  return { quantity, vesselVolumeOz };
}

function inferFallbackCategory(volumeOz: number, abvPct: number): DrinkCategory {
  if (abvPct <= 0) return 'zero-proof';
  if (abvPct >= 25) return volumeOz <= 2.5 ? 'spirits' : 'cocktail';
  if (abvPct >= 9 && volumeOz <= 13) return 'wine';
  return 'beer';
}

function round1(val: number): number {
  return Math.max(0, Math.round((val + 1e-9) * 10) / 10);
}

/**
 * Parses a single beverage description or shorthand into an exact NIAAA Standard Drink result.
 * Returns `null` when the text contains neither a known beverage nor explicit volume+ABV.
 */
export function reconcileDrinkDescription(text: string): ReconciledDrink | null {
  const cleaned = (text || '').trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  const profile = findDrinkProfile(lower);
  const explicitOz = parseExplicitVolumeOz(lower);
  const explicitAbv = parseExplicitAbvPct(lower);

  if (!profile && (explicitOz === null || explicitAbv === null)) {
    return null;
  }

  if (profile?.clearDay) {
    return {
      name: profile.canonicalName,
      canonicalName: profile.canonicalName,
      category: 'clear-day',
      quantity: 1,
      volumeOz: 0,
      unitVolumeOz: 0,
      abvPct: 0,
      units: 0,
      standardUnits: 0,
      isZeroProof: false,
      zeroProof: false,
      isClearDay: true,
      matched: true,
    };
  }

  const { quantity, vesselVolumeOz } = parseQuantityAndVessel(lower, profile);
  const unitVolumeOz = round1(
    explicitOz ?? vesselVolumeOz ?? profile?.defaultVolumeOz ?? 12
  );
  const abvPct =
    explicitAbv !== null
      ? round1(explicitAbv)
      : round1(profile?.defaultAbvPct ?? 5.0);

  const isZeroProof = Boolean(profile?.zeroProof || abvPct === 0);
  const category: DrinkCategory = isZeroProof
    ? 'zero-proof'
    : profile?.category ?? inferFallbackCategory(unitVolumeOz, abvPct);

  const totalVolumeOz = round1(unitVolumeOz * quantity);
  const units = isZeroProof ? 0 : calculateStandardUnits(unitVolumeOz * quantity, abvPct);

  const baseName =
    profile?.canonicalName ??
    `${unitVolumeOz}oz ${abvPct}% ${category === 'wine' ? 'Wine' : category === 'spirits' ? 'Spirit' : 'Drink'}`;
  const displayName = quantity !== 1 ? `${quantity}x ${baseName}` : baseName;

  return {
    name: displayName,
    canonicalName: baseName,
    category,
    quantity,
    volumeOz: totalVolumeOz,
    unitVolumeOz,
    abvPct: isZeroProof ? 0 : abvPct,
    units,
    standardUnits: units,
    isZeroProof,
    zeroProof: isZeroProof,
    isClearDay: false,
    matched: Boolean(profile),
    ...(!isZeroProof ? { alternativeSuggested: getSunnySwapSuggestion(category, Math.round(units * 10)) } : {}),
  };
}

const COMPOUND_AND_DRINKS = [
  'gin and tonic',
  'rum and coke',
  'jack and coke',
  'whiskey and coke',
  'vodka and soda',
  'vodka and tonic',
  'tequila and soda',
  'whiskey and ginger',
  'bourbon and ginger',
  'campari and soda',
  'aperol and soda',
  'bitters and soda',
  'club soda and lime',
  'soda water and lime',
  'tonic and lime',
];

function splitDrinkPhraseList(text: string): string[] {
  let working = text.trim();
  if (!working) return [];

  for (const phrase of COMPOUND_AND_DRINKS) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    working = working.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (m) =>
      m.replace(/\sand\s/i, '\u0000AND\u0000')
    );
  }

  return working
    .split(/[,;\n]+|\s+\+\s+|\s+(?:and|then|plus)\s+/i)
    .map((chunk) => chunk.replace(/\u0000AND\u0000/g, ' and ').trim())
    .filter(Boolean);
}

export interface RawDrinkCandidateInput {
  name: string;
  quantityText?: string;
  quantity?: number;
  volumeOz?: number;
  abvPct?: number;
  category?: DrinkCategory;
  units?: number;
  standardUnits?: number;
  isZeroProof?: boolean;
  zeroProof?: boolean;
  isClearDay?: boolean;
}

/**
 * Reconciles either a natural-language drink string (possibly multiple pours)
 * or an array of structured AI-parsed drink candidates against NIAAA Standard Drink math.
 */
export function reconcileDrinkItems(
  input: string | Array<string | RawDrinkCandidateInput>
): ReconciledDrink[] {
  if (typeof input === 'string') {
    const chunks = splitDrinkPhraseList(input);
    const results: ReconciledDrink[] = [];
    for (const chunk of chunks) {
      const reconciled = reconcileDrinkDescription(chunk);
      if (reconciled) {
        results.push(reconciled);
      }
    }
    return results;
  }

  if (!Array.isArray(input)) return [];
  const results: ReconciledDrink[] = [];

  for (const item of input) {
    if (typeof item === 'string') {
      const reconciled = reconcileDrinkDescription(item);
      if (reconciled) results.push(reconciled);
      continue;
    }

    if (!item || !item.name) continue;
    const combined = [item.quantityText, item.name].filter(Boolean).join(' ').trim();
    const dbMatch = reconcileDrinkDescription(combined) ?? reconcileDrinkDescription(item.name);

    const quantity =
      typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0
        ? item.quantity
        : dbMatch?.quantity ?? 1;

    const isClearDay = Boolean(item.isClearDay || item.category === 'clear-day' || dbMatch?.isClearDay);
    if (isClearDay) {
      results.push({
        name: dbMatch?.canonicalName || item.name.trim() || 'Clear Day (Alcohol-Free)',
        canonicalName: 'Clear Day (Alcohol-Free)',
        category: 'clear-day',
        quantity: 1,
        volumeOz: 0,
        unitVolumeOz: 0,
        abvPct: 0,
        units: 0,
        standardUnits: 0,
        isZeroProof: false,
        zeroProof: false,
        isClearDay: true,
        matched: true,
      });
      continue;
    }

    const explicitAbv =
      typeof item.abvPct === 'number' && Number.isFinite(item.abvPct) && item.abvPct >= 0
        ? item.abvPct
        : undefined;
    const explicitOz =
      typeof item.volumeOz === 'number' && Number.isFinite(item.volumeOz) && item.volumeOz > 0
        ? item.volumeOz
        : undefined;

    const abvPct = round1(
      explicitAbv !== undefined
        ? explicitAbv
        : dbMatch?.abvPct ?? (item.isZeroProof || item.zeroProof || item.category === 'zero-proof' ? 0 : 5.0)
    );
    const unitVolumeOz = round1(explicitOz ?? dbMatch?.unitVolumeOz ?? 12);
    const totalVolumeOz = round1(unitVolumeOz * quantity);

    const isZeroProof = Boolean(
      item.isZeroProof || item.zeroProof || item.category === 'zero-proof' || dbMatch?.isZeroProof || abvPct === 0
    );
    const category: DrinkCategory = isZeroProof
      ? 'zero-proof'
      : item.category ?? dbMatch?.category ?? inferFallbackCategory(unitVolumeOz, abvPct);

    const units = isZeroProof
      ? 0
      : explicitOz !== undefined || explicitAbv !== undefined
        ? calculateStandardUnits(unitVolumeOz * quantity, abvPct)
        : dbMatch
          ? dbMatch.units
          : typeof item.standardUnits === 'number' && Number.isFinite(item.standardUnits)
            ? round1(item.standardUnits)
            : typeof item.units === 'number' && Number.isFinite(item.units)
              ? round1(item.units)
              : calculateStandardUnits(unitVolumeOz * quantity, abvPct);

    const baseName = dbMatch?.canonicalName || item.name.trim();
    const displayName = quantity !== 1 && !baseName.startsWith(`${quantity}x`)
      ? `${quantity}x ${baseName}`
      : baseName;

    results.push({
      name: displayName,
      canonicalName: baseName,
      category,
      quantity,
      volumeOz: totalVolumeOz,
      unitVolumeOz,
      abvPct: isZeroProof ? 0 : abvPct,
      units,
      standardUnits: units,
      isZeroProof,
      zeroProof: isZeroProof,
      isClearDay: false,
      matched: Boolean(dbMatch?.matched),
      ...(!isZeroProof ? { alternativeSuggested: getSunnySwapSuggestion(category, Math.round(units * 10)) } : {}),
    });
  }

  return results;
}
