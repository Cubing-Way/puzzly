// puzzly's search: exact distance tables for goals small enough, split tables + IDA* for bigger ones, and twips searches (kept between calls) as the fallback

// State numbering read from masked targets
mod coords;
// Exact distance tables (DistanceTable), and the version of their saved bytes
mod table;
pub use table::{table_format, DistanceTable};
// Goals too big for one table: sub-tables + IDA* (SplitSearch)
mod split;
pub use split::SplitSearch;
// Goals that also count when some moves alone could finish them (targets closed under those moves)
mod solvable;
// Goals with every piece home: rotated copies of a sub-table read through one table
mod symmetry;

use cubing::alg::Move;
use cubing::kpuzzle::{KPattern, KPuzzle};
use twips::_internal::canonical_fsm::search_generators::Generators;
use twips::_internal::search::iterative_deepening::individual_search::IndividualSearchOptions;
use twips::_internal::search::iterative_deepening::iterative_deepening_search::{
    ImmutableSearchData, IterativeDeepeningSearch,
};
use wasm_bindgen::prelude::*;

// Most targets a twips search takes (a goal closed under its "solvable with" moves may have thousands; split tables handle those)
const MAX_TWIPS_TARGETS: usize = 1_000;

// One goal (one or more targets) + move set, with its prune table kept between searches
#[wasm_bindgen]
pub struct Searcher {
    kpuzzle: KPuzzle,
    deepening: IterativeDeepeningSearch<KPuzzle>,
}

#[wasm_bindgen]
impl Searcher {
    // Build the search for some targets (a JSON list of patterns, any one counts) and a move set (this makes the prune table, the slow part)
    #[wasm_bindgen(constructor)]
    pub fn new(kpuzzle_json: &str, targets_json: &str, moves_json: &str) -> Result<Searcher, String> {
        // Show Rust panics in the browser console instead of a bare "unreachable"
        console_error_panic_hook::set_once();
        // Puzzle, allowed moves and target patterns (closed under their "solvable with" moves), from the JSON the worker sends
        let kpuzzle = KPuzzle::try_from_json(kpuzzle_json.as_bytes()).map_err(|e| e.to_string())?;
        let moves: Vec<Move> = serde_json::from_str(moves_json).map_err(|e| e.to_string())?;
        let turns = coords::enumerate_turns(&kpuzzle, &moves)?;
        let targets = solvable::closed_targets(&kpuzzle, targets_json, &turns)?
            .iter()
            .map(|target| KPattern::try_from_data(&kpuzzle, target).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        // Twips compares a state with its targets one by one, so a goal with many end states would never finish
        if targets.len() > MAX_TWIPS_TARGETS {
            return Err(format!("Solvable with: {} end states is too many without tables (at most {})", targets.len(), MAX_TWIPS_TARGETS));
        }
        let generators = Generators::Custom { moves, algs: vec![] };
        // Same setup as twips's own wasmTwips, but kept instead of dropped after one search
        let data = ImmutableSearchData::try_from_common_options_with_auto_search_generators(
            kpuzzle.clone(),
            generators.enumerate_moves_for_kpuzzle(&kpuzzle),
            targets,
            Default::default(),
        )
        .map_err(|e| e.description)?;
        let deepening = IterativeDeepeningSearch::<KPuzzle>::new_with_hash_prune_table(
            data,
            Default::default(),
            Default::default(),
        );
        Ok(Searcher { kpuzzle, deepening })
    }

    // First answer from this start; options_json is like {"maxDepth": 9} (exclusive, as in cubing.js) or {}
    pub fn search(&mut self, start_json: &str, options_json: &str) -> Result<String, String> {
        // Start pattern and depth limit
        let start = KPattern::try_from_json(&self.kpuzzle, start_json.as_bytes()).map_err(|e| e.to_string())?;
        let options: IndividualSearchOptions = serde_json::from_str(options_json).map_err(|e| e.to_string())?;
        // Search with the kept prune table and return the first answer
        match self.deepening.search(&start, options, Default::default()).next() {
            Some(alg) => Ok(alg.to_string()),
            None => Err("No solution found!".to_owned()),
        }
    }
}
