// One IDA* run over the sub-tables' states

use super::*;

// One IDA* run: sub-table states per depth (depth * tables + table) with their distance (or a bound above it), the moves so far, and whether the bound cut anything
pub(super) struct Ida<'a> {
    pub(super) tables: &'a [Slot],
    pub(super) full: &'a Coords,
    pub(super) goals: &'a HashSet<(Units, Units)>,
    pub(super) whole: (Units, Units),
    pub(super) follow: &'a [bool],
    pub(super) groups: usize,
    pub(super) outer: Vec<Units>,
    pub(super) inner: Vec<u64>,
    pub(super) bounds: Vec<u8>,
    // Whether each (depth, table) bound is the exact distance (tables store distances mod 3, so a child's distance is only known from an exact parent's)
    pub(super) exact: Vec<bool>,
    // Whether each (depth, table) state is up to date: a sub-table's pieces are only moved along the path when a lookup needs them (an up-to-date state's distance is exact too)
    pub(super) current: Vec<bool>,
    // Room for a child's pieces when a sub-table can't rank a child straight from its parent
    pub(super) moved: Units,
    // Children still in at each depth (their turns, in turn order: depth * turns + k), and each looked-up child distance (depth, table, turn)
    pub(super) children: Vec<u8>,
    pub(super) looked_up: Vec<u8>,
    // One node's child turns as a rotated lookup makes them, child table indices and their distances (filled and read before going deeper)
    pub(super) rotated: Vec<u8>,
    pub(super) indices: Vec<u64>,
    pub(super) distances: Vec<u8>,
    // Sub-tables in the order they are checked (the ones that ruled children out at the last node go first), which ones did, and room to reorder them
    pub(super) order: Vec<usize>,
    pub(super) ruled: Vec<bool>,
    pub(super) scratch: Vec<usize>,
    pub(super) path: Vec<usize>,
    pub(super) cut: bool,
    pub(super) nodes: u64,
    // Node budget, and whether it ran out
    pub(super) max_nodes: u64,
    pub(super) gave_up: bool,
    // Listing every answer (else the first one ends the search), how many answers end it, and the answers so far
    pub(super) listing: bool,
    pub(super) max_answers: usize,
    pub(super) answers: Vec<Vec<usize>>,
    // A list page's answer to come after (empty = from the first), and whether the path so far is still on the way to it (paths before it are skipped)
    pub(super) resume: Vec<usize>,
    pub(super) resuming: bool,
    // First moves every path must start with (one task of a search split over workers; empty = any)
    pub(super) prefix: Vec<usize>,
    // The path the search was about to search when the node budget ran out
    pub(super) stopped: Vec<usize>,
}

