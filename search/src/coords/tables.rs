// One orbit's turn tables, so a state's neighbours are lookups

use super::*;

impl OrbitCoord {
    // Build turn tables when they stay small (positions × turns, and the twist rows they need)
    pub(super) fn build_tables(&mut self, turn_count: usize, binomials: &Binomials) {
        let turns = turn_count as u64;
        let twists_fit = self.twist_space == 1 || (self.per_spot && self.twist_space * turns <= TABLE_LIMIT) || (!self.per_spot && self.twist_space as usize <= ROW_LIMIT);
        if self.positions * turns > TABLE_LIMIT || !twists_fit {
            return;
        }
        let positions = self.positions as usize;
        let space = self.twist_space as usize;
        let units = self.unit_count();
        let per_unit = space > 1 && !self.per_spot;
        let mut tables = OrbitTables { position_next: vec![0; turn_count * positions], row: if per_unit { vec![0; turn_count * positions] } else { vec![] }, rows: vec![], twist_next: vec![] };
        // Digit of each twisted piece in the twists value (piece order, first digit most significant)
        let mut digit_of = [0usize; MAX_UNITS];
        let mut digits = 0;
        let mut u = 0;
        for class in &self.classes {
            for _ in 0..class.count {
                if class.twisted {
                    digit_of[u] = digits;
                    digits += 1;
                }
                u += 1;
            }
        }
        // Rows are keyed by (source digit, gained twist) per new digit, packed 8 bits each
        if per_unit && (digits > 16 || digits * self.twists as usize > 256) {
            return;
        }
        let mut row_ids: std::collections::HashMap<u128, u32> = std::collections::HashMap::new();
        let base = self.twists as usize;
        let m = self.spots.len();
        let (mut spots, mut moved, mut gained) = ([0u8; MAX_UNITS], [0u8; MAX_UNITS], [0u8; MAX_UNITS]);
        let zeros = [0u8; MAX_UNITS];
        for position in 0..positions {
            self.unrank_positions(position as u64, binomials, &mut spots[..units]);
            for turn in 0..turn_count {
                // Positions after the turn
                self.apply(&spots[..units], &zeros[..units], turn, &mut moved[..units], &mut gained[..units]);
                tables.position_next[turn * positions + position] = self.rank_positions(&moved[..units], binomials) as u32;
                if !per_unit {
                    continue;
                }
                // Each class's pieces in their new spot order: which digit each came from and the twist it gains
                let mut sources = [(0usize, 0usize); MAX_UNITS];
                let mut key: u128 = 0;
                let mut u = 0;
                for class in &self.classes {
                    let group = &mut sources[..class.count];
                    for (j, entry) in group.iter_mut().enumerate() {
                        *entry = (self.dest[turn * m + spots[u + j] as usize] as usize, u + j);
                    }
                    group.sort_unstable();
                    if class.twisted {
                        for &(_, source) in group.iter() {
                            key = (key << 8) | (digit_of[source] * base + self.add[turn * m + spots[source] as usize] as usize) as u128;
                        }
                    }
                    u += class.count;
                }
                // Reuse an equal row, or build it: every twists value with its digits moved and twisted
                let next_id = row_ids.len() as u32;
                let id = *row_ids.entry(key).or_insert(next_id);
                if id == next_id {
                    if tables.rows.len() + space > ROW_LIMIT {
                        return;
                    }
                    // (source digit, gained twist) for each new digit, unpacked from the key
                    let moves: Vec<(usize, usize)> = (0..digits).map(|k| ((key >> (8 * (digits - 1 - k))) & 0xFF) as usize).map(|entry| (entry / base, entry % base)).collect();
                    let mut old = [0usize; 16];
                    for twists in 0..space {
                        let mut rest = twists;
                        for digit in old[..digits].iter_mut().rev() {
                            *digit = rest % base;
                            rest /= base;
                        }
                        tables.rows.push(moves.iter().fold(0usize, |value, &(source, gain)| value * base + (old[source] + gain) % base) as u32);
                    }
                }
                tables.row[turn * positions + position] = id;
            }
        }
        // Per-spot twists: each turn moves the digits to their new spots and adds each spot's twist (with twist parity, the left-out digit comes from the others)
        if self.per_spot && space > 1 {
            tables.twist_next = vec![0; turn_count * space];
            let digits = self.spot_digits();
            for twists in 0..space {
                let mut at = [0u8; MAX_SPOTS];
                let mut rest = twists;
                for spot in (0..digits).rev() {
                    at[spot] = (rest % base) as u8;
                    rest /= base;
                }
                if self.parity {
                    at[digits] = self.last_twist(&at[..digits]);
                }
                for turn in 0..turn_count {
                    let mut after = [0usize; MAX_SPOTS];
                    for spot in 0..m {
                        after[self.dest[turn * m + spot] as usize] = (at[spot] as usize + self.add[turn * m + spot] as usize) % base;
                    }
                    tables.twist_next[turn * space + twists] = after[..digits].iter().fold(0usize, |value, &digit| value * base + digit) as u32;
                }
            }
        }
        self.tables = Some(tables);
    }

    // Positions value after one turn, from the turn tables
    #[inline]
    pub(super) fn next_position(&self, position: usize, turn: usize) -> u64 {
        let tables = self.tables.as_ref().unwrap();
        tables.position_next[turn * self.positions as usize + position] as u64
    }

    // Twists value after one turn, from the turn tables (pieces gain twists, and groups re-sort, depending on where they are)
    #[inline]
    pub(super) fn next_twists(&self, position: usize, twists: usize, turn: usize) -> u64 {
        self.twist_row(position, turn)[twists] as u64
    }

    // Every twists value after one turn, as a row of the turn tables (indexed by the twists value before)
    #[inline]
    pub(super) fn twist_row(&self, position: usize, turn: usize) -> &[u32] {
        let tables = self.tables.as_ref().unwrap();
        let space = self.twist_space as usize;
        if space == 1 {
            &ZERO_ROW
        } else if self.per_spot {
            &tables.twist_next[turn * space..(turn + 1) * space]
        } else {
            let row = tables.row[turn * self.positions as usize + position] as usize;
            &tables.rows[row * space..(row + 1) * space]
        }
    }

    // Memory held by the turn tables, in bytes
    pub(super) fn table_bytes(&self) -> usize {
        self.tables.as_ref().map_or(0, |t| t.position_next.len() * 4 + t.row.len() * 4 + t.rows.len() * 4 + t.twist_next.len() * 4)
    }
}
