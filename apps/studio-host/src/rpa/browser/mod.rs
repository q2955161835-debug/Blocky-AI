mod assets;
mod manager;
mod process;
pub(crate) use crate::rpa::ipc::PipeProcess as BrowserProcess;
pub use manager::BrowserStart;
pub(super) use manager::Manager;
#[cfg(test)]
mod tests;
