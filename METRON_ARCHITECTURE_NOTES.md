# METRON Architecture Notes

## Overview
- **METRON**: The overall decentralized AI civilization architecture.
- **Mothership Core (METRON_OS_B, etc.)**: The computation layer. Generates apps, runs logic, holds user-specific context.
- **Village Square (Google Drive/Dropbox)**: The communication layer where Rumor JSONs are exchanged.
- **Gateway (Civilization Map / Memory)**: The index server. Distributes tasks, provides maps, and holds long-term memory (the civilization's "soul").
- **PROXY-HAND (ARC)**: The external interface layer (Android app/extension). Acts as the "hands and feet" to operate external AI (ChatGPT, Claude, Gemini).
- **BAKU**: The salvage/backup intelligence. Collects fragments of failed systems or logs to prevent loss of context and history.

## Key Design Principles
1. **ARC (PROXY-HAND)**:
   - Must be stateless. It maintains no memory or context of its own to prevent pollution and bias.
   - It executes queries against external AIs and returns the raw results.
   - **Important Deviation**: While the original PROXY-HAND philosophy calls for "Logged-Out Access" to prevent identity sharing, practical limitations (browser restrictions, difficulty retrieving answers) necessitate **Logged-In Access** for ARC.

2. **Gateway**:
   - Handles the routing of jobs (Tasks) to ARC.
   - Receives results from ARC.
   - Consolidates memory and provides the context required for the next actions.

3. **Mothership (METRON_OS_B)**:
   - Receives processed data/decisions from Gateway.
   - Executes self-rewriting, local LLM evaluation (if applicable), and builds out applications.

## Current State
- The `main` branch is actively refactoring ARC and Gateway to align with this stateless, asynchronous, pull-based queue architecture.
- A new module, `METRON_OS_B`, has been added to act as a Mothership Core.
