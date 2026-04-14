# Contract Review

## AC-01: Default greeting
✅ Verification command is concrete and deterministic.

## AC-02: Custom name greeting
❌ The expected output format is ambiguous — does it include a newline?

## AC-03: Package.json exists
✅ Verification command is concrete and deterministic.

## Verdict: REVISE
### Revision Reasons
- AC-02: Expected output must specify exact string including trailing newline behavior
