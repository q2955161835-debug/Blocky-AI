//! Native, project-scoped knowledge storage. Paths and grants never leave this module.
mod dns;
mod ingest;
mod network;
mod store;
mod types;
pub use store::KnowledgeStore;
pub(crate) use types::*;
mod index_guard;
mod protocol;
mod repository;
#[cfg(test)]
mod tests;
pub use protocol::dispatch;
mod cancel;
mod embedding;
mod embedding_binary;
mod embedding_model;
#[cfg(test)]
mod embedding_tests;
mod git_job;
