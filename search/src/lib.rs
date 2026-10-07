// puzzly's search: exact distance tables for goals small enough, split tables + IDA* for bigger ones, and twips searches (kept between calls) as the fallback

// State numbering read from masked targets
mod coords;
// Exact distance tables (DistanceTable), and the version of their saved bytes
mod table;
pub use table::{table_format, DistanceTable};
// Goals too big for one table: sub-tables + IDA* (SplitSearch)
mod split;
pub use split::SplitSearch;

use cubing::alg::Move;
use cubing::kpuzzle::{KPattern, KPuzzle};
use twips::_internal::canonical_fsm::search_generators::Generators;
use twips::_internal::search::iterative_deepening::individual_search::IndividualSearchOptions;
use twips::_internal::search::iterative_deepening::iterative_deepening_search::{
    ImmutableSearchData, IterativeDeepeningSearch,
};
use wasm_bindgen::prelude::*;

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
        // Puzzle, target patterns and allowed moves, from the JSON the worker sends
        let kpuzzle = KPuzzle::try_from_json(kpuzzle_json.as_bytes()).map_err(|e| e.to_string())?;
        let targets = serde_json::from_str::<Vec<serde_json::Value>>(targets_json)
            .map_err(|e| e.to_string())?
            .iter()
            .map(|target| KPattern::try_from_json(&kpuzzle, target.to_string().as_bytes()).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        let moves: Vec<Move> = serde_json::from_str(moves_json).map_err(|e| e.to_string())?;
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
