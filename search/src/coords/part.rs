// Orbits numbered together as one part: reading, ranking and turning its pieces

use super::*;

impl Part {
    // Number these orbits together (product of their sizes, capped at u64::MAX: too big for a table, but such a part can still track pieces for goal checks)
    pub(super) fn new(orbits: Vec<OrbitCoord>) -> Result<Self, String> {
        let positions = orbits.iter().fold(1u64, |size, orbit| size.saturating_mul(orbit.positions));
        let twist_space = orbits.iter().fold(1u64, |size, orbit| size.saturating_mul(orbit.twist_space));
        let size = positions.saturating_mul(twist_space);
        let mut offsets = vec![0];
        for orbit in &orbits {
            offsets.push(offsets.last().unwrap() + orbit.unit_count());
        }
        if *offsets.last().unwrap() > MAX_UNITS || orbits.len() > MAX_ORBITS {
            return Err("Too many tracked pieces for an exact table".to_owned());
        }
        let singles = orbits.iter().all(|orbit| orbit.singles);
        Ok(Part { orbits, offsets, positions, twist_space, size, tabled: false, singles })
    }

    // Give every orbit turn tables if they all fit (used for the outer part, whose neighbours are needed per block)
    pub(super) fn build_tables(&mut self, turn_count: usize, binomials: &Binomials) {
        for orbit in &mut self.orbits {
            orbit.build_tables(turn_count, binomials);
        }
        self.tabled = self.orbits.iter().all(|orbit| orbit.tables.is_some());
    }

    // Free the turn tables (the fill is done; answers unpack pieces instead)
    pub fn drop_tables(&mut self) {
        for orbit in &mut self.orbits {
            orbit.tables = None;
        }
        self.tabled = false;
    }

    // Memory held by turn tables, in bytes
    pub fn table_bytes(&self) -> usize {
        self.orbits.iter().map(|orbit| orbit.table_bytes()).sum()
    }

    // Every orbit has tables and at most one has twists that count, so a turn's twists row can be read straight from that orbit's tables
    pub fn direct(&self) -> bool {
        self.tabled && self.orbits.iter().filter(|orbit| orbit.twist_space > 1).count() <= 1
    }

    // Each orbit's positions value, split out of the part's
    pub fn split_positions(&self, position: u64) -> [usize; MAX_ORBITS] {
        let mut own = [0usize; MAX_ORBITS];
        let mut rest = position;
        for (o, orbit) in self.orbits.iter().enumerate().rev() {
            own[o] = (rest % orbit.positions) as usize;
            rest /= orbit.positions;
        }
        own
    }

    // Positions value after one turn (direct parts), from each orbit's positions
    #[inline]
    pub fn next_position(&self, own: &[usize; MAX_ORBITS], turn: usize) -> u64 {
        let mut value: u64 = 0;
        for (o, orbit) in self.orbits.iter().enumerate() {
            value = value * orbit.positions + orbit.next_position(own[o], turn);
        }
        value
    }

    // Every twists value after one turn (direct parts): the twisted orbit's row, which is the whole part's twists
    #[inline]
    pub fn twist_row(&self, own: &[usize; MAX_ORBITS], turn: usize) -> &[u32] {
        match self.orbits.iter().position(|orbit| orbit.twist_space > 1) {
            Some(o) => self.orbits[o].twist_row(own[o], turn),
            None => &ZERO_ROW,
        }
    }

    // Tracked pieces of a pattern; None when an untouched spot doesn't hold what the targets have there (no turn can fix it)
    pub fn read(&self, pattern: &KPatternData) -> Option<Units> {
        let mut units = Units::new();
        for (o, orbit) in self.orbits.iter().enumerate() {
            let data = &pattern[&orbit.name];
            // Untouched spots must already be right
            if orbit.fixed.iter().any(|f| data.pieces[f.spot] != f.id || data.orientation[f.spot] % f.factor != f.twist) {
                return None;
            }
            // Twists no turn changes must already be right too
            for &spot in &orbit.spots {
                let at = spot as usize;
                if orbit.frozen.iter().any(|&(id, twist)| id == data.pieces[at] && data.orientation[at] % orbit.frozen_factor != twist) {
                    return None;
                }
            }
            // Each class's pieces in spot order, with their twists (exactly its count of them)
            let mut u = self.offsets[o];
            for class in &orbit.classes {
                let end = u + class.count;
                for (index, &spot) in orbit.spots.iter().enumerate() {
                    if data.pieces[spot as usize] == class.id {
                        if u == end {
                            return None;
                        }
                        units.spot[u] = index as u8;
                        units.twist[u] = if class.twisted { data.orientation[spot as usize] % orbit.twists } else { 0 };
                        u += 1;
                    }
                }
                if u != end {
                    return None;
                }
            }
            // Every other spot holds the left-out class (a piece of another set, or an id the targets never have, can't be reached)
            if orbit.spots.iter().any(|&spot| Some(data.pieces[spot as usize]) != orbit.implicit && !orbit.classes.iter().any(|class| class.id == data.pieces[spot as usize])) {
                return None;
            }
            // Twist parity: a twist sum no turn can change must already be right
            if orbit.parity && orbit.last_twist(&units.twist[self.offsets[o]..u]) != 0 {
                return None;
            }
            // A layout the turns can't reach (e.g. centers no allowed move brings home)
            orbit.reachable_position(&units.spot[self.offsets[o]..u], Binomials::shared())?;
        }
        Some(units)
    }

