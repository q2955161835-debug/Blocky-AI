//! Child operations resolve one component against a held directory, never a path.
use std::{
    ffi::{OsStr, OsString, c_void},
    fs::File,
    io,
    ops::{Deref, DerefMut},
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        fs::MetadataExt,
        io::{AsRawHandle, FromRawHandle},
    },
    path::{Component, Path, PathBuf, Prefix},
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_DISPOSITION_INFO, FileDispositionInfo, FileFullDirectoryInfo,
    FileFullDirectoryRestartInfo, GetFileInformationByHandleEx, SetFileInformationByHandle,
};

#[derive(Debug)]
pub(super) struct EntryLimit;
impl std::fmt::Display for EntryLimit {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Directory entry limit exceeded")
    }
}
impl std::error::Error for EntryLimit {}

type Handle = *mut c_void;
#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}
#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root: Handle,
    name: *mut UnicodeString,
    attributes: u32,
    security_descriptor: *mut c_void,
    security_qos: *mut c_void,
}
#[repr(C)]
struct IoStatus {
    status: usize,
    information: usize,
}
#[repr(C)]
struct RenameInformation {
    replace: u8,
    root: Handle,
    name_length: u32,
    name: [u16; 1],
}
#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtCreateFile(
        handle: *mut Handle,
        access: u32,
        attributes: *mut ObjectAttributes,
        status: *mut IoStatus,
        allocation: *mut i64,
        file_attributes: u32,
        share: u32,
        disposition: u32,
        options: u32,
        ea: *mut c_void,
        ea_length: u32,
    ) -> i32;
    fn NtSetInformationFile(
        handle: Handle,
        status: *mut IoStatus,
        information: *mut c_void,
        length: u32,
        class: u32,
    ) -> i32;
    fn RtlNtStatusToDosError(status: i32) -> u32;
}
fn nt_result(status: i32) -> io::Result<()> {
    if status >= 0 {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(status) } as i32,
        ))
    }
}
fn component(name: &OsStr) -> io::Result<Vec<u16>> {
    let wide: Vec<_> = name.encode_wide().collect();
    if wide.is_empty()
        || wide.len() > 255
        || wide == [46]
        || wide == [46, 46]
        || wide
            .iter()
            .any(|v| *v < 32 || [47, 92, 58, 42, 63, 34, 60, 62, 124].contains(v))
        || matches!(wide.last(), Some(32 | 46))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Expected one file name component",
        ));
    }
    Ok(wide)
}

pub(super) fn root(path: &Path) -> io::Result<File> {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    let invalid = || {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "Expected absolute directory path",
        )
    };
    let mut components = path.components();
    let Some(Component::Prefix(prefix)) = components.next() else {
        return Err(invalid());
    };
    if !matches!(
        prefix.kind(),
        Prefix::Disk(_) | Prefix::VerbatimDisk(_) | Prefix::UNC(_, _) | Prefix::VerbatimUNC(_, _)
    ) || !matches!(components.next(), Some(Component::RootDir))
    {
        return Err(invalid());
    }
    let mut anchor = PathBuf::from(prefix.as_os_str());
    anchor.push("\\");
    let anchor = OpenOptions::new()
        .read(true)
        .share_mode(3)
        .custom_flags(0x02200000)
        .open(anchor)?;
    super::verify(&anchor, true)
        .map_err(|_| io::Error::new(io::ErrorKind::PermissionDenied, "Unsafe path anchor"))?;
    // Keep each opened ancestor pinned until the selected directory has been
    // acquired. No later component can be resolved through a replaced path.
    let mut held = vec![anchor];
    for part in components {
        let Component::Normal(name) = part else {
            return Err(invalid());
        };
        let child = open(held.last().unwrap(), name, true, false, false)?;
        super::verify(&child, true)
            .map_err(|_| io::Error::new(io::ErrorKind::PermissionDenied, "Unsafe ancestor"))?;
        held.push(child);
    }
    Ok(held.pop().unwrap())
}

