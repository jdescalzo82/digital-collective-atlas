// Paint library. `hex` is the dried full-strength colour of a typical
// artist-grade tube; `strength` is relative tinting strength (1 = average
// earth colour). Both are averages across brands, so users can edit them
// (or sample their own swatch photo) under "My paints".
//
// `opacity`: 'opaque' | 'semi' | 'transparent' — shown to the artist and
// used for glazing tips. `media` lists where the paint is commonly sold.

const ALL = ['oil', 'acrylic', 'gouache', 'watercolor'];
const OPAQUE = ['oil', 'acrylic', 'gouache'];

export const PIGMENTS = [
  { id: 'titanium-white', name: 'Titanium White', ci: 'PW6', hex: '#f5f5f1', strength: 1, opacity: 'opaque', media: OPAQUE, white: true },
  { id: 'chinese-white', name: 'Chinese (Zinc) White', ci: 'PW4', hex: '#f3f4f2', strength: 0.6, opacity: 'semi', media: ['watercolor'], white: true,
    note: 'Adding white to watercolor makes it opaque and chalky; most watercolorists lighten with water instead.' },
  { id: 'lemon-yellow', name: 'Lemon Yellow (Hansa)', ci: 'PY3', hex: '#f4e21a', strength: 0.9, opacity: 'semi', media: ALL },
  { id: 'cad-yellow-med', name: 'Cadmium Yellow Medium', ci: 'PY35', hex: '#fbb800', strength: 1.1, opacity: 'opaque', media: ALL,
    note: 'Cadmium pigments are toxic if ingested or sanded; hues (imitations) mix almost the same.' },
  { id: 'yellow-ochre', name: 'Yellow Ochre', ci: 'PY43', hex: '#c8902e', strength: 0.8, opacity: 'semi', media: ALL },
  { id: 'raw-sienna', name: 'Raw Sienna', ci: 'PBr7', hex: '#b27434', strength: 0.8, opacity: 'transparent', media: ALL },
  { id: 'cad-orange', name: 'Cadmium Orange', ci: 'PO20', hex: '#f0721c', strength: 1.1, opacity: 'opaque', media: ALL },
  { id: 'cad-red-light', name: 'Cadmium Red Light', ci: 'PR108', hex: '#e0392a', strength: 1.2, opacity: 'opaque', media: ALL },
  { id: 'cad-red-med', name: 'Cadmium Red Medium', ci: 'PR108', hex: '#c42430', strength: 1.2, opacity: 'opaque', media: ALL },
  { id: 'alizarin', name: 'Alizarin Crimson (Permanent)', ci: 'PR177 / PR83', hex: '#8e1a36', strength: 2.2, opacity: 'transparent', media: ALL },
  { id: 'quin-magenta', name: 'Quinacridone Magenta', ci: 'PR122', hex: '#a82168', strength: 2, opacity: 'transparent', media: ALL },
  { id: 'dioxazine', name: 'Dioxazine Purple', ci: 'PV23', hex: '#3d2160', strength: 4, opacity: 'transparent', media: ALL,
    note: 'Extremely strong — add in tiny amounts.' },
  { id: 'ultramarine', name: 'Ultramarine Blue', ci: 'PB29', hex: '#2b3593', strength: 1.4, opacity: 'transparent', media: ALL },
  { id: 'cobalt-blue', name: 'Cobalt Blue', ci: 'PB28', hex: '#2a55a8', strength: 0.8, opacity: 'semi', media: ALL },
  { id: 'cerulean', name: 'Cerulean Blue', ci: 'PB35 / PB36', hex: '#2f7fbf', strength: 0.9, opacity: 'opaque', media: ALL },
  { id: 'phthalo-blue', name: 'Phthalo Blue (Green Shade)', ci: 'PB15:3', hex: '#122a6e', strength: 6, opacity: 'transparent', media: ALL,
    note: 'Extremely strong — start with a pin-head and add to the lighter color, never the other way round.' },
  { id: 'phthalo-green', name: 'Phthalo Green (Blue Shade)', ci: 'PG7', hex: '#0b5a4a', strength: 5, opacity: 'transparent', media: ALL,
    note: 'Extremely strong — add in tiny amounts.' },
  { id: 'viridian', name: 'Viridian', ci: 'PG18', hex: '#1e7a62', strength: 0.9, opacity: 'transparent', media: ALL },
  { id: 'sap-green', name: 'Sap Green', ci: 'mixture', hex: '#4b6a24', strength: 1.2, opacity: 'transparent', media: ALL },
  { id: 'burnt-sienna', name: 'Burnt Sienna', ci: 'PBr7', hex: '#8a4022', strength: 1, opacity: 'transparent', media: ALL },
  { id: 'burnt-umber', name: 'Burnt Umber', ci: 'PBr7', hex: '#4c3123', strength: 1.2, opacity: 'semi', media: ALL },
  { id: 'raw-umber', name: 'Raw Umber', ci: 'PBr7', hex: '#5f5038', strength: 1.1, opacity: 'semi', media: ALL },
  { id: 'paynes-grey', name: "Payne's Grey", ci: 'mixture', hex: '#323b4a', strength: 1.8, opacity: 'semi', media: ALL },
  { id: 'ivory-black', name: 'Ivory Black', ci: 'PBk9', hex: '#232120', strength: 1.6, opacity: 'semi', media: ALL },
  { id: 'mars-black', name: 'Mars Black', ci: 'PBk11', hex: '#1b1b1c', strength: 2.2, opacity: 'opaque', media: ALL },
];

// A common beginner/"split primary" set per medium; users tick what they own.
export const DEFAULT_OWNED = {
  oil: ['titanium-white', 'lemon-yellow', 'cad-yellow-med', 'yellow-ochre', 'cad-red-light', 'alizarin',
    'ultramarine', 'phthalo-blue', 'viridian', 'burnt-sienna', 'burnt-umber', 'ivory-black'],
  acrylic: ['titanium-white', 'lemon-yellow', 'cad-yellow-med', 'yellow-ochre', 'cad-red-light', 'quin-magenta',
    'ultramarine', 'phthalo-blue', 'phthalo-green', 'burnt-sienna', 'burnt-umber', 'mars-black'],
  gouache: ['titanium-white', 'lemon-yellow', 'cad-yellow-med', 'yellow-ochre', 'cad-red-light', 'alizarin',
    'ultramarine', 'phthalo-blue', 'burnt-sienna', 'burnt-umber', 'ivory-black'],
  watercolor: ['lemon-yellow', 'cad-yellow-med', 'yellow-ochre', 'raw-sienna', 'cad-red-light', 'alizarin',
    'quin-magenta', 'ultramarine', 'cerulean', 'phthalo-blue', 'sap-green', 'burnt-sienna', 'burnt-umber', 'paynes-grey'],
};
