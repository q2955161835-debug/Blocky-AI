use super::*;
use serde_json::Value;
pub fn validate_id(id: &str) -> Result<(), String> {
    if [embedding_model::MODEL_ID, small_models::EMBED].contains(&id) {
        Ok(())
    } else {
        Err("BLK-EMBED-MODEL".into())
    }
}
pub fn signature(id: &str) -> Result<String, String> {
    validate_id(id)?;
    if id == embedding_model::MODEL_ID {
        Ok(embedding_model::signature())
    } else {
        small_models::signature(id)
    }
}
pub fn metadata(id: &str) -> Result<Value, String> {
    validate_id(id)?;
    if id == embedding_model::MODEL_ID {
        Ok(embedding_model::metadata())
    } else {
        small_models::metadata(id)
    }
}
pub fn status(id: &str) -> Result<Value, String> {
    if id == embedding_model::MODEL_ID {
        embedding_model::status(id)
    } else {
        small_models::status(id)
    }
}
pub fn install(id: &str) -> Result<Value, String> {
    if id == embedding_model::MODEL_ID {
        embedding_model::install(id)
    } else {
        small_models::install(id)
    }
}
pub fn infer(id: &str, text: &str, query: bool) -> Result<Vec<f32>, String> {
    validate_id(id)?;
    if id == embedding_model::MODEL_ID {
        embedding_model::infer(text, query)
    } else {
        small_models::infer(text)
    }
}