pub(super) fn open(
    parent: &File,
    name: &OsStr,
    directory: bool,
    write: bool,
    create: bool,
) -> io::Result<File> {
    let mut wide = component(name)?;
    let mut name = UnicodeString {
        length: (wide.len() * 2) as u16,
        maximum_length: (wide.len() * 2) as u16,
        buffer: wide.as_mut_ptr(),
    };
    let mut attributes = ObjectAttributes {
        length: std::mem::size_of::<ObjectAttributes>() as u32,
        root: parent.as_raw_handle(),
        name: &mut name,
        attributes: 0x40 | 0x1000, // OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE
        security_descriptor: std::ptr::null_mut(),
        security_qos: std::ptr::null_mut(),
    };
    let mut status = IoStatus {
        status: 0,
        information: 0,
    };
    let mut handle = std::ptr::null_mut();
    let access = 0x80000000
        | 0x00100000
        | if write && !directory {
            0x40000000 | 0x00010000
        } else {
            0
        };
    let options = 0x00200000 | 0x20 | if directory { 1 } else { 0x40 };
    let disposition = if create {
        if directory { 3 } else { 2 }
    } else {
        1
    };
    nt_result(unsafe {
        NtCreateFile(
            &mut handle,
            access,
            &mut attributes,
            &mut status,
            std::ptr::null_mut(),
            0x80,
            if directory { 3 } else { 1 },
            disposition,
            options,
            std::ptr::null_mut(),
            0,
        )
    })?;
    // Successful synchronous opens transfer exactly one owned handle to File.
    let file = unsafe { File::from_raw_handle(handle) };
    // FILE_OPEN_REPARSE_POINT can legitimately return the reparse object even
    // with OBJ_DONT_REPARSE. Reject that handle without ever following it.
    if file.metadata()?.file_attributes() & 0x400 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Reparse point refused",
        ));
    }
    Ok(file)
}

pub(super) fn names(directory: &File) -> io::Result<Vec<(OsString, bool)>> {
    // u64 backing keeps native records suitably aligned. The filename starts at
    // byte 68 in FILE_FULL_DIR_INFO; records are linked by NextEntryOffset.
    let mut storage = vec![0u64; 8192];
    let mut result = Vec::new();
    let mut seen = 0usize;
    let mut restart = true;
    loop {
        storage.fill(0);
        let ok = unsafe {
            GetFileInformationByHandleEx(
                directory.as_raw_handle(),
                if restart {
                    FileFullDirectoryRestartInfo
                } else {
                    FileFullDirectoryInfo
                },
                storage.as_mut_ptr().cast(),
                (storage.len() * 8) as u32,
            )
        };
        if ok == 0 {
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(18) {
                Ok(result)
            } else {
                Err(error)
            };
        }
        restart = false;
        let bytes =
            unsafe { std::slice::from_raw_parts(storage.as_ptr().cast::<u8>(), storage.len() * 8) };
        let mut offset = 0;
        loop {
            if offset + 68 > bytes.len() {
                return Err(io::Error::other("Invalid directory record"));
            }
            let field = |at: usize| {
                u32::from_le_bytes(bytes[offset + at..offset + at + 4].try_into().unwrap())
            };
            let next = field(0) as usize;
            let attributes = field(56);
            let length = field(60) as usize;
            if length % 2 != 0
                || length > 510
                || offset + 68 + length > bytes.len()
                || (next != 0 && (next < 68 + length || offset + next >= bytes.len()))
            {
                return Err(io::Error::other("Invalid directory record"));
            }
            let wide: Vec<u16> = bytes[offset + 68..offset + 68 + length]
                .chunks_exact(2)
                .map(|s| u16::from_le_bytes([s[0], s[1]]))
                .collect();
            if wide != [46] && wide != [46, 46] {
                seen += 1;
                if seen > 1000 {
                    return Err(io::Error::other(EntryLimit));
                }
                if attributes & 0x400 == 0 {
                    result.push((OsString::from_wide(&wide), attributes & 0x10 != 0));
                }
            }
            if next == 0 {
                break;
            }
            offset += next;
        }
    }
}

pub(super) fn rename(file: &File, parent: &File, name: &OsStr) -> io::Result<()> {
    let wide = component(name)?;
    let offset = std::mem::offset_of!(RenameInformation, name);
    let size = offset + wide.len() * 2;
    let mut storage = vec![0usize; size.div_ceil(std::mem::size_of::<usize>())];
    let info = storage.as_mut_ptr().cast::<RenameInformation>();
    unsafe {
        (*info).replace = 0;
        (*info).root = parent.as_raw_handle();
        (*info).name_length = (wide.len() * 2) as u32;
        std::ptr::copy_nonoverlapping(
            wide.as_ptr(),
            storage.as_mut_ptr().cast::<u8>().add(offset).cast(),
            wide.len(),
        );
    }
    let mut status = IoStatus {
        status: 0,
        information: 0,
    };
    nt_result(unsafe {
        NtSetInformationFile(
            file.as_raw_handle(),
            &mut status,
            info.cast(),
            size as u32,
            10,
        )
    })
}

