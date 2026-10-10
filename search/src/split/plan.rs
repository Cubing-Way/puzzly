// Which of a goal's pieces each sub-table keeps

use super::*;

// Items a sub-table keeps: (item index, whether its twist counts)
pub(super) type Kept = Vec<(usize, bool)>;

// Sub-tables for a goal: each starts from an item no earlier sub-table of this plan covers, then adds the goal's other items in the plan's order
// while the table still fits, with their twists if possible, else their positions only
pub(super) fn plan(items: &[Item], order: Order, fits: impl Fn(&[(usize, bool)]) -> bool) -> Vec<Kept> {
    let mut tables = vec![];
    let mut placed = vec![false; items.len()];
    let mut twisted = vec![false; items.len()];
    // Add an item if the table still fits: with its twist when it has one, else its positions only
    let add = |kept: &mut Kept, item: usize| {
        for with_twist in [items[item].twisted, false] {
            kept.push((item, with_twist));
            if fits(kept) {
                return;
            }
            kept.pop();
            if !items[item].twisted {
                return;
            }
        }
    };
    while let Some(seed) = (0..items.len()).find(|&i| !placed[i] || (items[i].twisted && !twisted[i])) {
        let mut kept = vec![];
        add(&mut kept, seed);
        // An item too big even alone (or whose twist doesn't fit) is left to the final goal check
        if kept.first().is_none_or(|&(_, with_twist)| with_twist != items[seed].twisted) {
            twisted[seed] = true;
        }
        if kept.is_empty() {
            placed[seed] = true;
            continue;
        }
        // Then every other item, in the plan's order
        let mut tried = vec![false; items.len()];
        tried[seed] = true;
        while let Some(item) = next_item(items, order, seed, &kept, &tried) {
            tried[item] = true;
            add(&mut kept, item);
        }
        for &(item, with_twist) in &kept {
            placed[item] = true;
            twisted[item] |= with_twist;
        }
        tables.push(kept);
    }
    tables
}

// The next item a sub-table tries (None when every item was tried): the seed's orbit first, else the item the most moves turn together with the kept ones; ties in item order
pub(super) fn next_item(items: &[Item], order: Order, seed: usize, kept: &Kept, tried: &[bool]) -> Option<usize> {
    let untried = (0..items.len()).filter(|&item| !tried[item]);
    match order {
        Order::Orbit => untried.min_by_key(|&item| (items[item].orbit != items[seed].orbit, item)),
        Order::Related => untried.max_by_key(|&item| (kept.iter().map(|&(other, _)| (items[item].moves & items[other].moves).count_ones()).sum::<u32>(), Reverse(item))),
    }
}
