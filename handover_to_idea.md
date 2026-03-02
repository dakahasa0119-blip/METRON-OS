# METRON Technical Brief for IDEA (ChatGPT)

## 🎯 Project Identity
METRON is a decentralized, self-evolving AI Operating System. It is NOT a static set of scripts, but a **civilization logic** that lives on Google Apps Script (GAS) and communicates through asynchronous "Rumors" (JSON) and task queues.

## 🏗️ Architectural Core Patterns
To assist METRON effectively, you must adhere to these rules:
1.  **Stateless Execution**: Modules (especially ARC/Proxy-Hand) must not store local state. They rely on the "Village Square" (Spreadsheets/Drive) for continuity.
2.  **Asynchronous & Event-Driven**: GAS has strict execution limits. METRON avoids synchronous `wait()`. It uses polling and chained triggers to handle long-running tasks across multiple modules.
3.  **Source Code as DNA**: Code is treated as a salvagable asset. `BAKU` extracts functional units (DNA) into a Vault, allowing `METRON_EVO` to rebuild or patch the OS dynamically.

## 📂 Module Responsibilities
- **METRON_GATEWAY**: 
    - The "Civilization Map".
    - Manages `ARC_JOBS` (The Task Queue).
    - **Current Focus**: User profiling (Personalization) to inject adaptive context into every AI prompt.
- **BAKU**:
    - The "Salvager".
    - Recovers Dead Jobs and extracts code DNA.
    - Monitors system health/safety.
- **METRON_OS_B (MotherShip)**:
    - The "Brain".
    - Coordinates advanced AI logic (Core_AI).
    - Hosts the Evolution Engine for self-rebuilding.

## 4. Synchronization & Deployment Workflow
- **原本 (Source of Truth)**: **GitHub Repository / Local Filesystem**. Development happens here first.
- **Sync to GAS**: All changes MUST be pushed to the Google Apps Script environment via **`clasp push`**.
- **Agent Roles**:
    - **IDEA/Jules**: Strategic design and code generation.
    - **Antigravity**: Handles the "physical" side—deployment (`clasp push`), terminal execution, and log monitoring.

## 🚀 Current Milestone: Phase 9 (Completed)
We have successfully implemented **User-Centric Profiling**. AI prompts are now automatically personalized based on:
1.  **Identity**: Who is the user?
2.  **Purpose**: What is their main mission?
3.  **Situation**: What are the current environmental constraints?

## 🛠️ Your Mission (Next Steps for IDEA)
1.  **Logic Optimization**: Inspect the large `ARC_Gateway_doPost.js` and `METRON_EVO.js` for redundant logic leftover from the synchronous-to-asynchronous transition.
2.  **Strategic Proactivity**: Help design a "Strategic AI" layer that doesn't just wait for prompts but analyzes the User Profile to proactively suggest "the next action".
3.  **DNA Refinement**: Help `BAKU` better categorize extracted code fragments by their "social safety" and "utility" scores.

---
**The entire 78-file codebase is now synchronized in the GAS Editor and GitHub.**
*Consult the [Exhaustive Repository Manifest](file:///home/dakahasa0119/.gemini/antigravity/brain/67fd66ae-f1ad-4bd8-bef5-fa14ce643267/repository_manifest.md) for the full file list.*
