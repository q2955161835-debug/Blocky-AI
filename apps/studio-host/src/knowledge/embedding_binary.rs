//! Append-only, checksummed float32 cache. A partial final record is a resumable
//! interrupted write; a corrupt complete record is never silently accepted.
use super::*;
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{BufReader, Read, Seek, SeekFrom, Write},
    path::Path,
};
const MAGIC: &[u8; 8] = b"BLKE5V1\0";
pub const RECORD: usize = 8 + 32 + embedding_model::DIM * 4 + 32;
pub const MAX_PACK: u64 = 1024 * 1024 * 1024;
pub fn encode(key: &str, vector: &[f32]) -> Result<Vec<u8>, String> {
    embedding_model::validate_vector(vector)?;
    if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(INVALID.into());
    }
    let mut bytes = Vec::with_capacity(RECORD);
    bytes.extend(MAGIC);
    for i in (0..64).step_by(2) {
        bytes.push(u8::from_str_radix(&key[i..i + 2], 16).map_err(|_| INVALID)?);
    }
    for value in vector {
        bytes.extend(value.to_le_bytes());
    }
    let checksum = sha2::Sha256::digest(&bytes);
    bytes.extend(checksum);
    Ok(bytes)
}
pub fn decode(record: &[u8]) -> Result<(String, Vec<f32>), String> {
    use sha2::Digest;
    if record.len() != RECORD || &record[..8] != MAGIC {
        return Err("BLK-EMBED-CORRUPT".into());
    }
    if sha2::Sha256::digest(&record[..RECORD - 32]).as_slice() != &record[RECORD - 32..] {
        return Err("BLK-EMBED-CORRUPT".into());
    }
    let key = record[8..40].iter().map(|b| format!("{b:02x}")).collect();
    let vector = record[40..RECORD - 32]
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect::<Vec<_>>();
    embedding_model::validate_vector(&vector).map_err(|_| "BLK-EMBED-CORRUPT")?;
    Ok((key, vector))
}
use sha2::Digest;
pub struct Cache {
    file: File,
    pub entries: HashMap<String, u64>,
    length: u64,
}
impl Cache {
    pub fn open(path: &Path) -> Result<Self, String> {
        if path.exists() {
            ingest::no_links(path)?;
        }
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)
            .map_err(|_| IO)?;
        let size = file.metadata().map_err(|_| IO)?.len();
        if size > MAX_PACK {
            return Err("BLK-EMBED-CACHE-LIMIT".into());
        }
        let length = size / RECORD as u64 * RECORD as u64;
        if length != size {
            file.set_len(length).map_err(|_| IO)?;
        }
        let mut entries = HashMap::new();
        let mut record = vec![0u8; RECORD];
        {
            let mut reader = BufReader::with_capacity(256 * 1024, &mut file);
            for (row, offset) in (0..length).step_by(RECORD).enumerate() {
                if row % 64 == 0 { cancel::check()?; }
                reader.read_exact(&mut record).map_err(|_| IO)?;
                let (key, _) = decode(&record)?;
                entries.insert(key, offset);
            }
        }
        file.seek(SeekFrom::End(0)).map_err(|_| IO)?;
        Ok(Self {
            file,
            entries,
            length,
        })
    }
    pub fn append(&mut self, key: &str, vector: &[f32]) -> Result<u64, String> {
        if self.length + RECORD as u64 > MAX_PACK {
            return Err("BLK-EMBED-CACHE-LIMIT".into());
        }
        let record = encode(key, vector)?;
        let offset = self.length;
        self.file.write_all(&record).map_err(|_| IO)?;
        self.entries.insert(key.into(), offset);
        self.length += record.len() as u64;
        Ok(offset)
    }
    pub fn checkpoint(&mut self) -> Result<(), String> {
        self.file.sync_all().map_err(|_| IO.into())
    }
}
pub struct VectorReader {
    reader: BufReader<File>,
    position: u64,
    size: u64,
}
impl VectorReader {
    pub fn open(path: &Path) -> Result<Self, String> {
        ingest::no_links(path)?;
        let file = fs::File::open(path).map_err(|_| "BLK-EMBED-NOT-READY")?;
        let size = file.metadata().map_err(|_| IO)?.len();
        if size > MAX_PACK {
            return Err("BLK-EMBED-CORRUPT".into());
        }
        Ok(Self {
            reader: BufReader::with_capacity(1024 * 1024, file),
            position: 0,
            size,
        })
    }
    pub fn read(&mut self, offset: u64, key: &str) -> Result<Vec<f32>, String> {
        if offset % RECORD as u64 != 0
            || offset
                .checked_add(RECORD as u64)
                .is_none_or(|end| end > self.size)
        {
            return Err("BLK-EMBED-CORRUPT".into());
        }
        if self.position != offset {
            self.reader.seek(SeekFrom::Start(offset)).map_err(|_| IO)?;
        }
        let mut record = [0u8; RECORD];
        self.reader.read_exact(&mut record).map_err(|_| IO)?;
        self.position = offset + RECORD as u64;
        let (actual, vector) = decode(&record)?;
        if actual != key {
            return Err("BLK-EMBED-CORRUPT".into());
        }
        Ok(vector)
    }
}
