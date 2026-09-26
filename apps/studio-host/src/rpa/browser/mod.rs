mod assets;
mod capture;
mod manager;
mod process;
pub(crate) use crate::rpa::ipc::PipeProcess as BrowserProcess;
pub(in crate::rpa) use process::start;
pub use manager::BrowserStart;
pub(super) use manager::Manager;
#[cfg(test)]
mod tests;