    // Positions and twists values of these tracked pieces
    #[inline]
    pub(super) fn rank_split(&self, units: &Units, binomials: &Binomials) -> (u64, u64) {
        let (mut positions, mut twists) = (0u64, 0u64);
        for (o, orbit) in self.orbits.iter().enumerate() {
            let range = self.offsets[o]..self.offsets[o + 1];
            positions = positions * orbit.positions + orbit.rank_positions(&units.spot[range.clone()], binomials);
            twists = twists * orbit.twist_space + orbit.rank_twists(&units.spot[range.clone()], &units.twist[range]);
        }
        (positions, twists)
    }

    // Value of these tracked pieces
    #[inline]
    pub fn rank(&self, units: &Units, binomials: &Binomials) -> u64 {
        let (positions, twists) = self.rank_split(units, binomials);
        positions * self.twist_space + twists
    }

    // Value of these tracked pieces after one turn, without moving them (singles parts only)
    #[inline]
    pub fn rank_after(&self, units: &Units, turn: usize) -> u64 {
        let (mut positions, mut twists) = (0u64, 0u64);
        for (o, orbit) in self.orbits.iter().enumerate() {
            let range = self.offsets[o]..self.offsets[o + 1];
            let (p, t) = orbit.rank_after(&units.spot[range.clone()], &units.twist[range], turn);
            positions = positions * orbit.positions + p;
            twists = twists * orbit.twist_space + t;
        }
        positions * self.twist_space + twists
    }

    // Tracked pieces for a value (the inverse of rank)
    pub fn unrank(&self, value: u64, binomials: &Binomials, units: &mut Units) {
        let (mut positions, mut twists) = (value / self.twist_space, value % self.twist_space);
        for (o, orbit) in self.orbits.iter().enumerate().rev() {
            let range = self.offsets[o]..self.offsets[o + 1];
            orbit.unrank_positions(positions % orbit.positions, binomials, &mut units.spot[range.clone()]);
            orbit.unrank_twists(twists % orbit.twist_space, &units.spot[range.clone()], &mut units.twist[range]);
            positions /= orbit.positions;
            twists /= orbit.twist_space;
        }
    }

    // Tracked pieces after one turn
    #[inline]
    pub fn apply(&self, units: &Units, turn: usize, out: &mut Units) {
        for (o, orbit) in self.orbits.iter().enumerate() {
            let range = self.offsets[o]..self.offsets[o + 1];
            orbit.apply(&units.spot[range.clone()], &units.twist[range.clone()], turn, &mut out.spot[range.clone()], &mut out.twist[range]);
        }
    }

    // Positions after each turn (next_positions[turn]) and twists after each turn for twists first..first + width (next_twists[turn * width + k])
    #[allow(clippy::too_many_arguments)]
    pub fn block_next(&self, position: u64, first: u64, width: usize, next_positions: &mut [u64], next_twists: &mut [u32], binomials: &Binomials, units: &mut Units, moved: &mut Units) {
        let turn_count = next_positions.len();
        if self.tabled {
            // Each orbit's positions, split out once
            let mut own = [0usize; MAX_ORBITS];
            let mut rest = position;
            for (o, orbit) in self.orbits.iter().enumerate().rev() {
                own[o] = (rest % orbit.positions) as usize;
                rest /= orbit.positions;
            }
            // Positions after each turn, orbit by orbit from the tables
            for (turn, next) in next_positions.iter_mut().enumerate() {
                let mut value: u64 = 0;
                for (o, orbit) in self.orbits.iter().enumerate() {
                    value = value * orbit.positions + orbit.next_position(own[o], turn);
                }
                *next = value;
            }
            // Twists after each turn: each orbit's digits from its tables (they may depend on that orbit's positions)
            for k in 0..width {
                let mut digits = [0usize; MAX_ORBITS];
                let mut rest = first + k as u64;
                for (o, orbit) in self.orbits.iter().enumerate().rev() {
                    digits[o] = (rest % orbit.twist_space) as usize;
                    rest /= orbit.twist_space;
                }
                for turn in 0..turn_count {
                    let mut value: u64 = 0;
                    for (o, orbit) in self.orbits.iter().enumerate() {
                        value = value * orbit.twist_space + orbit.next_twists(own[o], digits[o], turn);
                    }
                    next_twists[turn * width + k] = value as u32;
                }
            }
        } else {
            // No tables: unpack each state of the range, turn it and renumber it
            for k in 0..width {
                self.unrank(position * self.twist_space + first + k as u64, binomials, units);
                for turn in 0..turn_count {
                    self.apply(units, turn, moved);
                    let (positions, twists) = self.rank_split(moved, binomials);
                    next_positions[turn] = positions;
                    next_twists[turn * width + k] = twists as u32;
                }
            }
        }
    }
}
