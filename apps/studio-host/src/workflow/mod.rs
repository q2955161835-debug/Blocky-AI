//! Native workflow ledger, private CLI coordinator and explicit business decisions.
//! Runtime cannot reconcile unknown effects; the explicit operator path requires settlement.
mod protocol;
mod transitions;
mod store;
mod execution;
mod managed_assets;
mod managed_wire;
mod custody;
pub mod desktop;
mod desktop_run;
pub mod managed;
mod staging;
pub mod query;
pub mod session;
pub mod decision;
pub mod reconciliation;
pub mod host;
pub use protocol::{create, parse, summary};
pub use store::{Lease, Store};
pub use transitions::transition;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod execution_tests;
#[cfg(test)]
mod desktop_tests;
