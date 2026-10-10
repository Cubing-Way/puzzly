// Reading one orbit's numbering from the targets: its sets of moving spots, their classes and twists, and the layouts the turns can reach

use super::*;

// One orbit's numbering: one coordinate per set of moving spots the turns connect (a piece never leaves its set: under DR moves the 8 U/D edges and the 4 E-slice edges),
// or one pool of every moving spot when the targets don't hold the same pieces in each set; the first coordinate also keeps the untouched-spot checks
pub(super) fn orbit_coords(kpuzzle: &KPuzzle, name: &KPuzzleOrbitName, targets: &[KPatternData], turns: &[Turn], binomials: &Binomials, reach: bool) -> Result<Vec<OrbitCoord>, String> {
    let info = kpuzzle.lookup_orbit(name).ok_or("Unknown orbit")?;
    let num_pieces = info.num_pieces as usize;
    let num_orientations = info.num_orientations;
    // A spot moves when some turn brings another piece there or twists it in a way that counts (center twists don't, so face turns leave centers fixed)
    let first = &targets[0][name];
    let first_mods = first.orientation_mod.clone().unwrap_or_else(|| vec![0; num_pieces]);
    let moving: Vec<bool> = (0..num_pieces)
        .map(|spot| {
            let factor = twist_factor(first_mods[spot], num_orientations);
            turns.iter().any(|turn| {
                let orbit = &turn.data[name];
                orbit.permutation[spot] as usize != spot || orbit.orientation_delta[spot] % factor != 0
            })
        })
        .collect();
    let spots: Vec<u8> = (0..num_pieces).filter(|&spot| moving[spot]).map(|spot| spot as u8).collect();
    if spots.len() > MAX_SPOTS {
        return Err(format!("Orbit {} has too many pieces for an exact table", name));
    }
    // Untouched spots: what the first target has there, and every other target must have the same (no turn can change it)
    let fixed: Vec<Fixed> = (0..num_pieces)
        .filter(|&spot| !moving[spot])
        .map(|spot| {
            let factor = twist_factor(first_mods[spot], num_orientations);
            Fixed { spot, id: first.pieces[spot], factor, twist: first.orientation[spot] % factor }
        })
        .collect();
    for target in &targets[1..] {
        let orbit = &target[name];
        if fixed.iter().any(|f| orbit.pieces[f.spot] != f.id || orbit.orientation[f.spot] % f.factor != f.twist) {
            return Err("Targets differ on spots the moves never touch".to_owned());
        }
    }
    // Sets of moving spots: each spot joins the spot every turn brings its piece from (union-find, roots as low as possible)
    let mut root: Vec<usize> = (0..num_pieces).collect();
    // Root of a spot's set (the spot is pointed straight at it for next time)
    fn find(root: &mut [usize], spot: usize) -> usize {
        let mut top = spot;
        while root[top] != top {
            top = root[top];
        }
        root[spot] = top;
        top
    }
    for turn in turns {
        let orbit = &turn.data[name];
        for &spot in &spots {
            let (a, b) = (find(&mut root, spot as usize), find(&mut root, orbit.permutation[spot as usize] as usize));
            root[a.max(b)] = a.min(b);
        }
    }
    // Spots grouped by set, sets in order of their first spot
    let mut sets: Vec<Vec<u8>> = vec![];
    let mut set_of = vec![usize::MAX; num_pieces];
    for &spot in &spots {
        let top = find(&mut root, spot as usize);
        if set_of[top] == usize::MAX {
            set_of[top] = sets.len();
            sets.push(vec![]);
        }
        sets[set_of[top]].push(spot);
    }
    // Every target must hold the same pieces in each set (offsets made of allowed moves always do); otherwise one pool, as if every moving spot were connected
    let holds = |target: &KPatternData, set: &[u8]| {
        let mut ids: Vec<u8> = set.iter().map(|&spot| target[name].pieces[spot as usize]).collect();
        ids.sort_unstable();
        ids
    };
    if sets.len() > 1 && targets[1..].iter().any(|target| sets.iter().any(|set| holds(target, set) != holds(&targets[0], set))) {
        sets = vec![spots.clone()];
    }
    // An orbit without moving spots still keeps its untouched-spot checks
    if sets.is_empty() {
        sets.push(vec![]);
    }
    // One coordinate per set, the first one with the untouched spots
    let mut fixed = Some(fixed);
    sets.into_iter().map(|set| OrbitCoord::new(kpuzzle, name, targets, turns, binomials, reach, set, fixed.take().unwrap_or_default())).collect()
}