impl<'a> Ida<'a> {
    // A search state over these tables (room for every depth up to MAX_LENGTH), its start not set yet: the node budget, whether it lists answers, how many end it,
    // and a list page's answer to come after
    pub(super) fn new(tables: &'a [Slot], whole: (Units, Units), check: &GoalCheck<'a>, max_nodes: u64, listing: bool, max_answers: usize, resume: Vec<usize>) -> Ida<'a> {
        let count = tables.len();
        let turn_count = check.full.turns.len();
        let depths = MAX_LENGTH as usize + 1;
        Ida {
            tables,
            full: check.full,
            goals: check.goals,
            whole,
            follow: check.follow,
            groups: check.groups,
            outer: vec![Units::new(); depths * count],
            inner: vec![0; depths * count],
            bounds: vec![0; depths * count],
            exact: vec![false; depths * count],
            current: vec![false; depths * count],
            moved: Units::new(),
            children: vec![0; depths * turn_count],
            looked_up: vec![0; depths * count * turn_count],
            rotated: vec![0; turn_count],
            indices: vec![0; turn_count],
            distances: vec![0; turn_count],
            order: (0..count).collect(),
            ruled: vec![false; count],
            scratch: Vec::with_capacity(count),
            path: vec![],
            cut: false,
            nodes: 0,
            max_nodes,
            gave_up: false,
            listing,
            max_answers,
            answers: vec![],
            resume,
            resuming: false,
            prefix: vec![],
            stopped: vec![],
        }
    }

    // Set each table's start state and its exact distance; gives the largest distance (the first bound), or None when some table can't reach a target
    pub(super) fn start(&mut self, starts: &[(Units, u64)]) -> Option<u8> {
        let mut bound = 0;
        for (t, &(outer, inner)) in starts.iter().enumerate() {
            let distance = self.tables[t].table.distance(&outer, inner);
            if distance == UNSEEN {
                return None;
            }
            bound = bound.max(distance);
            (self.outer[t], self.inner[t], self.bounds[t], self.exact[t], self.current[t]) = (outer, inner, distance, true, true);
        }
        Some(bound)
    }

    // Depth-first search below the state at `depth`, with `remaining` moves left in this bound; true once the search is over (first answer, or enough answers)
    pub(super) fn dfs(&mut self, depth: usize, remaining: u8, last: usize) -> bool {
        // Out of nodes: stop the whole search, noting where
        if self.nodes >= self.max_nodes {
            self.gave_up = true;
            self.stopped.clone_from(&self.path);
            return false;
        }
        self.nodes += 1;
        // Out of moves: every sub-table is at 0 here, so check the whole goal (sub-tables alone may miss pieces or mix targets)
        if remaining == 0 {
            // The answer this page comes after: it was on the last page
            if self.resuming {
                return false;
            }
            if self.is_goal() {
                // At the goal: note the answer; a search ends here, a list once it has enough
                self.answers.push(self.path.clone());
                return self.answers.len() >= self.max_answers;
            }
            self.cut = true;
            return false;
        }
        // Listing: a path already at the goal goes no further (a shorter answer plus moves that keep the goal, which later steps can always make themselves)
        if self.listing && self.at_goal(depth) {
            return false;
        }
        let count = self.tables.len();
        let turns = self.full.turns.len();
        let (here, next) = (depth * count, (depth + 1) * count);
        // Children the move pruning allows, in turn order: never the same move as the last one, nor a commuting move that should have come first
        // (and within a task's first moves, only its own)
        let first = depth * turns;
        let mut alive = 0;
        let only = self.prefix.get(depth).copied();
        for turn in 0..turns {
            if only.is_some_and(|only| only != turn) {
                continue;
            }
            if last == NO_GROUP || self.follow[last * self.groups + self.full.turns[turn].group] {
                self.children[first + alive] = turn as u8;
                alive += 1;
            }
        }
        // Sub-tables that could rule children out (one move changes a distance by at most one), one at a time over every child still in
        for position in 0..count {
            let t = self.order[position];
            self.ruled[t] = false;
            if alive == 0 || self.bounds[here + t] + 1 < remaining {
                continue;
            }
            // The state and its exact distance (a bound carried down may be above it: then no child can be ruled out after all)
            self.ensure(depth, t);
            if self.bounds[here + t] + 1 < remaining {
                continue;
            }
            let decode = near_values(self.bounds[here + t]);
            let tables = self.tables;
            let table = &*tables[t].table;
            // The children's turns as this table makes them (a rotated lookup turns them first)
            let own = match &tables[t].turns {
                None => &self.children[first..first + alive],
                Some(map) => {
                    for k in 0..alive {
                        self.rotated[k] = map[self.children[first + k] as usize];
                    }
                    &self.rotated[..alive]
                }
            };
            // Each child's table index (ranked from this state, the child's pieces aren't kept), then all their distances (independent memory reads, so they overlap),
            // each the parent's distance − 1, + 0 or + 1 as its stored value mod 3 says
            for k in 0..alive {
                self.indices[k] = table.child_index(&self.outer[here + t], self.inner[here + t], own[k] as usize, &mut self.moved);
            }
            for k in 0..alive {
                self.distances[k] = decode[table.value_at(self.indices[k]) as usize];
            }
            // Children needing more moves than are left drop out (a deeper bound may get past them, unreachable states never will)
            let mut kept = 0;
            for k in 0..alive {
                let (turn, distance) = (self.children[first + k], self.distances[k]);
                if distance >= remaining {
                    self.cut |= distance != UNSEEN;
                    self.ruled[t] = true;
                    continue;
                }
                self.looked_up[(here + t) * turns + turn as usize] = distance;
                self.children[first + kept] = turn;
                kept += 1;
            }
            alive = kept;
        }
        // Sub-tables that ruled a child out are checked first from now on (keeping their order)
        self.scratch.clear();
        self.scratch.extend(self.order.iter().filter(|&&t| self.ruled[t]));
        self.scratch.extend(self.order.iter().filter(|&&t| !self.ruled[t]));
        std::mem::swap(&mut self.order, &mut self.scratch);
        // Go into each child left, in turn order: each sub-table's bound is its looked-up distance (exact) or (not looked up) one more than before; its state is moved later, when needed
        let resuming = self.resuming;
        for k in 0..alive {
            let turn = self.children[first + k] as usize;
            // On the way to the answer a page comes after: children before its turn were listed already, the one on its path stays on the way
            if resuming {
                if turn < self.resume[depth] {
                    continue;
                }
                self.resuming = turn == self.resume[depth];
            }
            for t in 0..count {
                let skipped = self.bounds[here + t] + 1 < remaining;
                self.bounds[next + t] = if skipped { self.bounds[here + t] + 1 } else { self.looked_up[(here + t) * turns + turn] };
                self.exact[next + t] = !skipped;
                self.current[next + t] = false;
            }
            self.path.push(turn);
            if self.dfs(depth + 1, remaining - 1, self.full.turns[turn].group) {
                return true;
            }
            self.path.pop();
            if self.gave_up {
                return false;
            }
        }
        false
    }

    // True when the state at `depth` is already at the goal: every table at 0 (a bound of 0 is exact, others are made exact), then the whole goal checked
    pub(super) fn at_goal(&mut self, depth: usize) -> bool {
        let here = depth * self.tables.len();
        for t in 0..self.tables.len() {
            if self.bounds[here + t] == 0 {
                continue;
            }
            self.ensure(depth, t);
            if self.bounds[here + t] != 0 {
                return false;
            }
        }
        self.is_goal()
    }

    // Bring sub-table t's state at `depth` up to date: replay the path's turns from the deepest depth where it is current (the start always is),
    // and give each replayed state whose distance isn't exact yet its exact distance, from its stored value and the state before it (always exact by then)
    pub(super) fn ensure(&mut self, depth: usize, t: usize) {
        let count = self.tables.len();
        let mut from = depth;
        while !self.current[from * count + t] {
            from -= 1;
        }
        for d in from..depth {
            let (here, next) = (d * count + t, (d + 1) * count + t);
            let (before, after) = self.outer.split_at_mut(next);
            let slot = &self.tables[t];
            let turn = slot.turns.as_ref().map_or(self.path[d], |map| map[self.path[d]] as usize);
            // Exact distance first, its index ranked straight from the parent (cheaper than ranking the moved pieces)
            if !self.exact[next] {
                let index = slot.table.child_index(&before[here], self.inner[here], turn, &mut self.moved);
                self.bounds[next] = near_values(self.bounds[here])[slot.table.value_at(index) as usize];
                self.exact[next] = true;
            }
            self.inner[next] = slot.table.step(&before[here], self.inner[here], turn, &mut after[0]);
            self.current[next] = true;
        }
    }

    // Replay the moves so far on the whole start and look it up among the targets
    pub(super) fn is_goal(&self) -> bool {
        let (mut outer, mut inner) = self.whole;
        for &turn in &self.path {
            // Fresh copies, so entries a part doesn't write stay as they were
            let (mut next_outer, mut next_inner) = (outer, inner);
            self.full.outer.apply(&outer, turn, &mut next_outer);
            self.full.inner.apply(&inner, turn, &mut next_inner);
            (outer, inner) = (next_outer, next_inner);
        }
        self.goals.contains(&(outer, inner))
    }
}
