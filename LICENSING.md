# METRON licensing and reuse / 二次利用ライセンス

**Effective release policy (2026-10-14):** The original METRON project
copyright holder authorized broad reuse of METRON OS, Gateway, BAKU, ARC,
and the public first-party archive. The Apache License, Version 2.0 applies
to the **first-party materials listed below**. This is an open-source grant,
including commercial use, modification, redistribution and closed-source
derivatives, subject to the actual Apache 2.0 terms.

## Exact license map

| Location | License | What is included |
| --- | --- | --- |
| `modules/gas/METRON_OS_B/` | **Apache-2.0** | Original first-party MotherShip/OS_B GAS, HTML and source-level archive |
| `modules/gas/METRON_GATEWAY/`, `gateway/` | **Apache-2.0** | Original first-party Gateway GAS and related application source |
| `modules/gas/BAKU/` | **Apache-2.0** | Original first-party BAKU GAS/UI/source |
| `app/` | **Apache-2.0** for first-party source | Android ARC application, source and original resources |
| `archive/gas/METRON_GATEWAY/` | **Apache-2.0** | Preserved first-party historical Gateway cloud source, not a certified deployment |
| Other project-authored `modules/`, `scripts/`, `docs/`, root project source/build configuration and project documentation | **Apache-2.0** | Original project work unless individually identified otherwise |
| `mini/` | **Apache-2.0** | Standalone locally runnable four-component METRON Mini dashboard/runtime; it imports separately MIT-licensed helpers from `reusable/` |
| `reusable/`, including its four published module packages | **MIT** | Independent portable reference implementations. Each package carries its own MIT LICENSE |
| Externally authored or third-party files and dependencies | **Their respective original license** | Not relicensed merely by being present in this repository |

The root [LICENSE](LICENSE) contains the unmodified Apache 2.0 text.
The root [NOTICE](NOTICE) records original project attribution. For someone
redistributing an Apache-2.0-covered component, include the license and
relevant notices, and mark changed source files as required by section 4.
The MIT packages retain their own attribution and license notices.

## Explicit third-party and non-source exclusions

The following are **not** being relicensed by the project owner:

- `localization-ja.jar`: bundled JetBrains IDE localization/resources artifact;
  original rights and redistribution permissions require separate verification.
- `gradle/wrapper/gradle-wrapper.jar`, Gradle wrapper scripts and any
  upstream-owned tooling: retain their upstream terms; their inclusion does
  not imply METRON owns the Gradle code.
- Android SDKs, AndroidX, Material Design components, OkHttp, Kotlin tooling,
  Gradle distributions, and other external dependencies fetched via the build:
  remain under each upstream supplier's terms, not METRON's Apache grant.
- External AI-service branding, provider interfaces, third-party snippets,
  assets, or other independently owned works, if any are discovered.
- `emulator*.log`, local diagnostics, deployed script/project identifiers,
  credentials, operational messages and other environment-specific runtime
  information: publication or copyright licensing does **not** grant access
  to systems or permission to reveal third-party/private information.

No blanket relicensing claim applies to these items. When combining METRON
with an external dependency, the downstream distributor must honor that
dependency's own license and required notices. **A public GitHub repository
does not make third-party material public domain.**

## Credit / 名前の表示

Suggested attribution (not an additional requirement beyond the licenses):

> Based on METRON OS / Gateway / BAKU / ARC
> Original project: dakahasa0119-blip
> https://github.com/dakahasa0119-blip/METRON-OS

The actual Apache 2.0 redistribution conditions include retaining the
license, required attribution/NOTICE, and marking modified files. There is
**no extra requirement** to place a METRON logo on an application's splash
screen, expose a proprietary application's source code, or obtain approval
before commercial use. The Apache 2.0 trademark provision does not grant
rights to imply that an independently developed product is an official
METRON release or has the original author's endorsement.

## What this does *not* guarantee

This permission concerns **copyrightable code the original contributor owns**.
It does not resolve rights in third-party material, private data, platform
accounts, signed binaries, trademarks or software patents beyond Apache 2.0's
express terms. The old GAS and Android projects are experimental snapshots;
their full integration, production safety and live deployments are not
certified by this license.

This document is explanatory; the legal license texts, not this guide,
control the grant.
