<#
  End-to-end check of the Windows CLI in a throwaway user profile.

  Creates a skill, syncs it to two agents, breaks things on purpose, runs
  `quiver doctor`, and asserts that the links on disk really are junctions that
  resolve (and, with links disabled, that agents get real copies instead).

  Never touches the real profile: USERPROFILE points at a temp folder for this
  process and everything it starts.
#>
param(
  [Parameter(Mandatory = $true)][string]$Quiver
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Quiver = (Resolve-Path $Quiver).Path
$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$profileDir = Join-Path $base ("quiver-e2e-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $profileDir | Out-Null
$profileDir = (Resolve-Path $profileDir).Path

# A clean, isolated environment: Windows home comes from USERPROFILE.
$env:USERPROFILE = $profileDir
foreach ($v in 'HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'GITHUB_TOKEN', 'GH_TOKEN', 'QUIVER_WINDOWS_LINKS') {
  Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}
$env:QUIVER_NO_TRASH = '1'

$failures = 0
function Check([bool]$ok, [string]$what) {
  if ($ok) { Write-Host "  ok   $what" }
  else { Write-Host "  FAIL $what"; $script:failures++ }
}

# Runs quiver, echoes its output, returns stdout as one string; fails on a non-zero exit.
function Quiver-Run {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$QArgs)
  Write-Host "> quiver $($QArgs -join ' ')"
  $out = (& $Quiver @QArgs 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "quiver $($QArgs -join ' ') exited with $LASTEXITCODE`n$out" }
  Write-Host $out.TrimEnd()
  return $out
}

# Runs `quiver ... --json` and parses stdout as JSON.
function Quiver-Json {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$QArgs)
  $raw = (& $Quiver @QArgs '--json' 2>$null | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "quiver $($QArgs -join ' ') --json exited with $LASTEXITCODE" }
  return $raw | ConvertFrom-Json
}

function Presence([string]$skillId, [string]$agentId) {
  $skills = @(Quiver-Json list)
  $skill = $skills | Where-Object { $_.id -eq $skillId } | Select-Object -First 1
  if (-not $skill) { return '<no such skill>' }
  $p = @($skill.presence) | Where-Object { $_.agentId -eq $agentId } | Select-Object -First 1
  if (-not $p) { return '<no such agent>' }
  return $p.presence
}

# Whether anything (including a broken junction) sits at the path.
function Exists-Entry([string]$path) {
  return $null -ne (Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue)
}
function Link-Type([string]$path) {
  $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return '<missing>' }
  if ($item.LinkType) { return [string]$item.LinkType }
  return 'None'
}
# Removes a junction or symlink without touching its target.
function Remove-Link([string]$path) {
  [IO.Directory]::Delete($path, $false)
}

$claude = Join-Path $profileDir '.claude\skills'
$cursor = Join-Path $profileDir '.cursor\skills'
$store  = Join-Path $profileDir '.agents\skills'
$mine   = Join-Path $profileDir 'Skills'
New-Item -ItemType Directory -Path $claude, $cursor | Out-Null

Write-Host "`n== profile: $profileDir"

Write-Host "`n== agents are found under USERPROFILE, with plain paths"
$agents = @(Quiver-Json agents)
$claudeAgent = $agents | Where-Object { $_.id -eq 'claude-code' }
$cursorAgent = $agents | Where-Object { $_.id -eq 'cursor' }
Check ($claudeAgent.detected -eq $true) 'claude-code detected from ~\.claude'
Check ($cursorAgent.detected -eq $true) 'cursor detected from ~\.cursor'
Check ($claudeAgent.skillsDir -eq $claude) "claude skills dir is $claude (got $($claudeAgent.skillsDir))"
Check (-not ($claudeAgent.skillsDir -like '\\?\*')) 'no \\?\ prefix leaks into paths'

Write-Host "`n== create a skill: it syncs to every detected agent"
Quiver-Run new e2e-skill -d 'End to end check' | Out-Null
$skillMd = Join-Path $mine 'e2e-skill\SKILL.md'
Check (Test-Path -LiteralPath $skillMd) 'the skill lives in the My Skills folder'
foreach ($dir in $claude, $cursor) {
  $link = Join-Path $dir 'e2e-skill'
  Check ((Link-Type $link) -eq 'Junction') "$link is a junction (got $(Link-Type $link))"
  Check (Test-Path -LiteralPath (Join-Path $link 'SKILL.md')) "$link resolves to the skill"
  Check ((Get-Content -Raw -LiteralPath (Join-Path $link 'SKILL.md')) -eq (Get-Content -Raw -LiteralPath $skillMd)) "$link reads the same file as My Skills"
}
Check ((Link-Type (Join-Path $store 'e2e-skill')) -eq 'Junction') 'the store entry is a junction into My Skills'
Check ((Presence 'e2e-skill' 'claude-code') -eq 'linked') 'quiver reports claude-code as linked'
Check ((Presence 'e2e-skill' 'cursor') -eq 'linked') 'quiver reports cursor as linked'

