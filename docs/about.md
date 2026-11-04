# About Mantis

**Mantis is a maintenance knowledge workspace from CoraLabs.** It helps engineers find answers in equipment manuals and trace those answers back to the original page.

Machines fail, experienced engineers move on, and useful knowledge gets scattered across documentation. Mantis starts with a practical part of that problem: making the right equipment manual easier to use at the point of work.

## The workflow

Upload a manual, identify the equipment, and ask a specific troubleshooting question. Mantis searches only the selected manual, generates an answer from retrieved passages, and lets the engineer inspect those passages or open the PDF at the cited page.

The engineer remains responsible for checking the actual manual and following approved site procedures. Mantis does not operate equipment or certify a repair.

## What works today

- Text-based PDF upload, indexing, and a persistent manual library.
- Questions scoped to one equipment manual, with a retrieval cutoff for weak matches.
- Answers with validated source identifiers, page numbers, and inspectable excerpts.
- Browser-scoped workspaces, duplicate detection, and document/index deletion.
- A scripted, chat-first product demo with a prepared alarm-screen illustration and browser-local photo previews; a separate workspace demo returns illustrative training excerpts. Personal photos are not analyzed.

The application is a local pilot. Software regression tests cover its API and storage behavior; retrieval quality and answer correctness have not yet been evaluated on a representative set of industrial manuals.

## Research and next steps

The original notebooks explore Whisper transcription and Grounding DINO object detection. These are research artifacts, not integrated voice or visual-assistance features.

The next product steps are representative retrieval evaluation, authenticated team workspaces, and a deliberate shared-deployment design. Speech and vision can then build on a reliable manual-to-answer workflow.

## Project background

Mantis began as an exploratory PDF question-answering prototype and grew into a browser-based maintenance workspace. Its visual identity follows the original CoraLabs project presentation: the original Mantis mark and orange accents, adapted to charcoal surfaces and a readable Inter/JetBrains Mono interface.

The project presentation credits **Petar Bošković**, **Stefan Veličković**, and **Željko Antonijević** as the CoraLabs team.

[Back to the project](../README.md) · [Architecture](architecture.md) · [Verification](verification.md)
