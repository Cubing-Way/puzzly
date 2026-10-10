// Ranking one orbit's states: positions and twists to numbers and back, and a state after a turn

use super::*;

impl OrbitCoord {
    // Positions value (dense when only reachable layouts are numbered)
    #[inline]
    pub(super) fn rank_positions(&self, spots: &[u8], binomials: &Binomials) -> u64 {
        let full = self.rank_full(spots, binomials);
        if self.to_dense.is_empty() { full } else { self.to_dense[full as usize] as u64 }
    }

    // Spots for a positions value (the inverse of rank_positions)
    #[inline]
    pub(super) fn unrank_positions(&self, index: u64, binomials: &Binomials, spots: &mut [u8]) {
        let full = if self.to_full.is_empty() { index } else { self.to_full[index as usize] as u64 };
        self.unrank_full(full, binomials, spots);
    }

    // Tracked pieces this orbit puts in a part's unit buffers
    pub(super) fn unit_count(&self) -> usize {
        self.classes.iter().map(|class| class.count).sum()
    }

    // Layout number: each class's combination among the spots earlier classes left free (colex rank of the renumbered spots)
    pub(super) fn rank_full(&self, spots: &[u8], binomials: &Binomials) -> u64 {
        let mut index: u64 = 0;
        let mut used: u64 = 0;
        let mut u = 0;
        for class in &self.classes {
            // One piece: just its spot renumbered among the free ones
            if class.count == 1 {
                let spot = spots[u] as u32;
                index = index * class.free as u64 + (spot - (used & ((1u64 << spot) - 1)).count_ones()) as u64;
                used |= 1u64 << spot;
                u += 1;
                continue;
            }
            // Several pieces: colex rank of their renumbered spots
            let mut combination: u64 = 0;
            for j in 0..class.count {
                let spot = spots[u + j] as u32;
                let reduced = spot - (used & ((1u64 << spot) - 1)).count_ones();
                combination += binomials.get(reduced as usize, j + 1);
            }
            index = index * binomials.get(class.free, class.count) + combination;
            for j in 0..class.count {
                used |= 1u64 << spots[u + j];
            }
            u += class.count;
        }
        index
    }

    // Spots for a layout number (the inverse of rank_full)
    pub(super) fn unrank_full(&self, mut index: u64, binomials: &Binomials, spots: &mut [u8]) {
        // Each class's combination rank, last class first (the free count before each class is known up front)
        let mut combinations = [0u64; MAX_SPOTS];
        for (c, class) in self.classes.iter().enumerate().rev() {
            let count = binomials.get(class.free, class.count);
            combinations[c] = index % count;
            index /= count;
        }
        // Place each class: colex unrank among the free spots, then map back to real moving spots
        let all: u64 = if self.spots.len() == 64 { u64::MAX } else { (1u64 << self.spots.len()) - 1 };
        let mut used: u64 = 0;
        let mut u = 0;
        for (c, class) in self.classes.iter().enumerate() {
            // One piece: the free spot with that rank (drop the lowest free spots, take the next)
            if class.count == 1 {
                let mut free = all & !used;
                for _ in 0..combinations[c] {
                    free &= free - 1;
                }
                spots[u] = free.trailing_zeros() as u8;
                used |= free.isolate_lowest_one();
                u += 1;
                continue;
            }
            // Several pieces: colex positions, largest first
            let mut rest = combinations[c];
            let mut reduced = [0usize; MAX_SPOTS];
            for j in (0..class.count).rev() {
                // Largest position whose binomial still fits
                let mut position = j;
                while binomials.get(position + 1, j + 1) <= rest {
                    position += 1;
                }
                rest -= binomials.get(position, j + 1);
                reduced[j] = position;
            }
            // The k-th free spot, for each renumbered position (positions rise, so one pass)
            let mut j = 0;
            let mut seen = 0;
            for spot in 0..self.spots.len() {
                if j == class.count {
                    break;
                }
                if used & (1u64 << spot) != 0 {
                    continue;
                }
                if seen == reduced[j] {
                    spots[u + j] = spot as u8;
                    j += 1;
                }
                seen += 1;
            }
            for j in 0..class.count {
                used |= 1u64 << spots[u + j];
            }
            u += class.count;
        }
    }

    // Per-spot twist digits written into the value (the last spot's is left out with twist parity)
    #[inline]
    pub(super) fn spot_digits(&self) -> usize {
        self.spots.len() - self.parity as usize
    }

    // Twist parity: the last spot's twist, which brings the set's twist sum to twist_sum
    #[inline]
    pub(super) fn last_twist(&self, digits: &[u8]) -> u8 {
        let base = self.twists as u32;
        let sum: u32 = digits.iter().map(|&digit| digit as u32).sum::<u32>() % base;
        ((self.twist_sum as u32 + base - sum) % base) as u8
    }