# Edits through the real folder show up through every link.
Set-Content -LiteralPath (Join-Path $mine 'e2e-skill\extra.md') -Value 'more'
Check (Test-Path -LiteralPath (Join-Path $claude 'e2e-skill\extra.md')) 'a file added to the source is visible through the agent link'

Write-Host "`n== doctor on a healthy profile"
$out = Quiver-Run doctor
Check ($out -match '0 missing link\(s\), 0 broken link\(s\), 0 conflict\(s\)') 'doctor finds nothing to fix'

Write-Host "`n== a missing link is reported and repaired"
Remove-Link (Join-Path $cursor 'e2e-skill')
Check (Test-Path -LiteralPath $skillMd) 'removing the link left the source alone'
$out = Quiver-Run doctor
Check ($out -match '1 missing link\(s\)') 'doctor reports one missing link'
Quiver-Run doctor --apply | Out-Null
Check ((Link-Type (Join-Path $cursor 'e2e-skill')) -eq 'Junction') 'doctor --apply recreated the junction'
Check (Test-Path -LiteralPath (Join-Path $cursor 'e2e-skill\SKILL.md')) 'and it resolves'

Write-Host "`n== a broken junction is detected and pruned"
$gone = Join-Path $profileDir 'gone'
New-Item -ItemType Directory -Path $gone | Out-Null
$ghost = Join-Path $cursor 'ghost'
New-Item -ItemType Junction -Path $ghost -Target $gone | Out-Null
Remove-Item -LiteralPath $gone -Recurse -Force
Check ((Link-Type $ghost) -eq 'Junction') 'set up a junction whose target is gone'
Check ((Presence 'ghost' 'cursor') -eq 'broken') 'quiver reports it as broken'
$out = Quiver-Run doctor
Check ($out -match '1 broken link\(s\)') 'doctor reports one broken link'
Quiver-Run doctor --apply | Out-Null
Check (-not (Exists-Entry $ghost)) 'doctor --apply removed the broken junction'

Write-Host "`n== link / unlink one agent"
Quiver-Run unlink e2e-skill cursor | Out-Null
Check (-not (Exists-Entry (Join-Path $cursor 'e2e-skill'))) 'unlink removed cursor''s junction'
Check (Test-Path -LiteralPath (Join-Path $claude 'e2e-skill\SKILL.md')) 'claude-code still sees the skill'
Check (Test-Path -LiteralPath $skillMd) 'the source folder is untouched'
Quiver-Run link e2e-skill cursor | Out-Null
Check (Test-Path -LiteralPath (Join-Path $cursor 'e2e-skill\SKILL.md')) 'link restored cursor''s junction'

Write-Host "`n== adopting a real folder from one agent makes it universal"
$writer = Join-Path $claude 'writer'
New-Item -ItemType Directory -Path $writer | Out-Null
Set-Content -LiteralPath (Join-Path $writer 'SKILL.md') -Value "---`nname: writer`ndescription: Hand-made skill`n---`nbody"
Quiver-Run adopt writer | Out-Null
Check ((Link-Type (Join-Path $store 'writer')) -eq 'None') 'the folder moved into the store as a real directory'
Check ((Link-Type (Join-Path $claude 'writer')) -eq 'Junction') 'claude-code has a junction where the folder was'
Check ((Link-Type (Join-Path $cursor 'writer')) -eq 'Junction') 'cursor got one too'
Check (Test-Path -LiteralPath (Join-Path $cursor 'writer\SKILL.md')) 'and it resolves'

Write-Host "`n== with links unavailable, agents get real copies"
$env:QUIVER_WINDOWS_LINKS = 'copy'
$solo = Join-Path $store 'copy-skill'
New-Item -ItemType Directory -Path $solo | Out-Null
Set-Content -LiteralPath (Join-Path $solo 'SKILL.md') -Value "---`nname: copy-skill`ndescription: Copy fallback`n---`nbody"
Quiver-Run doctor --apply | Out-Null
foreach ($dir in $claude, $cursor) {
  $copy = Join-Path $dir 'copy-skill'
  Check ((Link-Type $copy) -eq 'None') "$copy is a real folder, not a link"
  Check (Test-Path -LiteralPath (Join-Path $copy 'SKILL.md')) "$copy has the files"
}
Check ((Presence 'copy-skill' 'cursor') -eq 'copied') 'quiver reports cursor as copied'
Remove-Item Env:QUIVER_WINDOWS_LINKS
$out = Quiver-Run doctor
Check ($out -match '0 missing link\(s\), 0 broken link\(s\)') 'copies count as present'

Write-Host "`n== remove"
Quiver-Run remove e2e-skill | Out-Null
foreach ($p in (Join-Path $claude 'e2e-skill'), (Join-Path $cursor 'e2e-skill'), (Join-Path $store 'e2e-skill'), (Join-Path $mine 'e2e-skill')) {
  Check (-not (Exists-Entry $p)) "$p is gone"
}
Check (Test-Path -LiteralPath (Join-Path $profileDir '.quiver\trash')) 'the folder went to the backup trash'

Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction SilentlyContinue
if ($failures -gt 0) {
  Write-Host "`n$failures check(s) failed"
  exit 1
}
Write-Host "`nall checks passed"
