//! Windows physical input stays inside a reviewed, unchanged client area.
use super::{coordinate::{self, Desktop, Frame, Observation, Rect, ERROR}, target::{self,Target}};
use uiautomation::{UIAutomation,UIElement,types::Point};
use windows_sys::Win32::{Foundation::*,Graphics::Gdi::ClientToScreen,UI::{HiDpi::*,Input::KeyboardAndMouse::*,WindowsAndMessaging::*}};

struct Dpi(DPI_AWARENESS_CONTEXT);
impl Dpi {
    fn enter()->Result<Self,String> {
        let previous=unsafe{SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)};
        if previous.is_null(){Err(ERROR.into())}else{Ok(Self(previous))}
    }
}
impl Drop for Dpi {fn drop(&mut self){unsafe{SetThreadDpiAwarenessContext(self.0);}}}
fn rect(value:RECT)->Rect {Rect{left:value.left,top:value.top,right:value.right,bottom:value.bottom}}
fn read_frame(target:&Target)->Result<Frame,String> {
    target::verify(target)?;
    let hwnd=target.window as HWND;
    let mut window=RECT::default();let mut client=RECT::default();
    unsafe {
        if IsIconic(hwnd)!=0 || IsWindowEnabled(hwnd)==0 || GetWindowRect(hwnd,&mut window)==0 || GetClientRect(hwnd,&mut client)==0 {return Err(ERROR.into());}
        let mut first=POINT{x:client.left,y:client.top};let mut last=POINT{x:client.right,y:client.bottom};
        if ClientToScreen(hwnd,&mut first)==0 || ClientToScreen(hwnd,&mut last)==0 {return Err(ERROR.into());}
        let left=GetSystemMetrics(SM_XVIRTUALSCREEN);let top=GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width=GetSystemMetrics(SM_CXVIRTUALSCREEN);let height=GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if width<=0 || height<=0 {return Err(ERROR.into());}
        let frame=Frame{window:rect(window),client:Rect{left:first.x,top:first.y,right:last.x,bottom:last.y},desktop:Rect{left,top,right:left.checked_add(width).ok_or(ERROR)?,bottom:top.checked_add(height).ok_or(ERROR)?},dpi:GetDpiForWindow(hwnd)};
        if !frame.valid() {return Err(ERROR.into());}
        Ok(frame)
    }
}
pub(super) fn snapshot(target:&Target)->Result<Frame,String>{let _dpi=Dpi::enter()?;read_frame(target)}
pub(super) fn activate(target:&Target,expected:&Frame)->Result<(),String> {
    let _dpi=Dpi::enter()?;
    if read_frame(target)?!=*expected {return Err(ERROR.into());}
    let hwnd=target.window as HWND;
    // Called by the native approval process only after its explicit Allow button.
    unsafe {if GetForegroundWindow()!=hwnd && SetForegroundWindow(hwnd)==0 {return Err(ERROR.into());}}
    if unsafe{GetForegroundWindow()}!=hwnd {return Err(ERROR.into());}
    Ok(())
}
fn unobscured(window:HWND,point:(i32,i32))->Result<bool,String> {
    let mut current=unsafe{GetTopWindow(std::ptr::null_mut())};
    for _ in 0..512 {
        if current.is_null(){return Ok(false);}
        if current==window{return Ok(true);}
        if unsafe{IsWindowVisible(current)}!=0 && unsafe{IsIconic(current)}==0 {
            let mut area=RECT::default();
            if unsafe{GetWindowRect(current,&mut area)}==0{return Err(ERROR.into());}
            // Reject even disabled/transparent overlays skipped by WindowFromPoint.
            if rect(area).contains(point){return Ok(false);}
        }
        current=unsafe{GetWindow(current,GW_HWNDNEXT)};
    }
    Err(ERROR.into())
}
struct Native<'a>{target:&'a Target,automation:&'a UIAutomation,root:&'a UIElement,root_id:&'a [i32],expected:&'a Frame,point:(i32,i32)}
impl Desktop for Native<'_> {
    fn observe(&mut self,point:(i32,i32))->Result<Observation,String> {
        if self.root.get_runtime_id().map_err(|_|ERROR)?!=self.root_id || self.root.get_process_id().map_err(|_|ERROR)?!=self.target.process_id {return Err(ERROR.into());}
        // Coordinates do not bypass the established sensitive-control policy.
        let element=self.automation.element_from_point(Point::new(point.0,point.1)).map_err(|_|ERROR)?;
        if element.get_process_id().map_err(|_|ERROR)?!=self.target.process_id || !element.is_enabled().map_err(|_|ERROR)? || element.is_offscreen().map_err(|_|ERROR)? {return Err(ERROR.into());}
        if element.is_password().map_err(|_|"BLK-RPA-SENSITIVE-001")? {return Err("BLK-RPA-SENSITIVE-001".into());}
        // COM can block or run provider callbacks; take geometry after those calls.
        let frame=read_frame(self.target)?;
        unsafe {
            let hit=WindowFromPoint(POINT{x:point.0,y:point.1});
            let mut clip=RECT::default();let mut cursor=POINT::default();
            let mut gui=GUITHREADINFO{cbSize:std::mem::size_of::<GUITHREADINFO>()as u32,..Default::default()};
            if hit.is_null() || GetClipCursor(&mut clip)==0 || GetPhysicalCursorPos(&mut cursor)==0 || GetGUIThreadInfo(0,&mut gui)==0 {return Err(ERROR.into());}
            let idle=gui.hwndCapture.is_null() && gui.hwndMenuOwner.is_null() && gui.hwndMoveSize.is_null()
                && (1..=254).all(|key|GetAsyncKeyState(key)>=0);
            Ok(Observation{frame,foreground:GetForegroundWindow()as usize,hit_root:GetAncestor(hit,GA_ROOT)as usize,unobscured:unobscured(self.target.window as HWND,point)?,idle,clip:rect(clip),cursor:(cursor.x,cursor.y)})
        }
    }
    fn move_pointer(&mut self,point:(i32,i32))->Result<(),String>{if unsafe{SetPhysicalCursorPos(point.0,point.1)}==0{Err(ERROR.into())}else{Ok(())}}
    fn click_pair(&mut self)->u32{
        // Final synchronous checks immediately before injecting the contiguous pair.
        // A refusal here is deliberately reported as uncertain by the Host ledger.
        let mut cursor=POINT::default();
        if read_frame(self.target).as_ref()!=Ok(self.expected) {return 0;}
        unsafe {
            if GetForegroundWindow()!=self.target.window as HWND || GetPhysicalCursorPos(&mut cursor)==0
                || (cursor.x,cursor.y)!=self.point || GetAncestor(WindowFromPoint(cursor),GA_ROOT)!=self.target.window as HWND
                || (1..=254).any(|key|GetAsyncKeyState(key)<0) {return 0;}
        }
        if unobscured(self.target.window as HWND,self.point)!=Ok(true) {return 0;}
        send(&[MOUSEEVENTF_LEFTDOWN,MOUSEEVENTF_LEFTUP])
    }
    fn release_left(&mut self){let _=send(&[MOUSEEVENTF_LEFTUP]);}
}
fn send(flags:&[u32])->u32 {
    let inputs=flags.iter().map(|flags|INPUT{r#type:INPUT_MOUSE,Anonymous:INPUT_0{mi:MOUSEINPUT{dwFlags:*flags,..Default::default()}}}).collect::<Vec<_>>();
    unsafe{SendInput(inputs.len()as u32,inputs.as_ptr(),std::mem::size_of::<INPUT>()as i32)}
}
pub(super) fn click(target:&Target,automation:&UIAutomation,root:&UIElement,root_id:&[i32],frame:&Frame,point:(i32,i32))->Result<(),String>{
    let _dpi=Dpi::enter()?;
    coordinate::perform(frame,target.window,point,&mut Native{target,automation,root,root_id,expected:frame,point})
}
