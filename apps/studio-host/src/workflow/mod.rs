//! Native durable-workflow ledger. No WebView or CLI dispatch until worker settlement is integrated.
mod protocol;
mod transitions;
mod store;
pub use protocol::{create, parse, summary};
pub use store::{Lease, Store};
pub use transitions::transition;
#[cfg(test)]
mod tests;
