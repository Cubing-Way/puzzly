// The pair slots and the cross as bench/pairs.ts and bench/answer-file.ts name them: name, corner and edge numbers (cubing.js order), as goal text; the
// target slot is the first
export const SLOTS = [
  { name: "FR", corner: 4, edge: 8, text: "DFR FR" },
  { name: "FL", corner: 5, edge: 9, text: "DFL FL" },
  { name: "BL", corner: 6, edge: 11, text: "DBL BL" },
  { name: "BR", corner: 7, edge: 10, text: "DBR BR" },
];
export const CROSS = { edges: [4, 5, 6, 7], text: "DF DR DB DL" };

// What a case keeps, as goal text: the cross and the slots filled (by name)
export function keptText(filled: string[]): string {
  return [CROSS.text, ...filled.map((name) => SLOTS.find((slot) => slot.name === name)!.text)].join(" ");
}
