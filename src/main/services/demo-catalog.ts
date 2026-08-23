/**
 * The Demo Archive catalogue.
 *
 * Every artist, album and track here is invented. HEARLOGUE has no affiliation
 * with Spotify or with any label, and a demo built from real discographies would
 * blur that line — so the demo listens to a fictional record collection instead.
 *
 * The catalogue is grouped into "scenes". The demo generator moves between
 * scenes over the years, which is what gives the demo archive genuine eras,
 * obsessions and abandonments rather than uniform noise.
 */

export interface DemoAlbum {
  title: string;
  year: number;
  tracks: string[];
}

export interface DemoArtist {
  name: string;
  scene: string;
  albums: DemoAlbum[];
}

export const DEMO_SCENES = [
  'lateNightHipHop',
  'indieGuitars',
  'ambientStudy',
  'houseAndDisco',
  'jazzAndSoul',
  'shoegazeDream',
  'folkAndQuiet',
] as const;

export type DemoScene = (typeof DEMO_SCENES)[number];

export const DEMO_ARTISTS: DemoArtist[] = [
  // ---------------- late night hip hop ----------------
  {
    name: 'Nocturne Bell',
    scene: 'lateNightHipHop',
    albums: [
      {
        title: 'Streetlight Arithmetic',
        year: 2013,
        tracks: ['Counting Blocks', 'Third Shift', 'Payphone Gospel', 'Uptown Fog', 'Cold Cut'],
      },
      {
        title: 'Low Ceilings',
        year: 2016,
        tracks: ['Low Ceilings', 'Ash & Amber', 'Rooftop Sermon', 'Nine Lives Later'],
      },
    ],
  },
  {
    name: 'Marlow Grey',
    scene: 'lateNightHipHop',
    albums: [
      {
        title: 'Paper Rooms',
        year: 2015,
        tracks: ['Paper Rooms', 'Static Bloom', 'Half a Mile', 'Tenant', 'Blue Hour Freestyle'],
      },
      {
        title: 'Weathervane',
        year: 2018,
        tracks: ['Weathervane', 'Southbound', 'Iron Teeth', 'Long Division', 'No Encore'],
      },
    ],
  },
  {
    name: 'Sable Ross',
    scene: 'lateNightHipHop',
    albums: [
      {
        title: 'Tape Hiss Confessions',
        year: 2017,
        tracks: ['Tape Hiss', 'Borrowed Chain', 'Velvet Static', 'Two Sugars', 'Sunday Debt'],
      },
    ],
  },
  {
    name: 'Odeon Park',
    scene: 'lateNightHipHop',
    albums: [
      {
        title: 'Instrumentals for Empty Trains',
        year: 2014,
        tracks: ['Carriage 4', 'Signal Failure', 'Terminus', 'Night Bus', 'Last Announcement'],
      },
      {
        title: 'Cassette Weather',
        year: 2019,
        tracks: ['Cassette Weather', 'Drizzle Loop', 'Overcast Interlude', 'Warm Front'],
      },
    ],
  },
  {
    name: 'Juno Pilar',
    scene: 'lateNightHipHop',
    albums: [
      {
        title: 'Small Hours',
        year: 2020,
        tracks: ['Small Hours', 'Four AM Kitchen', 'Nothing Open', 'Soft Alarm', 'Blue Kettle'],
      },
    ],
  },

  // ---------------- indie guitars ----------------
  {
    name: 'The Harbour Lights',
    scene: 'indieGuitars',
    albums: [
      {
        title: 'Coastal Roads',
        year: 2011,
        tracks: ['Coastal Roads', 'Ferry Song', 'Salt & Sodium', 'Anchor Me', 'Low Tide'],
      },
      {
        title: 'Everything Louder',
        year: 2014,
        tracks: ['Everything Louder', 'Bad Weather Friend', 'Postcode', 'Overgrown', 'Fireworks Ban'],
      },
    ],
  },
  {
    name: 'Wren & Wolf',
    scene: 'indieGuitars',
    albums: [
      {
        title: 'Two Birds, One Winter',
        year: 2013,
        tracks: ['Two Birds', 'Snowline', 'Chimney Smoke', 'Frost Fair', 'January Again'],
      },
      {
        title: 'Hollow Bones',
        year: 2017,
        tracks: ['Hollow Bones', 'Migration', 'Feather Weight', 'Storm Glass'],
      },
    ],
  },
  {
    name: 'Pale Cartography',
    scene: 'indieGuitars',
    albums: [
      {
        title: 'Contour Lines',
        year: 2016,
        tracks: ['Contour Lines', 'Elevation', 'Scree', 'Trig Point', 'Fold Marks', 'Ordnance'],
      },
    ],
  },
  {
    name: 'Bramble Court',
    scene: 'indieGuitars',
    albums: [
      {
        title: 'Garden Flat',
        year: 2019,
        tracks: ['Garden Flat', 'Rent Day', 'Kitchen Window', 'Neighbour Noise', 'Late Bloom'],
      },
      {
        title: 'Second Summer',
        year: 2022,
        tracks: ['Second Summer', 'Hosepipe Ban', 'Sun Cream', 'Nettle Sting'],
      },
    ],
  },
  {
    name: 'Ember Lane',
    scene: 'indieGuitars',
    albums: [
      {
        title: 'Terraces',
        year: 2021,
        tracks: ['Terraces', 'Brick Dust', 'Two Streets Over', 'Chip Shop Rain', 'Floodlights'],
      },
    ],
  },

  // ---------------- ambient / study ----------------
  {
    name: 'Halden Field',
    scene: 'ambientStudy',
    albums: [
      {
        title: 'Long Exposure',
        year: 2015,
        tracks: ['Long Exposure', 'Aperture', 'Grain', 'Dust Motes', 'Developing', 'Contact Sheet'],
      },
      {
        title: 'Room Tone',
        year: 2018,
        tracks: ['Room Tone', 'Radiator', 'Standing Wave', 'Silence Between'],
      },
    ],
  },
  {
    name: 'Quiet Machinery',
    scene: 'ambientStudy',
    albums: [
      {
        title: 'Idle States',
        year: 2017,
        tracks: ['Idle States', 'Low Power', 'Fan Curve', 'Standby', 'Cold Boot', 'Sleep Cycle'],
      },
    ],
  },
  {
    name: 'Ilse Marren',
    scene: 'ambientStudy',
    albums: [
      {
        title: 'Winter Piano',
        year: 2019,
        tracks: ['First Frost', 'Blue Light', 'Thaw', 'Bare Branches', 'Late Snow', 'March'],
      },
      {
        title: 'Waterline',
        year: 2023,
        tracks: ['Waterline', 'Reed Beds', 'Still Pool', 'Undertow'],
      },
    ],
  },
  {
    name: 'North Meridian',
    scene: 'ambientStudy',
    albums: [
      {
        title: 'Field Recordings, Vol. 1',
        year: 2020,
        tracks: ['Estuary', 'Pylon Hum', 'Gull Colony', 'Wind Farm', 'Harbour Wall'],
      },
    ],
  },

  // ---------------- house & disco ----------------
  {
    name: 'Mirrorball Republic',
    scene: 'houseAndDisco',
    albums: [
      {
        title: 'Basement Physics',
        year: 2016,
        tracks: ['Basement Physics', 'Strobe Logic', 'Four to the Floor', 'Cloakroom', 'Last Train Home'],
      },
      {
        title: 'Afters',
        year: 2019,
        tracks: ['Afters', 'Sunrise Taxi', 'Kitchen Party', 'Someone Elses Coat'],
      },
    ],
  },
  {
    name: 'Cassio Belle',
    scene: 'houseAndDisco',
    albums: [
      {
        title: 'Velvet Rope Theory',
        year: 2018,
        tracks: ['Velvet Rope', 'Guest List', 'Cold Champagne', 'Neon Fever', 'Two Left Feet'],
      },
    ],
  },
  {
    name: 'Palma Voltage',
    scene: 'houseAndDisco',
    albums: [
      {
        title: 'Costa Nocturna',
        year: 2021,
        tracks: ['Costa Nocturna', 'Sea Breeze Bass', 'Terrace Lights', 'Salt on Skin', 'Ferry at Dawn'],
      },
      {
        title: 'Second Wind',
        year: 2024,
        tracks: ['Second Wind', 'Open Air', 'Long Weekend', 'Sunday Set'],
      },
    ],
  },

  // ---------------- jazz & soul ----------------
  {
    name: 'The Vermillion Trio',
    scene: 'jazzAndSoul',
    albums: [
      {
        title: 'Live at the Cellar',
        year: 2012,
        tracks: ['Opening Set', 'Blue Room', 'Slow Burn', 'Interval', 'Encore for Nobody'],
      },
      {
        title: 'Autumn Standards',
        year: 2020,
        tracks: ['September Rain', 'Leaves & Ledgers', 'October Waltz', 'Last Warm Day'],
      },
    ],
  },
  {
    name: 'Delphine Roux',
    scene: 'jazzAndSoul',
    albums: [
      {
        title: 'Paper Heart Radio',
        year: 2018,
        tracks: ['Paper Heart', 'Dial Tone', 'Static & Silk', 'Long Distance', 'Answerphone'],
      },
      {
        title: 'Golden Hour Sessions',
        year: 2022,
        tracks: ['Golden Hour', 'Amber Light', 'Slow Traffic', 'Windows Down', 'Home by Nine'],
      },
    ],
  },
  {
    name: 'Otis Grange',
    scene: 'jazzAndSoul',
    albums: [
      {
        title: 'Brass & Bone',
        year: 2015,
        tracks: ['Brass & Bone', 'Sunday Suit', 'Collection Plate', 'Riverbank', 'Old Ledger'],
      },
    ],
  },

  // ---------------- shoegaze / dream ----------------
  {
    name: 'Violet Static',
    scene: 'shoegazeDream',
    albums: [
      {
        title: 'Bloom Distortion',
        year: 2014,
        tracks: ['Bloom Distortion', 'Petal Fuzz', 'Greenhouse', 'Slow Bloom', 'Wilt'],
      },
      {
        title: 'Softly, Loudly',
        year: 2017,
        tracks: ['Softly Loudly', 'Reverb Chapel', 'Sun Through Curtains', 'Half Asleep', 'Tremolo Heart'],
      },
    ],
  },
  {
    name: 'Glasshouse Youth',
    scene: 'shoegazeDream',
    albums: [
      {
        title: 'Condensation',
        year: 2019,
        tracks: ['Condensation', 'Fogged Up', 'Handprints', 'Steam Room', 'Clear Patch'],
      },
    ],
  },
  {
    name: 'Aurelie Vance',
    scene: 'shoegazeDream',
    albums: [
      {
        title: 'Nightswimming Hours',
        year: 2021,
        tracks: ['Nightswimming', 'Chlorine Moon', 'Deep End', 'Towel on Concrete', 'Last One Out'],
      },
    ],
  },

  // ---------------- folk & quiet ----------------
  {
    name: 'Alder & Ash',
    scene: 'folkAndQuiet',
    albums: [
      {
        title: 'Hedgerow Hymns',
        year: 2013,
        tracks: ['Hedgerow', 'Blackthorn', 'Sloe Gin', 'Field Gate', 'Bramble Song'],
      },
      {
        title: 'The Long Way Round',
        year: 2020,
        tracks: ['The Long Way Round', 'Boot Leather', 'Stile', 'Drystone', 'Sheep Track'],
      },
    ],
  },
  {
    name: 'Mairead Colm',
    scene: 'folkAndQuiet',
    albums: [
      {
        title: 'Salt Kitchen',
        year: 2016,
        tracks: ['Salt Kitchen', 'Herring Girls', 'Net Mending', 'Harbour Song', 'Widows Walk'],
      },
    ],
  },
  {
    name: 'Thom Ledbury',
    scene: 'folkAndQuiet',
    albums: [
      {
        title: 'Attic Tapes',
        year: 2022,
        tracks: ['Attic Tapes', 'Loft Ladder', 'Boxes of You', 'Dust Sheet', 'Skylight'],
      },
      {
        title: 'Ground Floor',
        year: 2025,
        tracks: ['Ground Floor', 'Front Door', 'Hallway Light', 'Coat Hooks'],
      },
    ],
  },
];