impl OrbitCoord {
    // Read one set's numbering from the targets (all of them must agree on ids and twists that count; the set's spots are closed under the turns)
    #[allow(clippy::too_many_arguments)]
    pub(super) fn new(kpuzzle: &KPuzzle, name: &KPuzzleOrbitName, targets: &[KPatternData], turns: &[Turn], binomials: &Binomials, reach: bool, spots: Vec<u8>, fixed: Vec<Fixed>) -> Result<Self, String> {
        let info = kpuzzle.lookup_orbit(name).ok_or("Unknown orbit")?;
        let num_pieces = info.num_pieces as usize;
        let num_orientations = info.num_orientations;
        let first = &targets[0][name];
        let first_mods = first.orientation_mod.clone().unwrap_or_else(|| vec![0; num_pieces]);
        // Classes from the first target's spots in this set: count per id, and whether its twist counts
        let mut classes: Vec<Class> = vec![];
        let mut twists = 1u8;
        for &spot in &spots {
            let spot = spot as usize;
            let factor = twist_factor(first_mods[spot], num_orientations);
            let id = first.pieces[spot];
            match classes.iter_mut().find(|class| class.id == id) {
                Some(class) => {
                    if class.twisted != (factor > 1) {
                        return Err("Pieces sharing an id differ in whether their twist counts".to_owned());
                    }
                    class.count += 1;
                }
                None => classes.push(Class { id, count: 1, twisted: factor > 1, free: 0 }),
            }
            // Every twisted piece of the orbit must use the same twist count
            if factor > 1 {
                if twists > 1 && twists != factor {
                    return Err("Mixed twist counts in one orbit".to_owned());
                }
                twists = factor;
            }
        }
        // Every target must match the first one on the class counts in this set (offsets only move pieces around)
        for target in &targets[1..] {
            let orbit = &target[name];
            let mods = orbit.orientation_mod.clone().unwrap_or_else(|| vec![0; num_pieces]);
            for class in &classes {
                let count = spots.iter().filter(|&&spot| orbit.pieces[spot as usize] == class.id).count();
                let twisted = spots.iter().any(|&spot| orbit.pieces[spot as usize] == class.id && twist_factor(mods[spot as usize], num_orientations) > 1);
                if count != class.count || twisted != class.twisted {
                    return Err("Targets don't share one piece layout".to_owned());
                }
            }
        }
        // Twists no allowed turn can change (edge orientation under U, R, L) leave the state; reading a start checks them instead
        let mut frozen: Vec<(u8, u8)> = vec![];
        let frozen_factor = twists;
        if twists > 1 && turns.iter().all(|turn| spots.iter().all(|&spot| turn.data[name].orientation_delta[spot as usize] % twists == 0)) {
            for class in classes.iter_mut().filter(|class| class.twisted) {
                let mut required = None;
                for target in targets {
                    let orbit = &target[name];
                    for &spot in &spots {
                        if orbit.pieces[spot as usize] != class.id {
                            continue;
                        }
                        let twist = orbit.orientation[spot as usize] % twists;
                        if required.is_some_and(|value| value != twist) {
                            return Err("Pieces sharing an id need different twists no move can change".to_owned());
                        }
                        required = Some(twist);
                    }
                }
                frozen.push((class.id, required.unwrap_or(0)));
                class.twisted = false;
            }
            twists = 1;
        }
        // Leave out the biggest class whose twist doesn't count: its spots are whatever the others leave free
        let left_out = (0..classes.len()).filter(|&i| !classes[i].twisted).max_by_key(|&i| classes[i].count);
        let implicit = left_out.map(|biggest| classes.remove(biggest).id);
        // With no class left out every spot holds a tracked piece, so twists can be kept per spot when all of them count
        let per_spot = implicit.is_none() && classes.iter().all(|class| class.twisted);
        // Where each turn sends the piece on each spot of the set (turn data: new[i] = old[permutation[i]], twisted by orientation_delta[i]; the set is closed under the turns)
        let m = spots.len();
        let mut compact = vec![u8::MAX; num_pieces];
        for (index, &spot) in spots.iter().enumerate() {
            compact[spot as usize] = index as u8;
        }
        let mut dest = vec![0u8; turns.len() * m];
        let mut add = vec![0u8; turns.len() * m];
        for (t, turn) in turns.iter().enumerate() {
            let orbit = &turn.data[name];
            for &to in &spots {
                let from = compact[orbit.permutation[to as usize] as usize] as usize;
                dest[t * m + from] = compact[to as usize];
                add[t * m + from] = orbit.orientation_delta[to as usize] % twists;
            }
        }
        // Twist parity: per-spot twists whose sum no turn changes, and every target with the same sum, so the last spot's twist follows from the others (EO 2,048, CO 2,187)
        let sum_of = |target: &KPatternData| (spots.iter().map(|&spot| (target[name].orientation[spot as usize] % twists) as u32).sum::<u32>() % twists as u32) as u8;
        let keeps_sum = per_spot && twists > 1 && m > 0 && (0..turns.len()).all(|t| add[t * m..(t + 1) * m].iter().map(|&gain| gain as u32).sum::<u32>() % twists as u32 == 0);
        let parity = keeps_sum && targets.iter().all(|target| sum_of(target) == sum_of(&targets[0]));
        let twist_sum = if parity { sum_of(&targets[0]) } else { 0 };
        // Value counts: one combination per class among the spots still free, and one twist digit per tracked twist (one less with twist parity)
        let mut positions: u64 = 1;
        let mut twist_space: u64 = 1;
        let mut free = m;
        for class in &mut classes {
            class.free = free;
            positions = positions.checked_mul(binomials.get(free, class.count)).ok_or("Too many states")?;
            free -= class.count;
            if class.twisted {
                for _ in 0..class.count {
                    twist_space = twist_space.checked_mul(twists as u64).ok_or("Too many states")?;
                }
            }
        }
        if parity {
            twist_space /= twists as u64;
        }
        let size = positions.checked_mul(twist_space).ok_or("Too many states")?;
        let singles = (!per_spot || classes.is_empty()) && classes.iter().all(|class| class.count == 1);
        let mut orbit = OrbitCoord {
            name: name.clone(),
            spots,
            fixed,
            classes,
            implicit,
            twists,
            per_spot,
            parity,
            twist_sum,
            singles,
            positions,
            twist_space,
            size,
            dest,
            add,
            tables: None,
            to_dense: vec![],
            to_full: vec![],
            frozen,
            frozen_factor,
        };
        // Sizing only (planning sub-tables) skips this walk: the full count is an upper bound
        if reach {
            orbit.keep_reachable(targets, turns.len(), binomials);
        }
        Ok(orbit)
    }

