export type CameraView = 'face-on' | 'dtl';
export type Handedness = 'right' | 'left';
export type PhaseName = 'address' | 'top' | 'impact' | 'finish';
export const PHASES: PhaseName[] = ['address', 'top', 'impact', 'finish'];
export const PHASE_LABEL: Record<PhaseName, string> = {
  address: 'Address',
  top: 'Top',
  impact: 'Impact',
  finish: 'Finish',
};

/** Media times (seconds) of each swing phase. */
export type Phases = Partial<Record<PhaseName, number>>;

export interface SessionSettings {
  view: CameraView;
  handedness: Handedness;
  /** Frame rate of the file as decoded (detected or chosen). */
  fps: number;
  /**
   * Real seconds per second of video. 1 for normal clips (including true
   * 120/240fps files); e.g. 0.125 if the clip has slow-mo "baked in" at 8x.
   */
  timeScale: number;
  model: 'full' | 'lite';
}

export const DEFAULT_SETTINGS: SessionSettings = {
  view: 'face-on',
  handedness: 'right',
  fps: 30,
  timeScale: 1,
  model: 'full',
};

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  width: number;
  height: number;
  settings: SessionSettings;
  phases: Phases;
  /** Phases the user set by hand (kept when re-detecting). */
  manualPhases: PhaseName[];
  shapes: import('./draw/shapes').Shape[];
  /** Analysis sample rate used for the stored pose track, 0 if none. */
  poseFps: number;
}
