use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
const ERROR: &str = "BLK-SECRET-002";
pub struct SecretStore {
    root: PathBuf,
    lock: Mutex<()>,
}
impl SecretStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            lock: Mutex::new(()),
        }
    }
    fn path(&self, id: &str) -> Result<PathBuf, String> {
        if !crate::project_store::stable(id) {
            return Err(ERROR.into());
        }
        Ok(self.root.join(format!("{id}.bin")))
    }
    pub fn contains(&self, id: &str) -> Result<bool, String> {
        Ok(self.path(id)?.is_file())
    }
    pub fn remove(&self, id: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| ERROR)?;
        let p = self.path(id)?;
        if p.exists() {
            std::fs::remove_file(p).map_err(|_| ERROR)?;
        }
        Ok(())
    }
    pub fn import_env(&self, id: &str, file: &Path, variable: &str) -> Result<(), String> {
        if variable.is_empty()
            || variable.len() > 128
            || !variable
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
            || variable.as_bytes()[0].is_ascii_digit()
        {
            return Err(ERROR.into());
        }
        if std::fs::metadata(file).map_err(|_| ERROR)?.len() > 1024 * 1024 {
            return Err(ERROR.into());
        }
        let mut raw = Vec::new();
        std::fs::File::open(file)
            .map_err(|_| ERROR)?
            .take(1024 * 1024 + 1)
            .read_to_end(&mut raw)
            .map_err(|_| ERROR)?;
        if raw.len() > 1024 * 1024 {
            wipe(&mut raw);
            return Err(ERROR.into());
        }
        let result = (|| {
            let text = std::str::from_utf8(&raw).map_err(|_| ERROR)?;
            let mut found = None;
            for line in text.trim_start_matches('\u{feff}').lines() {
                let line = line.trim();
                if line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    if key.trim() == variable {
                        if found.is_some() {
                            return Err(ERROR.into());
                        }
                        let v = value.trim();
                        let v = if v.len() >= 2
                            && ((v.starts_with('"') && v.ends_with('"'))
                                || (v.starts_with('\'') && v.ends_with('\'')))
                        {
                            &v[1..v.len() - 1]
                        } else {
                            v
                        };
                        found = Some(v);
                    }
                }
            }
            self.put(id, found.ok_or(ERROR)?.as_bytes())
        })();
        wipe(&mut raw);
        result
    }
    fn put(&self, id: &str, plain: &[u8]) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| ERROR)?;
        let path = self.path(id)?;
        if plain.is_empty() || plain.len() > 16384 || plain.contains(&0) {
            return Err(ERROR.into());
        }
        let encrypted = crypt(plain, true)?;
        std::fs::create_dir_all(&self.root).map_err(|_| ERROR)?;
        let mut tmp = tempfile::NamedTempFile::new_in(&self.root).map_err(|_| ERROR)?;
        tmp.write_all(b"BLKS1")
            .and_then(|_| tmp.write_all(&encrypted))
            .and_then(|_| tmp.as_file().sync_all())
            .map_err(|_| ERROR)?;
        tmp.persist(path).map_err(|_| ERROR)?;
        Ok(())
    }
    /// Values stay inside Host consumers; no IPC endpoint returns decrypted bytes.
    pub fn with_secret<T>(&self, id: &str, consume: impl FnOnce(&[u8]) -> T) -> Result<T, String> {
        let _guard = self.lock.lock().map_err(|_| ERROR)?;
        let path = self.path(id)?;
        if std::fs::metadata(&path).map_err(|_| ERROR)?.len() > 65536 {
            return Err(ERROR.into());
        }
        let bytes = std::fs::read(path).map_err(|_| ERROR)?;
        if !bytes.starts_with(b"BLKS1") {
            return Err(ERROR.into());
        }
        let mut plain = crypt(&bytes[5..], false)?;
        let value = consume(&plain);
        wipe(&mut plain);
        Ok(value)
    }
}
fn wipe(bytes: &mut [u8]) {
    for byte in bytes {
        unsafe {
            std::ptr::write_volatile(byte, 0);
        }
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}
#[cfg(windows)]
fn crypt(bytes: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len().try_into().map_err(|_| ERROR)?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err(ERROR.into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        wipe(std::slice::from_raw_parts_mut(
            output.pbData,
            output.cbData as usize,
        ));
        LocalFree(output.pbData as *mut _);
    }
    Ok(result)
}
#[cfg(not(windows))]
fn crypt(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err(ERROR.into())
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn native_secret_import_is_encrypted_and_never_returned_by_status() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/stage2-secrets");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let store = SecretStore::new(dir.path().join("vault"));
        let env = dir.path().join(".env");
        let canary = b"synthetic-secret-canary-stage2";
        std::fs::write(&env, format!("KEY={}\n", String::from_utf8_lossy(canary))).unwrap();
        store.import_env("test-secret", &env, "KEY").unwrap();
        assert!(store.contains("test-secret").unwrap());
        assert!(store.with_secret("test-secret", |v| v == canary).unwrap());
        let encrypted = std::fs::read(store.path("test-secret").unwrap()).unwrap();
        assert!(!encrypted.windows(canary.len()).any(|v| v == canary));
        assert!(store.import_env("../escape", &env, "KEY").is_err());
        assert!(store.import_env("test-secret", &env, "MISSING").is_err());
        assert!(store.with_secret("test-secret", |v| v == canary).unwrap());
        std::fs::write(store.path("test-secret").unwrap(), b"BLKS1tampered").unwrap();
        assert!(store.with_secret("test-secret", |_| ()).is_err());
        store.remove("test-secret").unwrap();
        assert!(!store.contains("test-secret").unwrap());
    }
}
