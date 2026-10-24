// The speed model in Rust: the costs of src/engine/speed/fingering.ts (speedCost, speedFloor, writingFloor, cheapestWriting) for the steps that score
// thousands of answers. The hand map stays data on the TypeScript side (hands.ts) and comes in as JSON; who makes each move (fingering) stays there too

use wasm_bindgen::prelude::*;

// The hand map read from JSON and made ready for the search
mod model;
// The search over hand positions, its floors, and an answer's cheapest writing
mod fingering;
// The ways an answer can be written with wide and slice turns
pub(crate) mod writings;

use model::Model;

// One hand map ready to score move text (the engine keeps one per map)
#[wasm_bindgen]
pub struct SpeedModel {
    model: Model,
}

// What a writing search gave (see SpeedModel::cheapest_writing): whether a writing was left under the limit, its text (handed over as a copy), its
// cost and for a writing that starts held another way the rotations it starts with instead of `before` (undefined otherwise), and the bounds that say
// which other limits would have searched the very same way (see fingering.rs's Searched); with other end frames, the cheapest writing that ends in each
// of them as JSON ([text, cost, start or null], or null when there's none)
#[wasm_bindgen]
pub struct Writing {
    pub found: bool,
    #[wasm_bindgen(getter_with_clone)]
    pub text: String,
    pub cost: f64,
    #[wasm_bindgen(getter_with_clone)]
    pub start: Option<String>,
    pub kept: f64,
    pub pruned: f64,
    #[wasm_bindgen(getter_with_clone)]
    pub ends: String,
}

#[wasm_bindgen]
impl SpeedModel {
    // Read a hand map (a HandModel as JSON)
    #[wasm_bindgen(constructor)]
    pub fn new(hands_json: &str) -> Result<SpeedModel, String> {
        // Show Rust panics in the browser console instead of a bare "unreachable"
        console_error_panic_hook::set_once();
        Ok(SpeedModel { model: Model::from_json(hands_json)? })
    }

    // A move sequence's speed cost (speedCost): `fresh` = nothing was turned before, `starts` = where each step starts in a joined solve
    pub fn cost(&self, moves: &str, fresh: bool, starts: &[u32]) -> f64 {
        fingering::speed_cost(&self.model, moves, fresh, starts)
    }

    // A lower bound of its speed cost from its text alone (speedFloor)
    pub fn floor(&self, moves: &str, fresh: bool) -> f64 {
        fingering::speed_floor(&self.model, moves, fresh)
    }

    // A lower bound of what cheapest_writing can give for an answer after its grip rotation `before` (writingFloor)
    #[wasm_bindgen(js_name = writingFloor)]
    pub fn writing_floor(&self, moves: &str, fresh: bool, before: &str) -> f64 {
        fingering::writing_floor(&self.model, moves, fresh, before)
    }

    // An answer's cheapest writing with wide turns about the `wide` axes and slice turns about the `slice` axes (letters of "xyz"), after `before` or
    // after one of the `starts`, and the cheapest ending in each of the `ends` frames (writingSearch); none when the plain writing is the only one,
    // and not found when no writing costs `limit` or less
    #[wasm_bindgen(js_name = cheapestWriting)]
    #[allow(clippy::too_many_arguments)]
    pub fn cheapest_writing(&self, moves: &str, wide: &str, slice: &str, fresh: bool, before: &str, limit: f64, starts: &str, ends: &str) -> Option<Writing> {
        fingering::cheapest_writing(&self.model, moves, wide, slice, fresh, before, limit, starts, ends).map(|searched| {
            let found = searched.found.is_some();
            let (text, cost, start) = searched.found.unwrap_or((String::new(), f64::INFINITY, None));
            let ends = serde_json::to_string(&searched.ends).unwrap_or_default();
            Writing { found, text, cost, start, kept: searched.kept, pruned: searched.pruned, ends }
        })
    }
}
