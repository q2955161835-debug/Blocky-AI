use std::{
    cell::RefCell,
    path::{Path, PathBuf},
};
thread_local! { static ACTIVE:RefCell<Option<(PathBuf,Vec<u8>)>>=const{RefCell::new(None)}; }
pub struct Cancellation;
impl Cancellation {
    pub fn begin(path: &Path) -> Self {
        let file = path.join("cancel");
        let token = std::fs::read(&file).unwrap_or_default();
        ACTIVE.with(|v| *v.borrow_mut() = Some((file, token)));
        Self
    }
}
impl Drop for Cancellation {
    fn drop(&mut self) {
        ACTIVE.with(|v| *v.borrow_mut() = None);
    }
}
pub fn check() -> Result<(), String> {
    ACTIVE.with(|v| {
        if let Some((path, token)) = &*v.borrow() {
            if std::fs::read(path).unwrap_or_default() != *token {
                return Err("BLK-KNOW-CANCELLED".into());
            }
        }
        Ok(())
    })
}
