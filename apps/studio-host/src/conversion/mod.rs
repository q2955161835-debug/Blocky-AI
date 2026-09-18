//! Narrow repository snapshots and derived analysis data; never repository execution.
mod protocol;
mod store;
pub use protocol::dispatch;
pub use store::ConversionStore;
#[cfg(test)]
mod tests;
const INVALID: &str = "BLK-CONVERT-INVALID";
const IO: &str = "BLK-CONVERT-IO";
const DENIED: &str = "BLK-CONVERT-DENIED";
const CORRUPT: &str = "BLK-CONVERT-CORRUPT";
const LIMIT: &str = "BLK-CONVERT-LIMIT";
fn map_error(error: String) -> String {
    match error.as_str() {
        "BLK-KNOW-INVALID" => INVALID,
        "BLK-KNOW-DENIED" => DENIED,
        "BLK-KNOW-LIMIT" => LIMIT,
        "BLK-KNOW-IO" => IO,
        "BLK-KNOW-CANCELLED" => "BLK-CONVERT-CANCELLED",
        "BLK-KNOW-TIMEOUT" => "BLK-CONVERT-TIMEOUT",
        "BLK-KNOW-GIT" => "BLK-CONVERT-GIT",
        _ => return error,
    }
    .into()
}
