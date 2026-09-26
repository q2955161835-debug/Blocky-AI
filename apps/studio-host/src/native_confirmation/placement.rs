#[derive(Clone, Copy, Debug)]
pub(super) struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

// All coordinates are physical desktop pixels, including negative monitor origins.
// A prompt that cannot fit in the visible owner area must not offer approval.
pub(super) fn position(owner: Rect, work: Rect, width: i32, height: i32) -> Option<(i32, i32)> {
    let left = i64::from(owner.left.max(work.left));
    let top = i64::from(owner.top.max(work.top));
    let right = i64::from(owner.right.min(work.right));
    let bottom = i64::from(owner.bottom.min(work.bottom));
    let width = i64::from(width);
    let height = i64::from(height);
    if width <= 0 || height <= 0 || right - left < width || bottom - top < height {
        return None;
    }
    Some((
        (left + (right - left - width) / 2) as i32,
        (top + (bottom - top - height) / 2) as i32,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialog_stays_in_left_hand_owner() {
        assert_eq!(
            position(
                Rect {
                    left: 0,
                    top: 0,
                    right: 1200,
                    bottom: 800
                },
                Rect {
                    left: 0,
                    top: 0,
                    right: 2560,
                    bottom: 1400
                },
                480,
                300,
            ),
            Some((360, 250))
        );
    }

    #[test]
    fn negative_monitor_coordinates_are_preserved() {
        assert_eq!(
            position(
                Rect {
                    left: -1900,
                    top: -100,
                    right: -700,
                    bottom: 700
                },
                Rect {
                    left: -1920,
                    top: -200,
                    right: 0,
                    bottom: 880
                },
                480,
                300,
            ),
            Some((-1540, 150))
        );
    }

    #[test]
    fn partially_offscreen_owner_uses_visible_intersection() {
        assert_eq!(
            position(
                Rect {
                    left: -200,
                    top: -100,
                    right: 1000,
                    bottom: 700
                },
                Rect {
                    left: 0,
                    top: 0,
                    right: 2560,
                    bottom: 1400
                },
                480,
                300,
            ),
            Some((260, 200))
        );
    }

    #[test]
    fn unusable_bounds_cannot_offer_approval() {
        let owner = Rect {
            left: 0,
            top: 0,
            right: 1200,
            bottom: 800,
        };
        let work = Rect {
            left: 0,
            top: 0,
            right: 2560,
            bottom: 1400,
        };
        assert_eq!(position(owner, work, 1201, 300), None);
        assert_eq!(position(owner, work, 480, 801), None);
        assert_eq!(position(owner, work, 0, 300), None);
        assert_eq!(position(owner, work, 480, -1), None);
        assert_eq!(position(Rect { right: 0, ..owner }, work, 480, 300), None);
        assert_eq!(position(owner, Rect { left: 2000, ..work }, 480, 300), None);
    }
}