/** Scene mix per phase of the demo listener's life. Weights need not sum to 1. */
export interface DemoPhase {
  fromYm: string;
  toYm: string;
  weights: Partial<Record<DemoScene, number>>;
  label: string;
}

export const DEMO_PHASES: DemoPhase[] = [
  {
    fromYm: '2015-01',
    toYm: '2016-08',
    label: 'guitars and coastlines',
    weights: { indieGuitars: 6, folkAndQuiet: 2, jazzAndSoul: 1 },
  },
  {
    fromYm: '2016-09',
    toYm: '2018-05',
    label: 'the late-night turn',
    weights: { lateNightHipHop: 7, shoegazeDream: 2, indieGuitars: 1 },
  },
  {
    fromYm: '2018-06',
    toYm: '2019-12',
    label: 'dancefloor years',
    weights: { houseAndDisco: 6, lateNightHipHop: 3, shoegazeDream: 1 },
  },
  {
    fromYm: '2020-01',
    toYm: '2021-06',
    label: 'the quiet stretch',
    weights: { ambientStudy: 7, folkAndQuiet: 3, jazzAndSoul: 2 },
  },
  {
    fromYm: '2021-07',
    toYm: '2023-03',
    label: 'back outside',
    weights: { houseAndDisco: 4, indieGuitars: 4, shoegazeDream: 3 },
  },
  {
    fromYm: '2023-04',
    toYm: '2024-08',
    label: 'soul and slow evenings',
    weights: { jazzAndSoul: 6, ambientStudy: 3, folkAndQuiet: 2 },
  },
  {
    fromYm: '2024-09',
    toYm: '2026-06',
    label: 'present day',
    weights: { folkAndQuiet: 4, ambientStudy: 3, houseAndDisco: 2, indieGuitars: 2 },
  },
];
