// The ways the hands can make a sequence of face turns when some are made as the opposite wide turn, or two as one slice turn (writings.ts); it only
// says which writings there are, fingering.rs finds the cheapest one

use std::collections::HashMap;

// Faces a rotation moves, each to the next one's place (x turns like R, y like U, z like F)
const CYCLES: [&[u8; 4]; 3] = [b"FUBD", b"FLBR", b"URDL"];

// A turn the hands make on more than one layer: its axis (0 = x, 1 = y, 2 = z), its token, the face turns it makes (a prime = the other way round) and the
// rotation it leaves the cube in. Lw is R then x': the left hand turns two layers and the right one stays; M is R and L' with the middle staying, x' too
struct Form {
    axis: usize,
    token: &'static str,
    faces: &'static [&'static str],
    rotation: &'static str,
}

// Every such turn, by axis
const WRITTEN: [Form; 9] = [
    Form { axis: 0, token: "Lw", faces: &["R"], rotation: "x'" },
    Form { axis: 0, token: "Rw", faces: &["L"], rotation: "x" },
    Form { axis: 0, token: "M", faces: &["R", "L'"], rotation: "x'" },
    Form { axis: 1, token: "Dw", faces: &["U"], rotation: "y'" },
    Form { axis: 1, token: "Uw", faces: &["D"], rotation: "y" },
    Form { axis: 1, token: "E", faces: &["U", "D'"], rotation: "y'" },
    Form { axis: 2, token: "Bw", faces: &["F"], rotation: "z'" },
    Form { axis: 2, token: "Fw", faces: &["B"], rotation: "z" },
    Form { axis: 2, token: "S", faces: &["F'", "B"], rotation: "z" },
];

// What follows a turn's letter, by its quarter turns clockwise (1 = plain, 2 = half, 3 = prime)
const SUFFIXES: [&str; 4] = ["", "", "2", "'"];

// The sides of a frame, in order
const SIDES: &[u8; 6] = b"UDRLFB";

// A frame: the cube's own face on each side as the hands hold it, in the order of SIDES (UDRLFB = held as the answer names it)
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct Frame([u8; 6]);

impl Frame {
    // The frame the answer is named in
    const HOME: Frame = Frame(*SIDES);

    // The side a face of the cube is on
    fn side_of(&self, face: u8) -> u8 {
        SIDES[self.0.iter().position(|&each| each == face).unwrap_or(0)]
    }

    // The frame after a rotation about an axis, `quarters` quarter turns clockwise (x' = three): each face of the cycle goes to the next one's side
    fn rotate(&self, axis: usize, quarters: usize) -> Frame {
        let cycle = CYCLES[axis];
        let place = |side: u8| SIDES.iter().position(|&each| each == side).unwrap_or(0);
        let mut sides = self.0;
        for _ in 0..quarters {
            let before = sides;
            for (index, &side) in cycle.iter().enumerate() {
                sides[place(cycle[(index + 1) % 4])] = before[place(side)];
            }
        }
        Frame(sides)
    }

    // The frame as one number, for keys (three bits a side)
    pub fn code(&self) -> u32 {
        self.0.iter().fold(0, |code, &face| code << 3 | SIDES.iter().position(|&side| side == face).unwrap_or(0) as u32)
    }

    // A frame from its six letters in the order of SIDES ("RLBFDU"); None when they aren't six faces
    pub fn from_text(text: &str) -> Option<Frame> {
        let bytes: [u8; 6] = text.as_bytes().try_into().ok()?;
        bytes.iter().all(|face| SIDES.contains(face)).then_some(Frame(bytes))
    }
}

// A token the hands make, as its few bytes (at most 4: "Rw2'" never comes up, "Lw'" does)
#[derive(Clone, Copy, Default)]
pub(crate) struct Token {
    bytes: [u8; 4],
    length: u8,
}

impl Token {
    // A token from its text
    fn new(text: &str) -> Token {
        let mut bytes = [0; 4];
        bytes[..text.len()].copy_from_slice(text.as_bytes());
        Token { bytes, length: text.len() as u8 }
    }

    // Its text
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.bytes[..self.length as usize]).unwrap_or_default()
    }
}

// A turn or rotation given for one quarter turn clockwise (or a prime), made `quarters` times (1–3): its text, and its quarter turns clockwise
fn times(turn: &str, quarters: usize) -> (String, usize) {
    match turn.strip_suffix('\'') {
        Some(plain) => (format!("{plain}{}", SUFFIXES[4 - quarters]), 4 - quarters),
        None => (format!("{turn}{}", SUFFIXES[quarters]), quarters),
    }
}

// One way to go on from a place in an answer: the token the hands make, how many of the answer's turns it covers, and the frame after it
pub(crate) struct WritingOption {
    pub token: Token,
    pub covers: usize,
    pub frame: Frame,
}

