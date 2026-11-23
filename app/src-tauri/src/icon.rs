//! App icons for agents: the bundle's .icns rendered to a small PNG with
//! `sips`, cached on disk by bundle path and modification time.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;

const SIZE: &str = "128";

pub fn app_icon_png(bundle: &Path, cache: &Path) -> Option<Vec<u8>> {
    let mtime = std::fs::metadata(bundle.join("Contents/Info.plist"))
        .and_then(|m| m.modified())
        .ok()?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    bundle.hash(&mut h);
    mtime.hash(&mut h);
    let out = cache.join(format!("{:016x}.png", h.finish()));
    if let Ok(bytes) = std::fs::read(&out) {
        return Some(bytes);
    }
    let icns = icns_path(bundle)?;
    std::fs::create_dir_all(cache).ok()?;
    let ok = Command::new("/usr/bin/sips")
        .args(["-s", "format", "png", "-Z", SIZE])
        .arg(&icns)
        .arg("--out")
        .arg(&out)
        .output()
        .is_ok_and(|o| o.status.success());
    if !ok {
        return None;
    }
    std::fs::read(&out).ok()
}

fn icns_path(bundle: &Path) -> Option<PathBuf> {
    let plist = bundle.join("Contents/Info.plist");
    let res = bundle.join("Contents/Resources");
    let named = ["CFBundleIconFile", "CFBundleIconName"]
        .iter()
        .find_map(|key| {
            let o = Command::new("/usr/bin/plutil")
                .args(["-extract", key, "raw", "-o", "-"])
                .arg(&plist)
                .output()
                .ok()?;
            let name = String::from_utf8(o.stdout).ok()?.trim().to_string();
            (o.status.success() && !name.is_empty()).then_some(name)
        })
        .map(|n| {
            let p = res.join(&n);
            if p.extension().is_some() {
                p
            } else {
                res.join(format!("{n}.icns"))
            }
        })
        .filter(|p| p.is_file());
    named.or_else(|| {
        // Some bundles ship the icon under another name; take the largest .icns.
        std::fs::read_dir(&res)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "icns"))
            .max_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
    })
}

pub fn data_url(png: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(22 + png.len() * 4 / 3 + 4);
    s.push_str("data:image/png;base64,");
    for c in png.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        s.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    s
}

#[cfg(test)]
mod tests {
    #[test]
    fn base64() {
        assert_eq!(super::data_url(b"Man"), "data:image/png;base64,TWFu");
        assert_eq!(super::data_url(b"Ma"), "data:image/png;base64,TWE=");
        assert_eq!(super::data_url(b"M"), "data:image/png;base64,TQ==");
    }
}
