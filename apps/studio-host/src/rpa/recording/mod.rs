//! Recording consent and capture are separate from execution grants and receipts.
pub mod protocol;
pub(super) mod uia;
pub(super) mod process;
mod worker;
pub use worker::main as worker_main;
