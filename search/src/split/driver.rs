// The IDA* driver shared by split searches and exact tables: move pruning, search options, answers as text, and deepening one bound at a time

use super::*;

// True when the two turns give the same result in either order (then only one order is searched)
pub(super) fn commute(kpuzzle: &KPuzzle, a: &KTransformationData, b: &KTransformationData) -> bool {
    kpuzzle.orbit_info_iter().all(|info| {
        let (x, y) = (&a[&info.name], &b[&info.name]);
        let n = info.num_orientations;
        (0..info.num_pieces as usize).all(|spot| {
            // Piece each order brings to this spot, and the twist it gains on the way
            let (xy, yx) = (y.permutation[spot] as usize, x.permutation[spot] as usize);
            x.permutation[xy] == y.permutation[yx]
                && (x.orientation_delta[xy] + y.orientation_delta[spot]) % n == (y.orientation_delta[yx] + x.orientation_delta[spot]) % n
        })
    })
}

// Move pruning for a set of turns: may a turn of group b follow one of group a ([a * groups + b]); never two turns of one move in a row,
// and of two moves that commute only the lower-numbered one first; also returns the number of groups
pub(crate) fn move_pruning(kpuzzle: &KPuzzle, turns: &[Turn]) -> (Vec<bool>, usize) {
    let groups = turns.iter().map(|turn| turn.group + 1).max().unwrap_or(0);
    let mut follow = vec![true; groups * groups];
    // Rule out each pair of turns that repeats a move, or puts two commuting moves in the higher-numbered order
    for a in turns {
        for b in turns {
            if a.group == b.group || (b.group < a.group && commute(kpuzzle, &a.data, &b.data)) {
                follow[a.group * groups + b.group] = false;
            }
        }
    }
    (follow, groups)
}

// What an IDA* run checks answers with: the whole goal's numbering, each target's state in it, and the move pruning
pub(crate) struct GoalCheck<'a> {
    pub full: &'a Coords,
    pub goals: &'a HashSet<(Units, Units)>,
    pub follow: &'a [bool],
    pub groups: usize,
}

// Options of a search or list request: answers shorter than maxDepth (twips style), a node budget, how many answers a list may give,
// and for listing page by page: answers no shorter than minDepth, coming after the answer `after` (its move text) in the list's order
pub(crate) struct SearchOptions {
    pub limit: u64,
    pub max_nodes: u64,
    pub max_answers: usize,
    pub min_depth: u64,
    pub after: Option<String>,
}

// Read a request's options (missing ones: no limit, no budget, every answer, from the shortest, from the first)
pub(crate) fn read_options(options_json: &str) -> Result<SearchOptions, String> {
    let options: serde_json::Value = serde_json::from_str(options_json).map_err(|e| e.to_string())?;
    Ok(SearchOptions {
        limit: options["maxDepth"].as_u64().unwrap_or(u64::MAX),
        max_nodes: options["maxNodes"].as_u64().unwrap_or(u64::MAX),
        max_answers: options["maxAnswers"].as_u64().unwrap_or(u64::MAX).clamp(1, usize::MAX as u64) as usize,
        min_depth: options["minDepth"].as_u64().unwrap_or(0),
        after: options["after"].as_str().map(str::to_owned),
    })
}

// An answer's move text as turn numbers (None when a move isn't one of the allowed turns)
pub(super) fn path_turns(full: &Coords, text: &str) -> Option<Vec<usize>> {
    text.split_whitespace().map(|name| full.turns.iter().position(|turn| turn.name == name)).collect()
}

// Turn lists as a JSON list of move texts, e.g. ["R U R'", "F R"]
pub(crate) fn answer_list(full: &Coords, answers: &[Vec<usize>]) -> String {
    let texts: Vec<String> = answers.iter().map(|path| path_text(full, path)).collect();
    serde_json::to_string(&texts).unwrap_or_default()
}

// One answer's moves as text
pub(super) fn path_text(full: &Coords, path: &[usize]) -> String {
    path.iter().map(|&turn| full.turns[turn].name.clone()).collect::<Vec<_>>().join(" ")
}

// One table lookup of the IDA*: a table, and for a table that reads a rotated state, the table's turn for each allowed turn (its rotated copy)
pub(crate) struct Slot {
    pub table: Rc<TableCore>,
    pub turns: Option<Vec<u8>>,
}

impl Slot {
    // A table read as it is (each turn is itself)
    pub(crate) fn plain(table: &Rc<TableCore>) -> Slot {
        Slot { table: Rc::clone(table), turns: None }
    }
}

