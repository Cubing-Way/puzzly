// Filling a distance table: where its states are, and the breadth-first passes that give each its distance

use super::*;

// Where the table's states are and how to reach their neighbours: index = outer positions × block + outer twists × inner size + inner value
pub(super) struct Layout {
    pub(super) turn_count: usize,
    pub(super) inner_size: u64,
    pub(super) twist_space: u64,
    pub(super) block: u64,
    pub(super) blocks: u64,
}

impl TableCore {
    // Table index from outer pieces and an inner value
    #[inline]
    pub(super) fn index(&self, outer: &Units, inner: u64) -> u64 {
        self.coords.outer.rank(outer, &self.coords.binomials) * self.coords.inner.size + inner
    }

    // Table index of a state's child after one turn (ranked straight from the parent when the outer part allows it, else via `scratch`)
    #[inline]
    pub(crate) fn child_index(&self, outer: &Units, inner: u64, turn: usize, scratch: &mut Units) -> u64 {
        let inner = self.inner_next[turn * self.coords.inner.size as usize + inner as usize] as u64;
        let outer = if self.coords.outer.singles {
            self.coords.outer.rank_after(outer, turn)
        } else {
            self.coords.outer.apply(outer, turn, scratch);
            self.coords.outer.rank(scratch, &self.coords.binomials)
        };
        outer * self.coords.inner.size + inner
    }

    // Value stored at a table index (distance mod 3, or EMPTY)
    #[inline]
    pub(crate) fn value_at(&self, index: u64) -> u8 {
        get(&self.cells, index)
    }

    // Breadth-first fill from the targets, one layer at a time: a list while layers are small, then block scans (backward once few states are left)
    pub(super) fn fill(&mut self, targets: &[KPatternData]) -> Result<(), String> {
        let outer = &self.coords.outer;
        let layout = Layout {
            turn_count: self.coords.turns.len(),
            inner_size: self.coords.inner.size,
            twist_space: outer.twist_space,
            block: outer.twist_space * self.coords.inner.size,
            blocks: outer.positions,
        };
        let size = self.coords.size();
        let mut cells = std::mem::take(&mut self.cells);
        let inner_next = std::mem::take(&mut self.inner_next);
        // Targets start at distance 0
        let mut queue: Option<Vec<u32>> = Some(vec![]);
        for target in targets {
            let (outer, inner) = self.coords.read(target).ok_or("A target doesn't fit its own numbering")?;
            let index = self.coords.index(&outer, &inner);
            if get(&cells, index) == EMPTY {
                set(&mut cells, index, 0);
                queue.as_mut().unwrap().push(index as u32);
            }
        }
        let mut seen = queue.as_ref().unwrap().len() as u64;
        let mut frontier = seen;
        let mut depth: u8 = 0;
        while frontier > 0 {
            // Distances must stay below UNSEEN (never reached on a puzzle, but a table must not wrap around)
            if depth == UNSEEN - 1 {
                return Err("Too deep for an exact table".to_owned());
            }
            let found = if let Some(list) = &queue {
                // Small layer: expand each listed state, listing the next layer while it stays small
                let (found, next_list) = self.expand_list(&layout, list, &mut cells, &inner_next, depth);
                queue = next_list;
                found
            } else {
                // Big layer: scan every block, backward once fewer unseen states are left than twice this layer
                self.scan(&layout, &mut cells, &inner_next, depth, size - seen < frontier * 2)
            };
            // Next layer
            if found > 0 {
                self.depth = depth + 1;
            }
            seen += found;
            frontier = found;
            depth += 1;
        }
        self.cells = cells;
        self.inner_next = inner_next;
        Ok(())
    }

    // Expand a listed layer: returns how many states joined the next layer, and their list (None once it grows too big)
    pub(super) fn expand_list(&self, layout: &Layout, list: &[u32], cells: &mut [u8], inner_next: &[u16], depth: u8) -> (u64, Option<Vec<u32>>) {
        let limit = (self.coords.size() / QUEUE_SHARE).clamp(1024, QUEUE_LIMIT) as usize;
        let direct = self.coords.outer.direct();
        let mut next_list = Some(vec![]);
        let mut found: u64 = 0;
        let mut next_positions = vec![0u64; layout.turn_count];
        let mut next_twists = vec![0u32; layout.turn_count];
        let (mut units, mut moved) = (Units::new(), Units::new());
        for &index in list {
            // Split the index into outer positions, outer twists and inner value
            let index = index as u64;
            let (position, rest) = (index / layout.block, index % layout.block);
            let (twists, inner) = (rest / layout.inner_size, (rest % layout.inner_size) as usize);
            // Neighbours of this state's outer part: from the tables, or worked out
            let own = self.coords.outer.split_positions(position);
            if direct {
                for turn in 0..layout.turn_count {
                    next_positions[turn] = self.coords.outer.next_position(&own, turn);
                    let row = self.coords.outer.twist_row(&own, turn);
                    next_twists[turn] = row[(twists as usize).min(row.len() - 1)];
                }
            } else {
                self.coords.outer.block_next(position, twists, 1, &mut next_positions, &mut next_twists, &self.coords.binomials, &mut units, &mut moved);
            }
            for turn in 0..layout.turn_count {
                let child = next_positions[turn] * layout.block + next_twists[turn] as u64 * layout.inner_size + inner_next[turn * layout.inner_size as usize + inner] as u64;
                if get(cells, child) != EMPTY {
                    continue;
                }
                set(cells, child, (depth + 1) % 3);
                found += 1;
                // Keep listing while the next layer stays small
                if next_list.as_ref().is_some_and(|l: &Vec<u32>| l.len() >= limit) {
                    next_list = None;
                }
                if let Some(l) = &mut next_list {
                    l.push(child as u32);
                }
            }
        }
        (found, next_list)
    }