// An answer ready to be written: each turn as (the cube's own face, quarter turns clockwise), the turns it may be made with, the other frames it may
// end in, and the ways on from each place and frame worked out so far (only those the rest of the answer can still bring round to a frame it may end
// in; the plain turn first)
pub(crate) struct WritingPlan {
    steps: Vec<(u8, usize)>,
    forms: Vec<&'static Form>,
    ends: Vec<Frame>,
    reaches: HashMap<(usize, Frame), bool>,
    kept: HashMap<(usize, Frame), Vec<WritingOption>>,
}

// The ways the hands can write an answer (plain face turns) with some turns made as wide turns about the `wide` axes or slice turns about the `slice`
// axes (letters of "xyz"), the cube ending held as its grip names it (or in one of the `ends` frames), from there or from one of the `starts` frames
// (writings.ts's writingPlan); None when the plain writing is the only one (or a move isn't a plain face turn)
pub(crate) fn writing_plan(moves: &[&str], wide: &str, slice: &str, starts: &[Frame], ends: &[Frame]) -> Option<WritingPlan> {
    // Each turn as its face and quarter turns, when every one is a plain face turn
    let steps = moves
        .iter()
        .map(|turn| match turn.as_bytes() {
            [face] if b"URFDLB".contains(face) => Some((*face, 1)),
            [face, b'\''] if b"URFDLB".contains(face) => Some((*face, 3)),
            [face, b'2'] if b"URFDLB".contains(face) => Some((*face, 2)),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    // Wide turns (one face each) about the wide axes, slice turns (two faces) about the slice axes
    let forms: Vec<&Form> = WRITTEN.iter().filter(|form| (if form.faces.len() == 1 { wide } else { slice }).contains(['x', 'y', 'z'][form.axis])).collect();
    if forms.is_empty() {
        return None;
    }
    let mut plan = WritingPlan { steps, forms, ends: ends.to_vec(), reaches: HashMap::new(), kept: HashMap::new() };
    // A writing with a wide or slice turn leaves the starting frame somewhere, or starts in another one: none does when no place lets it
    if !(0..plan.steps.len()).any(|at| plan.options_at(at, Frame::HOME).len() > 1) && !starts.iter().any(|&frame| frame != Frame::HOME && plan.can_end(0, frame)) {
        return None;
    }
    Some(plan)
}

impl WritingPlan {
    // The frame the answer is named in, where it ends (and starts, unless it starts held another way)
    pub fn home(&self) -> Frame {
        Frame::HOME
    }

    // How many turns the answer has
    pub fn length(&self) -> usize {
        self.steps.len()
    }

    // Every way to go on from a place in a frame: the turn itself, the wide turn that makes it, or a slice turn that makes it and the next one
    fn all_at(&self, at: usize, frame: Frame) -> Vec<WritingOption> {
        // The sides the next two turns are on, as the hands hold the cube
        let (side, quarters) = (frame.side_of(self.steps[at].0), self.steps[at].1);
        let next = self.steps.get(at + 1).map(|&(face, _)| frame.side_of(face));
        let mut options = vec![WritingOption { token: Token::new(&format!("{}{}", side as char, SUFFIXES[quarters])), covers: 1, frame }];
        for form in &self.forms {
            // How often the form is made for its face to turn as this turn does (none when it turns another side)
            let Some(first) = form.faces.iter().position(|face| face.as_bytes()[0] == side) else { continue };
            let count = if form.faces[first].ends_with('\'') { 4 - quarters } else { quarters };
            let (_, turns) = times(form.rotation, count);
            let after = frame.rotate(form.axis, turns);
            let (token, _) = times(form.token, count);
            if form.faces.len() == 1 {
                options.push(WritingOption { token: Token::new(&token), covers: 1, frame: after });
            } else {
                // A slice turn: the next turn has to be the form's other face, turned as the form turns it
                let other = form.faces[1 - first];
                let turned = if other.ends_with('\'') { 4 - count } else { count };
                if next == Some(other.as_bytes()[0]) && turned == self.steps[at + 1].1 {
                    options.push(WritingOption { token: Token::new(&token), covers: 2, frame: after });
                }
            }
        }
        options
    }

    // Whether the rest of the answer can still end held as its grip names it (or in one of the other frames it may end in) from a place in a frame,
    // worked out once each
    fn can_end(&mut self, at: usize, frame: Frame) -> bool {
        if at == self.steps.len() {
            return frame == Frame::HOME || self.ends.contains(&frame);
        }
        if let Some(&end) = self.reaches.get(&(at, frame)) {
            return end;
        }
        let end = self.all_at(at, frame).iter().any(|option| self.can_end(at + option.covers, option.frame));
        self.reaches.insert((at, frame), end);
        end
    }

    // The ways on from a place in a frame that can still end right, worked out once each (the search asks again for each set of layers turned)
    pub fn options_at(&mut self, at: usize, frame: Frame) -> &[WritingOption] {
        if !self.kept.contains_key(&(at, frame)) {
            let all = self.all_at(at, frame);
            let options: Vec<WritingOption> = all.into_iter().filter(|option| self.can_end(at + option.covers, option.frame)).collect();
            self.kept.insert((at, frame), options);
        }
        &self.kept[&(at, frame)]
    }
}