// IDA* over these tables from their start states (`whole` = the start in the whole goal's numbering), for answers shorter than the options' limit:
// the first shortest answer, or with `list` every answer, shortest first, up to maxAnswers (an answer never passes through the goal on its way),
// from minDepth moves on and after the answer `after` (one page of a long list: answers come in turn order, so the next page starts where this one ended);
// gives the answers as turn lists (or NO_SOLUTION / NODE_LIMIT), the nodes visited, and where it stopped when the node budget ran out
pub(crate) fn deepen(tables: &[Slot], starts: &[(Units, u64)], whole: (Units, Units), check: &GoalCheck, options: &SearchOptions, list: bool) -> (Result<Vec<Vec<usize>>, &'static str>, u64, Option<Stop>) {
    // Never deeper than MAX_LENGTH (the search state has room for that many moves)
    let limit = options.limit.min(MAX_LENGTH as u64 + 1);
    // A list page: its first depth, and the answer it comes after (none; or one the allowed turns can't spell, which gives nothing)
    let (min_depth, resume) = if list { (options.min_depth, options.after.as_deref().map(|text| path_turns(check.full, text))) } else { (0, None) };
    let resume = match resume {
        Some(None) => return (Err(NO_SOLUTION), 0, None),
        Some(Some(turns)) => turns,
        None => vec![],
    };
    // Search state, and each table's start state with its exact distance; the largest distance is the first bound
    let mut ida = Ida::new(tables, whole, check, options.max_nodes, list, if list { options.max_answers } else { 1 }, resume);
    let Some(mut bound) = ida.start(starts) else {
        return (Err(NO_SOLUTION), 0, None);
    };
    // A list page starts at its first depth (shorter answers were on earlier pages)
    bound = bound.max(min_depth.min(MAX_LENGTH as u64) as u8);
    // Deepen one move at a time until the first answer (or enough answers) turns up, the limit is reached, or no state was cut by the bound (nothing deeper exists)
    while (bound as u64) < limit {
        ida.cut = false;
        // At the depth of the answer a page comes after, every path up to it is skipped (they were on earlier pages)
        ida.resuming = !ida.resume.is_empty() && ida.resume.len() == bound as usize;
        if ida.dfs(0, bound, NO_GROUP) {
            break;
        }
        if ida.gave_up || !ida.cut {
            break;
        }
        bound += 1;
    }
    // Out of nodes (and where), nothing within the limit, or the answers
    let stop = ida.gave_up.then(|| Stop { bound, path: std::mem::take(&mut ida.stopped), cut: ida.cut });
    let result = if ida.gave_up {
        Err(NODE_LIMIT)
    } else if ida.answers.is_empty() {
        Err(NO_SOLUTION)
    } else {
        Ok(std::mem::take(&mut ida.answers))
    };
    (result, ida.nodes, stop)
}

// Where a search stopped when its node budget ran out: the iteration's bound, the path it was about to search (every path before it in turn order is done),
// and whether the bound cut a state so far (a search split over workers goes on from there)
pub(crate) struct Stop {
    pub bound: u8,
    pub path: Vec<usize>,
    pub cut: bool,
}

// What one IDA* iteration gave: the first prefix (by its place in the list) that had an answer and that answer, whether the bound cut any state
// (a deeper bound could still find one), the nodes visited, and whether the node budget ran out first
pub(crate) struct Iteration {
    pub found: Option<(usize, Vec<usize>)>,
    pub cut: bool,
    pub nodes: u64,
    pub gave_up: bool,
}

// One IDA* iteration (answers of exactly `bound` moves, never below the start's bound) only through these first moves, prefix by prefix in list order until one
// has an answer (an empty prefix = every path, the whole iteration): a search split over workers gets the same first answer as one search,
// since an iteration visits paths in turn order; None when the start can't reach the goal
pub(crate) fn iterate(tables: &[Slot], starts: &[(Units, u64)], whole: (Units, Units), check: &GoalCheck, bound: u8, prefixes: &[Vec<usize>], max_nodes: u64) -> Option<Iteration> {
    // Search state (one answer at most, no page), and each table's start state
    let mut ida = Ida::new(tables, whole, check, max_nodes, false, 1, vec![]);
    ida.start(starts)?;
    // Each prefix in turn, until an answer or the end of the node budget
    let mut found = None;
    for (index, prefix) in prefixes.iter().enumerate() {
        ida.prefix.clone_from(prefix);
        if ida.dfs(0, bound.min(MAX_LENGTH), NO_GROUP) {
            found = ida.answers.pop().map(|answer| (index, answer));
            break;
        }
        if ida.gave_up {
            break;
        }
    }
    Some(Iteration { found, cut: ida.cut, nodes: ida.nodes, gave_up: ida.gave_up })
}

// Every path of `length` turns the move pruning allows, in the order an iteration visits them (turn order at each depth)
pub(crate) fn prefixes(check: &GoalCheck, length: usize) -> Vec<Vec<usize>> {
    let mut paths: Vec<Vec<usize>> = vec![vec![]];
    for _ in 0..length {
        paths = paths
            .iter()
            .flat_map(|path| {
                let last = path.last().map_or(NO_GROUP, |&turn| check.full.turns[turn].group);
                (0..check.full.turns.len())
                    .filter(move |&turn| last == NO_GROUP || check.follow[last * check.groups + check.full.turns[turn].group])
                    .map(move |turn| [path.as_slice(), &[turn]].concat())
            })
            .collect();
    }
    paths
}