    // One layer by block scan: forward expands this layer, backward lets unseen states find a neighbour in it (turns come with their inverses);
    // values are mod 3, so forward also expands older layers stored with the same value (their children are all seen: a little wasted work, no harm),
    // and backward a stored neighbour with this layer's value is in this layer (an unseen state's neighbours are no closer than this layer)
    pub(super) fn scan(&self, layout: &Layout, cells: &mut [u8], inner_next: &[u16], depth: u8, backward: bool) -> u64 {
        let wanted = if backward { EMPTY } else { depth % 3 };
        let (layer, next) = (depth % 3, (depth + 1) % 3);
        // Which quarters of a byte hold the wanted value (bit q = the byte's state q)
        let matches: [u8; 256] = std::array::from_fn(|byte| (0..4).fold(0, |bits, q| bits | ((((byte >> (2 * q)) & 3) as u8 == wanted) as u8) << q));
        // Twist rows straight from the outer tables when they allow it (no per-block work)
        let direct = self.coords.outer.direct();
        let width = layout.twist_space.min(CHUNK);
        let mut next_positions = vec![0u64; layout.turn_count];
        let mut next_twists = vec![0u32; layout.turn_count * width as usize];
        let (mut units, mut moved) = (Units::new(), Units::new());
        let inner_size = layout.inner_size as usize;
        // States of the chunk to work on: (twist offset in the chunk, inner value)
        let mut active: Vec<(u32, u32)> = vec![];
        let mut found: u64 = 0;
        for position in 0..layout.blocks {
            for first in (0..layout.twist_space).step_by(width as usize) {
                let count = width.min(layout.twist_space - first) as usize;
                let start = position * layout.block + first * layout.inner_size;
                // List the chunk's states with the wanted value (a byte at a time), skipping chunks with none (the common case in early and late layers)
                active.clear();
                let end = start + (count * inner_size) as u64;
                let mut index = start;
                while index < end {
                    let offset = (index - start) as usize;
                    if index & 3 != 0 || end - index < 4 {
                        // A lone quarter byte at either end
                        if get(cells, index) == wanted {
                            active.push(((offset / inner_size) as u32, (offset % inner_size) as u32));
                        }
                        index += 1;
                        continue;
                    }
                    // A whole byte: each of its four states that holds the wanted value
                    let mut found_here = matches[cells[(index >> 2) as usize] as usize];
                    while found_here != 0 {
                        let q = found_here.trailing_zeros() as usize;
                        active.push((((offset + q) / inner_size) as u32, ((offset + q) % inner_size) as u32));
                        found_here &= found_here - 1;
                    }
                    index += 4;
                }
                if active.is_empty() {
                    continue;
                }
                // The block's neighbours: positions after each turn, and twist rows (from the tables, or worked out for this chunk)
                let own = self.coords.outer.split_positions(position);
                if direct {
                    for (turn, next) in next_positions.iter_mut().enumerate() {
                        *next = self.coords.outer.next_position(&own, turn);
                    }
                } else {
                    self.coords.outer.block_next(position, first, count, &mut next_positions, &mut next_twists, &self.coords.binomials, &mut units, &mut moved);
                }
                for turn in 0..layout.turn_count {
                    // This turn's destination block, twist row and inner row (turn by turn, so the destination block stays in cache)
                    let base = next_positions[turn] * layout.block;
                    let twists = if direct {
                        let row = self.coords.outer.twist_row(&own, turn);
                        &row[(first as usize).min(row.len() - 1)..]
                    } else {
                        &next_twists[turn * count..(turn + 1) * count]
                    };
                    let inners = &inner_next[turn * inner_size..(turn + 1) * inner_size];
                    if backward {
                        // Unseen states with a neighbour in this layer join the next one and leave the list
                        let mut i = 0;
                        while i < active.len() {
                            let (k, inner) = active[i];
                            let neighbour = base + twists[k as usize] as u64 * layout.inner_size + inners[inner as usize] as u64;
                            if get(cells, neighbour) == layer {
                                set(cells, start + k as u64 * layout.inner_size + inner as u64, next);
                                found += 1;
                                active.swap_remove(i);
                            } else {
                                i += 1;
                            }
                        }
                        continue;
                    }
                    // Forward: unseen children of this layer's states join the next layer
                    for &(k, inner) in &active {
                        let child = base + twists[k as usize] as u64 * layout.inner_size + inners[inner as usize] as u64;
                        if get(cells, child) != EMPTY {
                            continue;
                        }
                        set(cells, child, next);
                        found += 1;
                    }
                }
            }
        }
        found
    }
}
