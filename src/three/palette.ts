/**
 * Colours for the 3D stage.
 *
 * The stage follows the owner's "Bacterial Blues" video: a charcoal ground
 * and exactly three bold accents (coral for the anode side and the dial
 * rims, teal for the cathode side and labels, gold for electrons), with
 * MESSAI's physically based apparatus as the hero. The five seat hues are
 * pulled into that family so the 2D overlay and the page can match them:
 * import STAGE_SEAT from here.
 */

/** The three accents. */
export const CORAL = '#FF6B6B';
export const TEAL_GLOW = '#4ECDC4';
export const GOLD = '#FFD700';
/** Oscilloscope trace green. */
export const SCOPE_GREEN = '#39FF6A';

/** The charcoal stage: radial from centre to edge. */
export const CHARCOAL_HI = '#2A2A2A';
export const CHARCOAL_LO = '#0A0A0A';

/** MESSAI base colours, used on labels and the apparatus. */
export const INK = '#0C1638';
export const PAPER = '#FAFAF6';
export const TEAL_ACCENT = '#2F8073';

/**
 * Per seat, in seat order (wire, keys, chimes, drum, tuba), one per microbe
 * (src/microbes.ts): Geo yellow, Shiva pink, Rhodo violet, Sporo teal,
 * Cable green.
 */
export const STAGE_SEAT = ['#FFD23F', '#FF5FA2', '#B18CFF', '#4ECDC4', '#5CC04A'] as const;
/** Back-compat name used inside the scene. */
export const SEAT_STRONG = STAGE_SEAT;

/** The electron's spark. */
export const SPARK = GOLD;
/** Anolyte: acetate medium after inoculation, straw and turbid. */
export const ANOLYTE = '#C9954F';
/** Catholyte: aerated buffer, near clear with a teal cast. */
export const CATHOLYTE = '#6FC3BC';
/** Electroactive biofilm on the anode, and its glow. */
export const BIOFILM = '#D4504A';
export const BIOFILM_GLOW = CORAL;
/** Network nodes in the backdrop. */
export const NODE_TEAL = TEAL_GLOW;
export const NODE_BLUE = '#3D8BFF';
