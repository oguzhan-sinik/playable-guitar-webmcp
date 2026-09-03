/**
 * Physical/practice constraints the compiler must respect (or pay a
 * difficulty penalty for violating). V1: plain data, no validation graph.
 */
export interface PlayerConstraints {
  practicePreferences: {
    avoidBarreChords: boolean;
    allowSlowerTempo: boolean;
    prioritizeRecognizability: boolean;
  };
  comfortableTempoBpm?: number;
  maxPreferredFretSpan?: number;
  preferredCapoMax?: number;
}
