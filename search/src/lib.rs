// puzzly's search: exact distance tables for goals small enough, and twips searches (kept between calls) for the rest

// State numbering read from masked targets
mod coords;
// Exact distance tables (DistanceTable)
mod table;
pub use table::DistanceTable;

use cubing::alg::Move;
use cubing::kpuzzle::{KPattern, KPuzzle};
use twips::_internal::canonical_fsm::search_generators::Generators;
use twips::_internal::search::iterative_deepening::individual_search::IndividualSearchOptions;
use twips::_internal::search::iterative_deepening::iterative_deepening_search::{
    ImmutableSearchData, IterativeDeepeningSearch,
};
use wasm_bindgen::prelude::*;

// One target + move set, with its prune table kept between searches
#[wasm_bindgen]
pub struct Searcher {
    kpuzzle: KPuzzle,
    deepening: IterativeDeepeningSearch<KPuzzle>,
}

#[wasm_bindgen]
impl Searcher {
    // Build the search for one target and move set (this makes the prune table, the slow part)
    #[wasm_bindgen(constructor)]
    pub fn new(kpuzzle_json: &str, target_json: &str, moves_json: &str) -> Result<Searcher, String> {
        // Show Rust panics in the browser console instead of a bare "unreachable"
        console_error_panic_hook::set_once();
        // Puzzle, target pattern and allowed moves, from the JSON the worker sends
        let kpuzzle = KPuzzle::try_from_json(kpuzzle_json.as_bytes()).map_err(|e| e.to_string())?;
        let target = KPattern::try_from_json(&kpuzzle, target_json.as_bytes()).map_err(|e| e.to_string())?;
        let moves: Vec<Move> = serde_json::from_str(moves_json).map_err(|e| e.to_string())?;
        let generators = Generators::Custom { moves, algs: vec![] };
        // Same setup as twips's own wasmTwips, but kept instead of dropped after one search
        let data = ImmutableSearchData::try_from_common_options_with_auto_search_generators(
            kpuzzle.clone(),
            generators.enumerate_moves_for_kpuzzle(&kpuzzle),
            vec![target],
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
