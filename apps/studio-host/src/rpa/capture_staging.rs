//! Transient encrypted images are owned by a PID + creation time, never a PID alone.
//! Call sweep/create while holding the capture Store's cross-process lock.
use super::owner::Owner;
use std::path::{Path,PathBuf};
const ERROR:&str="BLK-RPA-CAPTURE-001";
pub(super) const RESERVED:usize=super::capture_png::LIMIT+8192;
pub(super) struct Pending {path:PathBuf}
impl Pending {
    pub fn path(&self)->&Path{&self.path}
    pub fn close(self)->Result<(),String>{remove(&self.path)}
}
impl Drop for Pending {fn drop(&mut self){let _=remove(&self.path);}}
fn directory(path:&Path)->Result<(),String>{
    use std::os::windows::fs::MetadataExt;
    let meta=std::fs::symlink_metadata(path).map_err(|_|ERROR)?;
    if !meta.is_dir()||meta.file_attributes()&0x400!=0{return Err(ERROR.into());}Ok(())
}
fn contents(path:&Path)->Result<(),String>{
    directory(path)?;
    for entry in std::fs::read_dir(path).map_err(|_|ERROR)? {
        let entry=entry.map_err(|_|ERROR)?;
        if entry.file_name()!="capture.bin"{return Err(ERROR.into());}
        // No recursive deletion and no following reparse points, even in our staging area.
        super::captures::regular(&entry.path(),RESERVED)?;
    }Ok(())
}
fn remove(path:&Path)->Result<(),String>{
    if !path.exists(){return Ok(());}contents(path)?;
    let file=path.join("capture.bin");
    match std::fs::remove_file(file){Ok(())=>{},Err(e)if e.kind()==std::io::ErrorKind::NotFound=>{},Err(_)=>return Err(ERROR.into())}
    std::fs::remove_dir(path).map_err(|_|ERROR.into())
}
fn owner(name:&str)->Result<Owner,String>{
    let mut parts=name.strip_prefix("capture-").ok_or(ERROR)?.splitn(3,'-');
    let process_id=parts.next().ok_or(ERROR)?.parse::<u32>().map_err(|_|ERROR)?;
    let created=parts.next().ok_or(ERROR)?.parse::<u64>().map_err(|_|ERROR)?;
    let id=parts.next().ok_or(ERROR)?;
    if process_id==0||created==0||uuid::Uuid::parse_str(id).ok().is_none_or(|value|value.to_string()!=id){return Err(ERROR.into());}
    Ok(Owner{process_id,created})
}
pub(super) fn sweep(root:&Path)->Result<usize,String>{
    match std::fs::symlink_metadata(root){Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(0),Err(_)=>return Err(ERROR.into()),Ok(_)=>{}}directory(root)?;
    let mut active=0;
    for (index,entry) in std::fs::read_dir(root).map_err(|_|ERROR)?.enumerate(){
        if index>=64{return Err("BLK-RPA-CAPTURE-003".into());}
        let entry=entry.map_err(|_|ERROR)?;let name=entry.file_name();let owner=owner(name.to_str().ok_or(ERROR)?)?;
        contents(&entry.path())?;
        if owner.is_alive().map_err(|_|ERROR)?{active+=1;}else{remove(&entry.path())?;}
    }
    if active>16{return Err("BLK-RPA-CAPTURE-003".into());}Ok(active)
}
pub(super) fn create(root:&Path)->Result<Pending,String>{
    crate::profile::prepare(root)?;
    let owner=Owner::current().map_err(|_|ERROR)?;
    let path=root.join(format!("capture-{}-{}-{}",owner.process_id,owner.created,uuid::Uuid::new_v4()));
    std::fs::create_dir(&path).map_err(|_|ERROR)?;Ok(Pending{path})
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn cleans_only_confirmed_exited_owners_and_bounds_live_reservations(){
        let temp=super::super::tests::journal_directory();let profile=std::path::absolute(temp.path()).unwrap();
        let store=super::super::captures::Store::new(profile.join("captures"));
        let root=profile.join("capture-staging");let live=store.staging().unwrap();
        std::fs::write(live.path().join("capture.bin"),b"synthetic encrypted payload").unwrap();
        let current=Owner::current().unwrap();let stale=root.join(format!("capture-{}-{}-{}",current.process_id,current.created-1,uuid::Uuid::new_v4()));
        std::fs::create_dir(&stale).unwrap();std::fs::write(stale.join("capture.bin"),b"crashed ciphertext").unwrap();
        store.list().unwrap();assert!(!stale.exists());assert!(live.path().join("capture.bin").is_file());
        let mut pending=vec![];for _ in 0..15{pending.push(store.staging().unwrap());}
        assert!(store.staging().is_err());drop(pending);live.close().unwrap();
        assert_eq!(sweep(&root).unwrap(),0);
        let unknown=root.join("unrelated");std::fs::create_dir(&unknown).unwrap();std::fs::write(unknown.join("keep.txt"),b"keep").unwrap();
        assert!(store.list().is_err());assert!(unknown.join("keep.txt").exists());
    }
}