pub(super) struct StagedFile {
    file: File,
    parent: File,
    published: bool,
}
impl StagedFile {
    pub(super) fn new(parent: &File) -> io::Result<Self> {
        let parent = parent.try_clone()?;
        let name = format!(".blocky-coding-{}", uuid::Uuid::new_v4());
        let file = open(&parent, OsStr::new(&name), false, true, true)?;
        Ok(Self {
            file,
            parent,
            published: false,
        })
    }
    pub(super) fn as_file(&self) -> &File {
        &self.file
    }
    pub(super) fn persist_noclobber(mut self, target: &Path) -> io::Result<()> {
        let name = target
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Missing target name"))?;
        rename(&self.file, &self.parent, name)?;
        self.published = true;
        Ok(())
    }
}
impl Deref for StagedFile {
    type Target = File;
    fn deref(&self) -> &File {
        &self.file
    }
}
impl DerefMut for StagedFile {
    fn deref_mut(&mut self) -> &mut File {
        &mut self.file
    }
}
impl Drop for StagedFile {
    fn drop(&mut self) {
        if !self.published {
            let delete = FILE_DISPOSITION_INFO { DeleteFile: true };
            unsafe {
                SetFileInformationByHandle(
                    self.file.as_raw_handle(),
                    FileDispositionInfo,
                    (&delete as *const FILE_DISPOSITION_INFO).cast(),
                    std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::OpenOptions,
        io::{Read, Write},
        os::windows::fs::OpenOptionsExt,
    };
    use windows_sys::Win32::{Storage::FileSystem::MoveFileExW, System::IO::DeviceIoControl};

    fn sandbox() -> tempfile::TempDir {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../try/coding-agent-final-2026-10-02/handle-io-tests");
        std::fs::create_dir_all(&root).unwrap();
        tempfile::tempdir_in(root.canonicalize().unwrap()).unwrap()
    }
    fn directory(path: &Path) -> File {
        OpenOptions::new()
            .read(true)
            .share_mode(3)
            .custom_flags(0x02200000)
            .open(path)
            .unwrap()
    }
    fn junction(path: &Path, target: &Path) {
        let handle = OpenOptions::new()
            .write(true)
            .share_mode(3)
            .custom_flags(0x02200000)
            .open(path)
            .unwrap();
        let target = target.canonicalize().unwrap();
        let target_text = target.to_string_lossy();
        let target_text = target_text.strip_prefix("\\\\?\\").unwrap_or(&target_text);
        let substitute: Vec<u16> = OsString::from(format!("\\??\\{target_text}"))
            .encode_wide()
            .collect();
        let print: Vec<u16> = target.as_os_str().encode_wide().collect();
        let mut buffer = vec![0u8; 16 + (substitute.len() + print.len() + 2) * 2];
        buffer[0..4].copy_from_slice(&0xa0000003u32.to_le_bytes());
        let data_length = (buffer.len() - 8) as u16;
        buffer[4..6].copy_from_slice(&data_length.to_le_bytes());
        buffer[10..12].copy_from_slice(&((substitute.len() * 2) as u16).to_le_bytes());
        buffer[12..14].copy_from_slice(&((substitute.len() * 2 + 2) as u16).to_le_bytes());
        buffer[14..16].copy_from_slice(&((print.len() * 2) as u16).to_le_bytes());
        for (i, value) in substitute.iter().enumerate() {
            buffer[16 + i * 2..18 + i * 2].copy_from_slice(&value.to_le_bytes());
        }
        let print_at = 18 + substitute.len() * 2;
        for (i, value) in print.iter().enumerate() {
            buffer[print_at + i * 2..print_at + i * 2 + 2].copy_from_slice(&value.to_le_bytes());
        }
        let mut returned = 0;
        assert_ne!(
            unsafe {
                DeviceIoControl(
                    handle.as_raw_handle(),
                    0x000900a4,
                    buffer.as_ptr().cast(),
                    buffer.len() as u32,
                    std::ptr::null_mut(),
                    0,
                    &mut returned,
                    std::ptr::null_mut(),
                )
            },
            0,
            "{}",
            io::Error::last_os_error()
        );
    }
    #[test]
    fn grant_rejects_ancestor_junction_before_root_open() {
        let temp = sandbox();
        let alias = temp.path().join("alias");
        let outside = temp.path().join("outside");
        std::fs::create_dir(&alias).unwrap();
        std::fs::create_dir_all(outside.join("selected")).unwrap();
        std::fs::write(outside.join("selected/sentinel.txt"), b"outside sentinel").unwrap();
        assert!(super::super::Scope::new(&outside.join("selected")).is_ok());
        junction(&alias, &outside);
        assert_eq!(
            std::fs::read(alias.join("selected/sentinel.txt")).unwrap(),
            b"outside sentinel"
        );
        assert!(super::super::Scope::new(&alias.join("selected")).is_err());
        assert_eq!(
            std::fs::read(outside.join("selected/sentinel.txt")).unwrap(),
            b"outside sentinel"
        );
    }
    #[test]
    fn relative_roundtrip_noclobber_and_drop() {
        let temp = sandbox();
        let parent = directory(temp.path());
        let child = open(&parent, OsStr::new("nested"), true, false, true).unwrap();
        let mut staged = StagedFile::new(&child).unwrap();
        staged.write_all(b"original").unwrap();
        staged.sync_all().unwrap();
        staged.persist_noclobber(Path::new("original.txt")).unwrap();
        let mut file = open(&child, OsStr::new("original.txt"), false, false, false).unwrap();
        let mut text = String::new();
        file.read_to_string(&mut text).unwrap();
        assert_eq!(text, "original");
        drop(file);
        let mut second = StagedFile::new(&child).unwrap();
        second.write_all(b"overwrite").unwrap();
        assert!(second.persist_noclobber(Path::new("original.txt")).is_err());
        {
            let mut abandoned = StagedFile::new(&child).unwrap();
            abandoned.write_all(b"abandoned").unwrap();
        }
        assert_eq!(
            names(&child).unwrap(),
            vec![(OsString::from("original.txt"), false)]
        );
        let source = open(&child, OsStr::new("original.txt"), false, true, false).unwrap();
        rename(&source, &child, OsStr::new("renamed.txt")).unwrap();
        drop(source);
        assert_eq!(
            std::fs::read(temp.path().join("nested/renamed.txt")).unwrap(),
            b"original"
        );
        assert!(open(&parent, OsStr::new("../escape"), false, true, true).is_err());
        assert!(open(&parent, OsStr::new("stream:ads"), false, true, true).is_err());
    }
    #[test]
    fn held_directory_cannot_be_renamed() {
        let temp = sandbox();
        let path = temp.path().join("held");
        std::fs::create_dir(&path).unwrap();
        let _held = directory(&path);
        let from: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = temp
            .path()
            .join("moved")
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        assert_eq!(unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) }, 0);
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(32));
    }
    #[test]
    fn enumeration_continues_batches_and_enforces_limit() {
        let temp = sandbox();
        let parent = directory(temp.path());
        for i in 0..1000 {
            let name = format!("{i:04}-{}.txt", "x".repeat(120));
            drop(open(&parent, OsStr::new(&name), false, true, true).unwrap());
        }
        assert_eq!(names(&parent).unwrap().len(), 1000);
        drop(open(&parent, OsStr::new("one-too-many.txt"), false, true, true).unwrap());
        assert!(names(&parent).is_err());
    }
    #[test]
    fn regular_file_holds_write_and_delete_sharing_closed() {
        let temp = sandbox();
        let path = temp.path().join("locked.txt");
        std::fs::write(&path, b"original").unwrap();
        let parent = directory(temp.path());
        let _held = open(&parent, OsStr::new("locked.txt"), false, false, false).unwrap();
        assert!(OpenOptions::new().write(true).open(&path).is_err());
        assert!(std::fs::remove_file(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
    }
    #[test]
    fn relative_io_does_not_follow_retargeted_parent_or_child() {
        let temp = sandbox();
        let inside = temp.path().join("inside");
        let outside = temp.path().join("outside");
        std::fs::create_dir(&inside).unwrap();
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("outside-only.txt"), b"outside sentinel").unwrap();
        let held = directory(&inside);
        junction(&inside, &outside);
        assert_eq!(
            std::fs::read(inside.join("outside-only.txt")).unwrap(),
            b"outside sentinel"
        );
        assert!(open(&held, OsStr::new("outside-only.txt"), false, false, false).is_err());
        if let Ok(mut original) = open(&held, OsStr::new("safe.txt"), false, true, true) {
            original.write_all(b"original physical directory").unwrap();
        }
        if let Ok(mut staged) = StagedFile::new(&held) {
            staged.write_all(b"original staged file").unwrap();
            let _ = staged.persist_noclobber(Path::new("published.txt"));
        }
        let listed = names(&held).unwrap();
        assert!(!listed.iter().any(|(name, _)| name == "outside-only.txt"));
        assert!(!outside.join("safe.txt").exists());
        assert!(!outside.join("published.txt").exists());
        assert_eq!(
            std::fs::read(outside.join("outside-only.txt")).unwrap(),
            b"outside sentinel"
        );
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 1);
        drop(held);
        let root = directory(temp.path());
        assert!(open(&root, OsStr::new("inside"), true, false, false).is_err());
        assert!(
            !names(&root)
                .unwrap()
                .iter()
                .any(|(name, _)| name == "inside")
        );
    }
}
