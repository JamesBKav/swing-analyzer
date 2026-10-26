/** A point in normalized video coordinates (0..1 across width/height). */
export interface Pt {
  x: number;
  y: number;
}

export type ShapeKind = 'line' | 'angle' | 'circle' | 'free';

export interface Shape {
  id: string;
  kind: ShapeKind;
  /** line: [a,b]; angle: [a, vertex, c]; circle: [centre, edge]; free: path. */
  pts: Pt[];
  color: string;
  /** Frame time the shape belongs to, or null to show on every frame. */
  t: number | null;
}
