//! Spawning helper programs (git, gh, editors).

use std::ffi::OsStr;
use std::process::Command;

/// A [`Command`] that never flashes a console window when started from the
/// Windows app (`CREATE_NO_WINDOW`); a plain `Command` everywhere else.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}
