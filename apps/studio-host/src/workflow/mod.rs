//! Native workflow ledger, private CLI coordinator and explicit business decisions.
//! Unknown-effect reconciliation remains closed until worker settlement is integrated.
mod protocol;
mod transitions;
mod store;
mod execution;
mod managed_assets;
mod managed_wire;
pub mod managed;
mod staging;
pub mod query;
pub mod session;
pub mod decision;
pub mod host;
pub use protocol::{create, parse, summary};
pub use store::{Lease, Store};
pub use transitions::transition;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod execution_tests;
