//! Talking to the OS file manager and default apps ("Reveal in Finder / File
//! Explorer", "open this link").

use std::path::Path;
use std::process::Command;

fn run(mut cmd: Command) -> Result<(), String> {
    // Exit codes are ignored: explorer.exe, for one, returns 1 on success.
    cmd.status().map(|_| ()).map_err(|e| e.to_string())
}

/// Show `path` selected in its folder.
pub fn reveal(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg("-R").arg(path);
        run(cmd)
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer parses its own command line: `/select,"C:\a b\c"` as one raw argument.
        let mut cmd = quiver_core::proc::command("explorer.exe");
        cmd.raw_arg(format!("/select,\"{}\"", path.display()));
        run(cmd)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(path.parent().unwrap_or(path));
        run(cmd)
    }
}

/// Open a folder, file or web link with the default application.
pub fn open(target: &std::ffi::OsStr) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg(target);
        run(cmd)
    }
    #[cfg(windows)]
    {
        // No shell involved, so `&` and friends in a URL stay data.
        let mut cmd = quiver_core::proc::command("explorer.exe");
        cmd.arg(target);
        run(cmd)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(target);
        run(cmd)
    }
}
