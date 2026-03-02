# METRON Handover Brief for AI Agents (Jules & IDEA)

## 1. Project Overview: What is METRON?
METRON is an **Asynchronous, Stateless, Self-Rebuilding AI Operating System** built primarily on Google Apps Script (GAS). It is designed to act as a "living" intelligence layer that manages its own evolution, salvages failed tasks, and adapts to user contexts without hardcoded specialized terminology.

### Core Architecture & Terminology:
- **Village Square (Google Drive/Dropbox)**: The communication layer where Rumor JSONs and DNA are exchanged.
- **PROXY-HAND (ARC)**: The external interface layer (Android app/extension). It acts as the "hands and feet" to operate external AI (ChatGPT, Claude, Gemini). It must remain **stateless**.
- **Stateless & Async**: No blocking waits. Communication is handled via task queues (`ARC_JOBS`) and polling to avoid GAS execution timeouts.
- **DNA-Driven Evolution**: Source code is treated as "DNA" stored in Google Drive. METRON extracts, analyzes, and reinjects this DNA into itself to evolve.
- **Universal Salvage**: Failed jobs (Dead Jobs) are not lost; the `BAKU` module (Salvager) collects fragments to prevent loss of context.

## 2. Component Architecture

### [METRON_GATEWAY] (The Interface & Router)
- **Role**: Entry point for Android apps and external requests.
- **Functions**: Handles MainChat, manages AI Slots (Gemini, Claude, GPT), and manages "Memory" (RAG/caching).
- **Recent Update**: Integrated a **User-Centric Profiling** system in the Settings tab, allowing users to define their Identity, Purpose, and Situation to guide AI proposals.

### [BAKU] (The Universal Salvage & DNA Vault)
- **Role**: Background worker for system maintenance and knowledge extraction.
- **Functions**: Salvages `ARC_JOBS` errors, maintains the "DNA Vault" (library of code assets from Google Drive), and monitors system health.

### [METRON_OS_B / MotherShip] (The Brain & Evolver)
- **Role**: Central processing and evolution hub.
- **Functions**: Processes specialized `enqueueArcJob` requests, coordinates between modules, and hosts the **Evolution Engine** (`METRON_EVO`) for self-rebuilding.

## 3. Current Status & Phase Information
- **Completed**: Phase 9 (Flexible User Profiling & Adaptive Context Injection).
- **In-Progress/Next Up**: 
    - Full-scale **Evolution Dashboard** and self-rebuild triggers in BAKU.
    - Deep integration with **Jules** for automated code base analysis and logic optimization.
    - Enhancing the **Strategic AI** layer to make proactive suggestions based on user profiles.

## 4. Key Data & Memory Structures
- **Task Queue**: `ARC_JOBS` spreadsheet (ID, prompt, result, status, target).
- **Profile Storage**: `PropertiesService` (`ARC_GATEWAY_PROFILE_JSON`).
- **DNA Storage**: Google Drive folders mapped during salvage operations.

## 5. Strategic Direction for Jules/IDEA
1.  **Autonomous Improvement**: Leverage Jules's ability to learn the entire codebase to identify redundant logic in the transition from synchronous to asynchronous patterns.
2.  **DNA Extraction**: Use the DNA Vault to create a high-precision library of reusable functions that METRON can "inject" into new project clones.
3.  **Proactive Assistance**: Shift the AI from a "responder" to a "partner" that uses the User Profile to anticipate needs.

---
**Handover prepared by Antigravity (Advanced Agentic AI).**
*Reference the Repository Manifest for full file list.*
