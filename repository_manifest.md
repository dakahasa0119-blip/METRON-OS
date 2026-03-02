# METRON Repository Manifest

This manifest lists the essential source files for the METRON project, organized by module. Jules and IDEA should use this as a guide for codebase ingestion.

## 1. METRON_GATEWAY (The Interface Layer)
*Path: `/home/dakahasa0119/ARC_METRON/modules/gas/METRON_GATEWAY/`*

| File Name | Description |
| :--- | :--- |
| `ARC_Gateway_doPost.js` | Core logic for handling incoming POST requests, routing, and job enqueuing. |
| `gateway.html` | The main Progressive Web App (PWA) interface for METRON. |
| `Gateway_UI_Server.js` | Backend functions for the Gateway UI (e.g., loading/saving profiles). |
| `code.js` | Main entry point (`doGet`) and UI routing. |
| `THE_CORE.js` | Core utility functions and system constants. |
| `OPS_DEFAULTS.js` | Default operations and configuration settings. |
| `System_Evolver.js` | Bridge for triggering system-level updates. |

## 2. BAKU (The Universal Salvage & DNA Vault)
*Path: `/home/dakahasa0119/ARC_METRON/modules/gas/BAKU/`*

| File Name | Description |
| :--- | :--- |
| `BAKU_SalvageEngine.js` | Logic for salvaging failed tasks and extracting knowledge. |
| `BAKU_Dashboard.html` | UI for monitoring salvage and evolution status. |
| `METRON_EVO.js` | Core engine for self-rebuilding and system evolution. |
| `BAKU_GATEWAY_BRIDGE.js` | Integration layer between BAKU and the Gateway. |
| `METRON_DNA_ANALYST.js` | Analyzes code "DNA" extracted from the codebase. |
| `METRON_AutoPatrol.js` | Automated system health monitoring and self-repair. |

## 3. METRON_OS_B (MotherShip / Core Brain)
*Path: `/home/dakahasa0119/ARC_METRON/modules/gas/METRON_OS_B/`*

| File Name | Description |
| :--- | :--- |
| `Core_AI.js` | Advanced AI processing logic and orchestration. |
| `Core_Evolution_Engine.js` | Manages the internal state of system evolution. |
| `Analyst_Eye.js` | High-level system analysis and reporting tools. |
| `AppForge.js` | Logic for generating and modifying new applications. |
| `MotherShip_Admin.html` | Administrator dashboard for system-wide control. |
| `Communication_Manager.js` | Manages cross-module messaging and synchronization. |

## 4. Other Related Paths
- **ARC (Android/Core)**: `/home/dakahasa0119/ARC/` - Kotlin-based core application.
- **Nursing Context**: `/home/dakahasa0119/ARC_NURSING/` - Specific domain data and context.

---
**Prepared for Jules (Gemini) and IDEA (ChatGPT/IDEA).**
