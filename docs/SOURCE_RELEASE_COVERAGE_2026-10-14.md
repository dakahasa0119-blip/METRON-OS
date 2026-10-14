# Historical body-source publication coverage (2026-10-14)

**Public repository:** `dakahasa0119-blip/METRON-OS`.

A GitHub repository being **public** does not mean a historical project is
complete, deployable, or legally licensed for general redistribution. The
original source archive and the independently MIT-licensed `reusable/`
libraries are different releases.

| System body | Public original source | Gaps / validation status |
| --- | --- | --- |
| MotherShip / METRON OS | `modules/gas/METRON_OS_B/`: 55 tracked files (including archived repairs, metadata and HTML) | The independent OS_A source is not separately verified as a complete published revision. The two actual Google spreadsheet files are **not** exported as public datasets. Historic cross-file transmission is not proven. |
| Gateway | `modules/gas/METRON_GATEWAY/`: 12 tracked historical files; additionally [six original cloud-only modules](../archive/gas/METRON_GATEWAY/cloud-only-2026-09-28/README.md) from the verified September archive | The full 15-file *as-of-September* source snapshot is not yet published as one consistent version: five contemporaneous cloud files differed from older Git copies. Do not mix files from these generations and claim deployability. |
| BAKU | `modules/gas/BAKU/`: 26 tracked files | Local verified cloud/Git archive comparison: 18 matched and seven differed at the comparison revision. A unified cloud snapshot release and independent unknown-fault repair study are outstanding. |
| ARC | `app/src/main/`: 34 tracked Android application files, alongside Gradle project files | Kotlin compilation and desktop Chromium selector tests exist. Android emulator/device end-to-end runtime and original production build have not been demonstrated. |
| Independent portable components | `reusable/` | MIT license applies to this directory **only**. Four independent package families can be packed/installed; these are reworked references, not source-level drop-in replacements for the old bodies. |

## Source integrity of the newly archived six Gateway modules

Six modules were recovered from a 2026-09-28 verified local Apps Script
project snapshot. Before publication, a bounded scan looked for literal URLs,
emails, common credential prefixes and private-key delimiters (no matches in
the six source texts), and a SHA-256 byte comparison against local checkout
was completed, with Windows Git CRLF checkout normalized back to source LF.
All six matched their local snapshot bytes. This limited static scan is **not
a substitute for an independent security audit**, especially for inherited
dependencies and runtime Script Properties. Private Drive sheets and
credentials are not being republished.

## Next source-release steps

1. Prepare a **separate consistent historical Gateway snapshot** for the
   remaining five differing cloud files, after reviewing secret literals,
   source provenance, licensing and revision-specific dependencies.
2. Identify and preserve the exact OS_A Apps Script source/deployment revision
   independently of OS_B; do not fabricate an A revision from the B tree.
3. Preserve the BAKU cloud-vs-Git seven differing files in a clearly dated,
   non-deploying archive after reviewing them.
4. Maintain independent Android release/runtime proof and avoid claiming that
   an experimental source snapshot is a complete supported build.

This report is an inventory of verified **publication coverage**. It is not a
claim that old AI services, active spreadsheets or deployments were made public
or operated end-to-end.
