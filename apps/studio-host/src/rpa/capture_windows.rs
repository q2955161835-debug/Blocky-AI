//! Offscreen rendering of the bound window only. Never copy desktop pixels.
use super::{capture_png, target::{self, Target}};
use std::{io::Write, path::Path};
use uiautomation::{UIAutomation, UIElement, types::TreeScope};
use windows_sys::Win32::{Foundation::*, Graphics::Gdi::*, Storage::Xps::PrintWindow, UI::{WindowsAndMessaging::*, HiDpi::*}};
const ERROR: &str = "BLK-RPA-CAPTURE-005";
#[derive(Clone, PartialEq, Eq)]
struct Rect { left:i32, top:i32, right:i32, bottom:i32 }
fn bounds(element:&UIElement)->Result<Rect,String> {
    let rect=element.get_bounding_rectangle().map_err(|_|ERROR)?;
    Ok(Rect{left:rect.get_left(),top:rect.get_top(),right:rect.get_right(),bottom:rect.get_bottom()})
}
fn masks(automation:&UIAutomation,root:&UIElement,target:&Target)->Result<Vec<(Vec<i32>,Rect)>,String> {
    let condition=automation.create_true_condition().map_err(|_|ERROR)?;
    let mut stack=vec![(root.clone(),0)];let mut seen=0;let mut result=vec![];
    while let Some((element,depth))=stack.pop() {
        seen+=1;if seen>2048 || depth>32 {return Err(ERROR.into());}
        // A foreign embedded provider cannot certify masking inside this window.
        if element.get_process_id().map_err(|_|ERROR)?!=target.process_id {return Err(ERROR.into());}
        let kind=format!("{:?}",element.get_control_type().map_err(|_|ERROR)?);
        if element.is_password().map_err(|_|ERROR)? || ["Edit","ComboBox","Document","Pane"].contains(&kind.as_str()) {
            if !element.is_offscreen().map_err(|_|ERROR)? {result.push((element.get_runtime_id().map_err(|_|ERROR)?,bounds(&element)?));}
        }
        let children=element.find_all(TreeScope::Children,&condition).map_err(|_|ERROR)?;
        if children.len()+seen+stack.len()>2048 {return Err(ERROR.into());}
        stack.extend(children.into_iter().map(|child|(child,depth+1)));
    }
    Ok(result)
}
struct Bitmap { dc:HDC, bitmap:HBITMAP, old:HGDIOBJ, pixels:*mut u8, length:usize }
impl Drop for Bitmap {
    fn drop(&mut self) {unsafe {
        if !self.pixels.is_null() {crate::secret_store::wipe(std::slice::from_raw_parts_mut(self.pixels,self.length));}
        if !self.old.is_null() {SelectObject(self.dc,self.old);}
        if !self.bitmap.is_null() {DeleteObject(self.bitmap);}
        if !self.dc.is_null() {DeleteDC(self.dc);}
    }}
}
struct Dpi(DPI_AWARENESS_CONTEXT);
impl Drop for Dpi {fn drop(&mut self){unsafe{SetThreadDpiAwarenessContext(self.0);}}}
pub(super) fn capture(automation:&UIAutomation,root:&UIElement,element:&UIElement,target:&Target,path:&Path)->Result<u32,String> {
    let previous=unsafe{SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)};
    if previous.is_null(){return Err(ERROR.into());}let _dpi=Dpi(previous);
    target::verify(target)?;
    let mut window=RECT::default();let hwnd=target.window as HWND;
    if unsafe{GetWindowRect(hwnd,&mut window)}==0 {return Err(ERROR.into());}
    let width=window.right-window.left;let height=window.bottom-window.top;
    if !(1..=2048).contains(&width)||!(1..=2048).contains(&height){return Err("BLK-RPA-CAPTURE-003".into());}
    let area=bounds(element)?;
    if area.left<window.left||area.top<window.top||area.right>window.right||area.bottom>window.bottom||area.right<=area.left||area.bottom<=area.top{return Err(ERROR.into());}
    let root_id=root.get_runtime_id().map_err(|_|ERROR)?;
    let element_id=element.get_runtime_id().map_err(|_|ERROR)?;
    let before=masks(automation,root,target)?;
    let mut dib=Bitmap{dc:unsafe{CreateCompatibleDC(std::ptr::null_mut())},bitmap:std::ptr::null_mut(),old:std::ptr::null_mut(),pixels:std::ptr::null_mut(),length:(width*height*4)as usize};
    if dib.dc.is_null(){return Err(ERROR.into());}
    let mut info=BITMAPINFO::default();info.bmiHeader=BITMAPINFOHEADER{biSize:std::mem::size_of::<BITMAPINFOHEADER>()as u32,biWidth:width,biHeight:-height,biPlanes:1,biBitCount:32,biCompression:BI_RGB,..Default::default()};
    let mut pixels=std::ptr::null_mut();
    dib.bitmap=unsafe{CreateDIBSection(dib.dc,&info,DIB_RGB_COLORS,&mut pixels,std::ptr::null_mut(),0)};
    if dib.bitmap.is_null()||pixels.is_null(){return Err(ERROR.into());}dib.pixels=pixels.cast();
    dib.old=unsafe{SelectObject(dib.dc,dib.bitmap)};
    if dib.old.is_null()||dib.old as isize == -1 {dib.old=std::ptr::null_mut();return Err(ERROR.into());}
    unsafe{std::slice::from_raw_parts_mut(dib.pixels,dib.length).fill(0);}
    // The worker Job bounds synchronous PrintWindow, including a hung target.
    if unsafe{PrintWindow(hwnd,dib.dc,0)}==0||unsafe{GdiFlush()}==0{return Err(ERROR.into());}
    target::verify(target)?;
    let mut after=RECT::default();
    if unsafe{GetWindowRect(hwnd,&mut after)}==0||[window.left,window.top,window.right,window.bottom]!=[after.left,after.top,after.right,after.bottom]
        ||root.get_runtime_id().map_err(|_|ERROR)?!=root_id||element.get_runtime_id().map_err(|_|ERROR)?!=element_id||bounds(element)?!=area||masks(automation,root,target)?!=before{return Err(ERROR.into());}
    let raw=unsafe{std::slice::from_raw_parts(dib.pixels,dib.length)};
    let w=(area.right-area.left)as u32;let h=(area.bottom-area.top)as u32;
    let mut rgba=vec![0;w as usize*h as usize*4];
    for y in 0..h as i32 {for x in 0..w as i32 {
        let screen_x=area.left+x;let screen_y=area.top+y;
        let index=((screen_y-window.top)*width+(screen_x-window.left))as usize*4;
        let out=(y as usize*w as usize+x as usize)*4;
        if !before.iter().any(|(_,r)|screen_x>=r.left&&screen_x<r.right&&screen_y>=r.top&&screen_y<r.bottom){rgba[out..out+3].copy_from_slice(&[raw[index+2],raw[index+1],raw[index]]);}
        rgba[out+3]=255;
    }}
    let png=capture_png::encode(w,h,&rgba);crate::secret_store::wipe(&mut rgba);let mut png=png?;
    let encrypted=crate::secret_store::crypt(&png,true);crate::secret_store::wipe(&mut png);let encrypted=encrypted?;
    let mut file=std::fs::File::options().write(true).create_new(true).open(path).map_err(|_|ERROR)?;
    file.write_all(&encrypted).and_then(|_|file.sync_all()).map_err(|_|ERROR)?;
    Ok(before.len()as u32)
}
