//! A private AppContainer SID grants access only to an owned execution directory.
//! No network capability, desktop access or Host token is shared.
use std::{
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree},
    Security::{
        Authorization::*,
        Isolation::{CreateAppContainerProfile, DeleteAppContainerProfile},
        *,
    },
    Storage::FileSystem::{
        DELETE, FILE_ALL_ACCESS, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};
mod cleanup;
pub(crate) use cleanup::record_pending;
pub(crate) use cleanup::{cleanup, cleanup_status};
const ERROR: &str = "BLK-TOOL-SANDBOX";
struct Allocation(*mut core::ffi::c_void);
impl Drop for Allocation {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                LocalFree(self.0);
            }
        }
    }
}
pub(crate) struct Sandbox {
    sid: PSID,
    root: PathBuf,
    name: Vec<u16>,
    closed: bool,
    lock: Option<std::fs::File>,
}
impl Sandbox {
    pub(crate) fn new(directory: &tempfile::TempDir) -> Result<Self, String> {
        let root = directory.path();
        crate::knowledge::no_links(root).map_err(|_| ERROR)?;
        let root = root.canonicalize().map_err(|_| ERROR)?;
        owner_access(&root)?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("sandbox.lock"))
            .map_err(|_| ERROR)?;
        lock.try_lock().map_err(|_| ERROR)?;
        let name: Vec<u16> = format!("Blocky.Tool.{}\0", uuid::Uuid::new_v4())
            .encode_utf16()
            .collect();
        cleanup::record(&root, &String::from_utf16_lossy(&name[..name.len() - 1]))?;
        let mut sid = null_mut();
        if unsafe {
            CreateAppContainerProfile(
                name.as_ptr(),
                name.as_ptr(),
                name.as_ptr(),
                null(),
                0,
                &mut sid,
            )
        } < 0
            || sid.is_null()
        {
            return Err(ERROR.into());
        }
        #[cfg(test)]
        eprintln!(
            "created temporary Windows AppContainer profile: {}",
            PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
                .join("Packages")
                .join(String::from_utf16_lossy(&name[..name.len() - 1]))
                .display()
        );
        Ok(Self {
            sid,
            root,
            name,
            closed: false,
            lock: Some(lock),
        })
    }
    /// Call after process settlement. A failed system cleanup is a visible error.
    pub(crate) fn close(&mut self) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }
        let result = unsafe { DeleteAppContainerProfile(self.name.as_ptr()) };
        #[cfg(test)]
        eprintln!("AppContainer profile deletion HRESULT={result}");
        if result < 0 {
            return Err("BLK-TOOL-CLEANUP".into());
        }
        self.closed = true;
        self.lock.take();
        Ok(())
    }
    pub(crate) fn sid(&self) -> PSID {
        self.sid
    }
    /// This method never grants ancestors. The root is a fresh Host-owned TempDir.
    pub(crate) fn grant_tree(&self, path: &Path, writable: bool) -> Result<(), String> {
        fn walk(
            sandbox: &Sandbox,
            path: &Path,
            writable: bool,
            depth: usize,
            count: &mut usize,
        ) -> Result<(), String> {
            *count += 1;
            if depth > 16 || *count > 4096 {
                return Err(ERROR.into());
            }
            crate::knowledge::no_links(path).map_err(|_| ERROR)?;
            let canonical = path.canonicalize().map_err(|_| ERROR)?;
            if !canonical.starts_with(&sandbox.root) || canonical == sandbox.root {
                return Err(ERROR.into());
            }
            sandbox.grant(&canonical, writable)?;
            if path.is_dir() {
                for entry in std::fs::read_dir(path).map_err(|_| ERROR)? {
                    walk(
                        sandbox,
                        &entry.map_err(|_| ERROR)?.path(),
                        writable,
                        depth + 1,
                        count,
                    )?;
                }
            }
            Ok(())
        }
        walk(self, path, writable, 0, &mut 0)
    }
    fn grant(&self, path: &Path, writable: bool) -> Result<(), String> {
        let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut descriptor = null_mut();
        let mut old_acl = null_mut();
        let result = unsafe {
            GetNamedSecurityInfoW(
                name.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                &mut old_acl,
                null_mut(),
                &mut descriptor,
            )
        };
        let _descriptor = Allocation(descriptor);
        if result != 0 {
            #[cfg(test)]
            eprintln!("GetNamedSecurityInfoW={result}");
            return Err(ERROR.into());
        }
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: FILE_GENERIC_READ
                | FILE_GENERIC_EXECUTE
                | if writable {
                    FILE_GENERIC_WRITE | DELETE
                } else {
                    0
                },
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: if path.is_dir() {
                SUB_CONTAINERS_AND_OBJECTS_INHERIT
            } else {
                NO_INHERITANCE
            },
            Trustee: TRUSTEE_W {
                pMultipleTrustee: null_mut(),
                MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: self.sid as _,
            },
        };
        let mut new_acl = null_mut();
        let result = unsafe { SetEntriesInAclW(1, &entry, old_acl, &mut new_acl) };
        let _acl = Allocation(new_acl as _);
        if result != 0 {
            #[cfg(test)]
            eprintln!("SetEntriesInAclW={result}");
            return Err(ERROR.into());
        }
        let result = unsafe {
            SetNamedSecurityInfoW(
                name.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                new_acl,
                null(),
            )
        };
        if result != 0 {
            #[cfg(test)]
            eprintln!("SetNamedSecurityInfoW.dacl={result}");
            return Err(ERROR.into());
        }
        if writable {
            let label: Vec<u16> = "S:(ML;OICI;NW;;;LW)\0".encode_utf16().collect();
            let mut descriptor = null_mut();
            if unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    label.as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    null_mut(),
                )
            } == 0
            {
                #[cfg(test)]
                eprintln!("ConvertSDDL={}", unsafe {
                    windows_sys::Win32::Foundation::GetLastError()
                });
                return Err(ERROR.into());
            }
            let _descriptor = Allocation(descriptor);
            let mut present = 0;
            let mut defaulted = 0;
            let mut sacl = null_mut();
            if unsafe {
                GetSecurityDescriptorSacl(descriptor, &mut present, &mut sacl, &mut defaulted)
            } == 0
                || present == 0
            {
                return Err(ERROR.into());
            }
            let result = unsafe {
                SetNamedSecurityInfoW(
                    name.as_ptr(),
                    SE_FILE_OBJECT,
                    LABEL_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    null(),
                    sacl,
                )
            };
            if result != 0 {
                #[cfg(test)]
                eprintln!("SetNamedSecurityInfoW.label={result}");
                return Err(ERROR.into());
            }
        }
        Ok(())
    }
}
/// Fresh directories can inherit only Modify on data volumes. Grant their verified
/// owner the missing WRITE_OWNER right before assigning a Low integrity work area.
fn owner_access(root: &Path) -> Result<(), String> {
    let name: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut owner = null_mut();
    let mut old_acl = null_mut();
    let mut descriptor = null_mut();
    let result = unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut old_acl,
            null_mut(),
            &mut descriptor,
        )
    };
    let _descriptor = Allocation(descriptor);
    if result != 0 {
        return Err(ERROR.into());
    }
    let mut token = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(ERROR.into());
    }
    let mut size = 0;
    unsafe {
        GetTokenInformation(token, TokenUser, null_mut(), 0, &mut size);
    }
    let mut storage = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
    let ok = unsafe {
        GetTokenInformation(token, TokenUser, storage.as_mut_ptr() as _, size, &mut size)
    };
    unsafe {
        CloseHandle(token);
    }
    if ok == 0
        || unsafe { EqualSid(owner, (*(storage.as_ptr() as *const TOKEN_USER)).User.Sid) } == 0
    {
        return Err(ERROR.into());
    }
    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: FILE_ALL_ACCESS,
        grfAccessMode: GRANT_ACCESS,
        grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_USER,
            ptstrName: owner as _,
        },
    };
    let mut acl = null_mut();
    let result = unsafe { SetEntriesInAclW(1, &entry, old_acl, &mut acl) };
    let _acl = Allocation(acl as _);
    if result != 0
        || unsafe {
            SetNamedSecurityInfoW(
                name.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                acl,
                null(),
            )
        } != 0
    {
        return Err(ERROR.into());
    }
    Ok(())
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = self.close();
        unsafe {
            FreeSid(self.sid);
        }
    }
}
#[cfg(test)]
mod tests;