    // Small orbits: number only the layouts the turns reach from the targets (six centers under M, E, S: 24 of 720)
    pub(super) fn keep_reachable(&mut self, targets: &[KPatternData], turn_count: usize, binomials: &Binomials) {
        if self.positions > REACH_LIMIT || self.positions == 1 {
            return;
        }
        let units = self.unit_count();
        let mut seen = vec![false; self.positions as usize];
        let mut queue: Vec<u32> = vec![];
        // Start from every target's layout
        let mut spots = [0u8; MAX_UNITS];
        for target in targets {
            let data = &target[&self.name];
            let mut u = 0;
            for class in &self.classes {
                for (index, &spot) in self.spots.iter().enumerate() {
                    if data.pieces[spot as usize] == class.id && u < units {
                        spots[u] = index as u8;
                        u += 1;
                    }
                }
            }
            let full = self.rank_full(&spots[..units], binomials) as usize;
            if !seen[full] {
                seen[full] = true;
                queue.push(full as u32);
            }
        }
        // Every layout one turn away from a reached one, until nothing new turns up
        let (mut moved, zeros, mut scratch) = ([0u8; MAX_UNITS], [0u8; MAX_UNITS], [0u8; MAX_UNITS]);
        let mut next = 0;
        while next < queue.len() {
            self.unrank_full(queue[next] as u64, binomials, &mut spots[..units]);
            next += 1;
            for turn in 0..turn_count {
                self.apply(&spots[..units], &zeros[..units], turn, &mut moved[..units], &mut scratch[..units]);
                let full = self.rank_full(&moved[..units], binomials) as usize;
                if !seen[full] {
                    seen[full] = true;
                    queue.push(full as u32);
                }
            }
        }
        // Renumber only when it saves something
        if (queue.len() as u64) < self.positions {
            queue.sort_unstable();
            self.to_dense = vec![UNREACHABLE; self.positions as usize];
            for (dense, &full) in queue.iter().enumerate() {
                self.to_dense[full as usize] = dense as u32;
            }
            self.to_full = queue;
            self.positions = self.to_full.len() as u64;
            self.size = self.positions * self.twist_space;
        }
    }

    // Positions value of these spots, or None when the turns can't reach that layout
    pub(super) fn reachable_position(&self, spots: &[u8], binomials: &Binomials) -> Option<u64> {
        let full = self.rank_full(spots, binomials);
        if self.to_dense.is_empty() {
            return Some(full);
        }
        let dense = self.to_dense[full as usize];
        if dense == UNREACHABLE { None } else { Some(dense as u64) }
    }
}
