// Error messages several parts of the engine throw (and compare against, e.g. a repeated step that has nothing new left)

// Message when a step keeps centers its moves can't bring home (twips would search forever)
export const CENTERS_OUT =
  "The goal's centers are out of place and the allowed moves can't bring them home: list only the centers the step needs, or allow M, E or S.";

// Message when every allowed grip only names pieces earlier steps already did (the answer would be a bare grip turn)
export const NOTHING_NEW =
  "In every allowed grip, this step's pieces are ones earlier steps already did, so a grip turn alone would count: allow other bottom faces, or check the step's pieces.";

// Message when a step that keeps every other piece untouched also has offsets or solvable-with moves
export const UNTOUCHED_MIX = "A step that keeps every other piece untouched can't have offsets or solvable-with moves.";

// Message when an untouched step's pieces use a role other than solved, :p or :x
export const UNTOUCHED_ROLES = "With every other piece untouched, list pieces as solved, :p (in place, any twist) or :x (its spot may change).";

// Message when an untouched goal can't be reached with everything else kept (e.g. a lone swap or a lone twist)
export const UNTOUCHED_OUT =
  "With every other piece untouched, the allowed moves can't do this (a lone swap or a lone twist): add pieces, or mark spots that may change with :x.";

// Message when a BLD step's targets left are odd and it has no parity pieces
export const PARITY_NEEDED =
  "The targets left are odd (a lone swap), which no moves can do with everything else untouched: give the step parity pieces, e.g. UFR UBR (two corners a parity alg swaps too).";