    // Twists value: one digit per spot (per_spot) or per twisted piece in piece order
    pub(super) fn rank_twists(&self, spots: &[u8], twists: &[u8]) -> u64 {
        let base = self.twists as u64;
        let mut index: u64 = 0;
        if self.per_spot {
            // Twist of the piece on each spot, spot by spot (with twist parity, the last spot's is left out)
            let mut at = [0u8; MAX_SPOTS];
            for u in 0..self.unit_count() {
                at[spots[u] as usize] = twists[u];
            }
            for &twist in &at[..self.spot_digits()] {
                index = index * base + twist as u64;
            }
        } else {
            // Twisted pieces in piece order
            let mut u = 0;
            for class in &self.classes {
                for _ in 0..class.count {
                    if class.twisted {
                        index = index * base + twists[u] as u64;
                    }
                    u += 1;
                }
            }
        }
        index
    }

    // Twists for a twists value, given the pieces' spots (the inverse of rank_twists)
    pub(super) fn unrank_twists(&self, mut index: u64, spots: &[u8], twists: &mut [u8]) {
        let base = self.twists as u64;
        if self.per_spot {
            // Digits per spot, last spot first (the left-out one follows from the others), then handed to the piece on each spot
            let mut at = [0u8; MAX_SPOTS];
            let digits = self.spot_digits();
            for spot in (0..digits).rev() {
                at[spot] = (index % base) as u8;
                index /= base;
            }
            if self.parity {
                at[digits] = self.last_twist(&at[..digits]);
            }
            for u in 0..self.unit_count() {
                twists[u] = at[spots[u] as usize];
            }
        } else {
            // Digits per twisted piece, last piece first (untracked twists are 0)
            let mut u = self.unit_count();
            for class in self.classes.iter().rev() {
                for _ in 0..class.count {
                    u -= 1;
                    twists[u] = if class.twisted {
                        let digit = (index % base) as u8;
                        index /= base;
                        digit
                    } else {
                        0
                    };
                }
            }
        }
    }

    // Tracked pieces after one turn (each group's pieces sorted by spot again, so the numbering stays unique)
    pub(super) fn apply(&self, spots: &[u8], twists: &[u8], turn: usize, out_spots: &mut [u8], out_twists: &mut [u8]) {
        let m = self.spots.len();
        let dest = &self.dest[turn * m..(turn + 1) * m];
        let add = &self.add[turn * m..(turn + 1) * m];
        let mut u = 0;
        for class in &self.classes {
            // Move each piece and add the twist its new spot gives (both below the twist count, so one subtraction wraps it)
            for j in u..u + class.count {
                let spot = spots[j] as usize;
                out_spots[j] = dest[spot];
                out_twists[j] = if class.twisted {
                    let twist = twists[j] + add[spot];
                    if twist >= self.twists { twist - self.twists } else { twist }
                } else {
                    0
                };
            }
            // Insertion sort of a group by spot (groups are small)
            for j in u + 1..u + class.count {
                let (spot, twist) = (out_spots[j], out_twists[j]);
                let mut k = j;
                while k > u && out_spots[k - 1] > spot {
                    out_spots[k] = out_spots[k - 1];
                    out_twists[k] = out_twists[k - 1];
                    k -= 1;
                }
                out_spots[k] = spot;
                out_twists[k] = twist;
            }
            u += class.count;
        }
    }

    // Positions and twists values after one turn, ranked straight from the pieces before it (singles only: no piece re-sorts, nothing is written out)
    #[inline]
    pub(super) fn rank_after(&self, spots: &[u8], twists: &[u8], turn: usize) -> (u64, u64) {
        let m = self.spots.len();
        let dest = &self.dest[turn * m..(turn + 1) * m];
        let add = &self.add[turn * m..(turn + 1) * m];
        let base = self.twists as u64;
        let (mut positions, mut digits, mut used) = (0u64, 0u64, 0u64);
        for (j, class) in self.classes.iter().enumerate() {
            // The piece's new spot renumbered among the spots earlier pieces left free, and its twist after the turn
            let from = spots[j] as usize;
            let spot = dest[from] as u32;
            positions = positions * class.free as u64 + (spot - (used & ((1u64 << spot) - 1)).count_ones()) as u64;
            used |= 1u64 << spot;
            if class.twisted {
                let twist = twists[j] + add[from];
                digits = digits * base + if twist >= self.twists { twist - self.twists } else { twist } as u64;
            }
        }
        // Dense number when only reachable layouts are numbered
        let positions = if self.to_dense.is_empty() { positions } else { self.to_dense[positions as usize] as u64 };
        (positions, digits)
    }
}
