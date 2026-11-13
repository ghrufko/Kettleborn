/**
 * Where the painted circular frame sits inside a portrait artwork file,
 * as fractions of the image (centre and diameter), for the few files
 * whose frame isn't centred edge-to-edge like Minotaur's and Hydra's
 * (frame centre ≈ 0.50/0.50, diameter ≈ 0.99). MonsterPortraitImage uses
 * this to scale and shift the artwork so the frame lands centred in the
 * UI's circular portrait — the image files themselves are unchanged.
 * Measured from the files by fitting a circle to the frame's outer edge.
 * Keyed by portrait asset key (see MONSTER_PORTRAITS).
 */
export interface PortraitFraming {
  centerX: number;
  centerY: number;
  diameter: number;
}

/** The frame diameter every portrait is fitted to — Minotaur's/Hydra's own. */
export const REFERENCE_FRAME_DIAMETER = 0.99;

export const PORTRAIT_FRAMING: Record<string, PortraitFraming> = {
  mammoth: { centerX: 0.4878, centerY: 0.4857, diameter: 0.9602 },
  basilisk: { centerX: 0.4971, centerY: 0.4921, diameter: 0.912 },
  sovereign: { centerX: 0.497, centerY: 0.4826, diameter: 0.9637 },
  dualist: { centerX: 0.4951, centerY: 0.4823, diameter: 0.9675 },
  fallen: { centerX: 0.4964, centerY: 0.4794, diameter: 0.9584 },
  unbroken: { centerX: 0.4972, centerY: 0.4839, diameter: 0.9658 },
  colossus: { centerX: 0.4938, centerY: 0.4891, diameter: 0.9676 },
};

/**
 * Size/offset (percent of the portrait container) that maps the artwork's
 * frame onto the container: scaled so the frame diameter matches the
 * reference, and shifted so the frame centre lands on the container
 * centre.
 */
export function getPortraitFramingLayout(framing: PortraitFraming): { size: number; left: number; top: number } {
  const scale = REFERENCE_FRAME_DIAMETER / framing.diameter;
  return {
    size: scale * 100,
    left: (0.5 - framing.centerX * scale) * 100,
    top: (0.5 - framing.centerY * scale) * 100,
  };
}
