use serde::{Deserialize, Serialize};
pub(super) const ERROR: &str = "BLK-RPA-COORDINATE-001";
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Rect { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }
impl Rect {
    pub fn contains(&self, (x,y):(i32,i32))->bool { x>=self.left && x<self.right && y>=self.top && y<self.bottom }
    fn valid(&self)->bool { let width=i64::from(self.right)-i64::from(self.left);let height=i64::from(self.bottom)-i64::from(self.top);(1..=65536).contains(&width)&&(1..=65536).contains(&height) }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Frame { pub window: Rect, pub client: Rect, pub desktop: Rect, pub dpi: u32 }
impl Frame {
    pub fn valid(&self)->bool {
        self.window.valid() && self.client.valid() && self.desktop.valid() && self.dpi>0
            && self.client.left>=self.window.left && self.client.top>=self.window.top
            && self.client.right<=self.window.right && self.client.bottom<=self.window.bottom
    }
    pub fn permits(&self,point:(i32,i32))->bool {self.valid()&&self.client.contains(point)&&self.desktop.contains(point)}
}
#[derive(Clone)]
pub(super) struct Observation {
    pub frame: Frame, pub foreground: usize, pub hit_root: usize,
    pub unobscured: bool, pub idle: bool, pub clip: Rect, pub cursor: (i32, i32),
}
pub(super) trait Desktop {
    fn observe(&mut self, point: (i32, i32)) -> Result<Observation, String>;
    fn move_pointer(&mut self, point: (i32, i32)) -> Result<(), String>;
    fn click_pair(&mut self) -> u32;
    fn release_left(&mut self);
}
fn verify(frame:&Frame,window:usize,point:(i32,i32),state:&Observation)->Result<(),String> {
    if window==0 || !frame.permits(point) || state.frame!=*frame || state.foreground!=window
        || state.hit_root!=window || !state.unobscured || !state.idle || !state.clip.contains(point) {
        return Err(ERROR.into());
    }
    Ok(())
}
pub(super) fn perform(frame: &Frame, window: usize, point: (i32, i32), desktop: &mut impl Desktop) -> Result<(), String> {
    if !frame.permits(point) {return Err(ERROR.into());}
    verify(frame,window,point,&desktop.observe(point)?)?;
    desktop.move_pointer(point)?;
    let current=desktop.observe(point)?;
    verify(frame,window,point,&current)?;
    if current.cursor!=point {return Err(ERROR.into());}
    match desktop.click_pair() {
        2=>Ok(()),
        inserted=>{
            // Release only a press inserted by this call. Never retry the click.
            if inserted==1 {desktop.release_left();}
            Err("BLK-RPA-COORDINATE-003".into())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    fn frame() -> Frame { Frame { window: Rect { left:-200, top:0, right:400, bottom:500 }, client: Rect { left:-190, top:30, right:390, bottom:490 }, desktop: Rect { left:-1920, top:0, right:2560, bottom:1440 }, dpi:144 } }
    fn observation() -> Observation { let frame=frame(); Observation { clip:frame.desktop.clone(), frame, foreground:1, hit_root:1, unobscured:true, idle:true, cursor:(-100,50) } }
    struct Fixture { observations:VecDeque<Result<Observation,String>>, moves:usize, clicks:usize, releases:usize, inserted:u32 }
    impl Desktop for Fixture {
        fn observe(&mut self,_:(i32,i32))->Result<Observation,String>{self.observations.pop_front().expect("bounded checks")}
        fn move_pointer(&mut self,_:(i32,i32))->Result<(),String>{self.moves+=1;Ok(())}
        fn click_pair(&mut self)->u32{self.clicks+=1;self.inserted}
        fn release_left(&mut self){self.releases+=1;}
    }
    fn fixture(before:Observation,after:Observation)->Fixture { Fixture{observations:VecDeque::from([Ok(before),Ok(after)]),moves:0,clicks:0,releases:0,inserted:2} }
    #[test]
    fn windows_coordinate_dispatch_requires_two_stable_observations_and_one_complete_click() {
        let mut desktop=fixture(observation(),observation());
        perform(&frame(),1,(-100,50),&mut desktop).unwrap();
        assert_eq!((desktop.moves,desktop.clicks,desktop.releases),(1,1,0));
    }
    #[test]
    fn windows_coordinate_guards_fail_before_move_or_click() {
        for index in 0..8 {
            let mut bad=observation();
            match index {0=>bad.frame.window.left+=1,1=>bad.frame.dpi=96,2=>bad.foreground=2,3=>bad.hit_root=2,4=>bad.unobscured=false,5=>bad.idle=false,6=>bad.clip.left=0,_=>bad.frame.desktop.right+=1};
            let mut desktop=fixture(bad.clone(),observation());
            assert!(perform(&frame(),1,(-100,50),&mut desktop).is_err());
            assert_eq!((desktop.moves,desktop.clicks),(0,0));
            let mut desktop=fixture(observation(),bad);
            assert!(perform(&frame(),1,(-100,50),&mut desktop).is_err());
            assert_eq!((desktop.moves,desktop.clicks),(1,0));
        }
        for point in [(-201,50),(-100,0),(390,50),(-100,490),(32767,32767)] {
            let mut desktop=fixture(observation(),observation());
            assert!(perform(&frame(),1,point,&mut desktop).is_err());assert_eq!((desktop.moves,desktop.clicks),(0,0));
        }
        let mut moved=observation();moved.cursor=(100,100);
        let mut desktop=fixture(observation(),moved);
        assert!(perform(&frame(),1,(-100,50),&mut desktop).is_err());assert_eq!((desktop.moves,desktop.clicks),(1,0));
    }
    #[test]
    fn windows_coordinate_cancellation_and_partial_insertion_never_retry_the_effect() {
        let mut desktop=fixture(observation(),observation());desktop.observations[1]=Err("BLK-RPA-CANCELLED".into());
        assert_eq!(perform(&frame(),1,(-100,50),&mut desktop).unwrap_err(),"BLK-RPA-CANCELLED");assert_eq!(desktop.clicks,0);
        for count in [0,1] {
            let mut desktop=fixture(observation(),observation());desktop.inserted=count;
            assert_eq!(perform(&frame(),1,(-100,50),&mut desktop).unwrap_err(),"BLK-RPA-COORDINATE-003");
            assert_eq!((desktop.clicks,desktop.releases),(1,usize::from(count==1)));
        }
    }
}
