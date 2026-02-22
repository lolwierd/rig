# Rig Architecture Design Rationale

## The Concept
**The Harbor Master's Logbook.**

Rig is a dispatch console. It coordinates asynchronous arrivals and departures of operations, bridging a web interface to a raw CLI binary via standard IO pipes. It's essentially an industrial switchboard. 

I discarded the "Phosphor/Hacker Terminal" aesthetic from the previous iteration. "Hacker green" is the generic default for any backend CLI project, and it feels cheap and cliché. Rig is personal infrastructure; it should feel mature, reliable, and tactile—like a well-used ledger or a printed technical manual from the 1970s.

## The Hook
**Marginalia.** 
Instead of burying the limitations and Architectural Decision Records (ADRs) at the bottom of the page or in generic sub-cards, the entire layout is an asymmetric, border-heavy grid. The right column acts as marginalia, where critical limitations and annotations sit exactly adjacent to the systems they describe. This provides density with clarity—you read the system flow on the left, and the warnings on the right.

## Typography Rationale
- **Structural / Narrative:** `IBM Plex Serif`. Using a serif for a technical architecture document is an unexpected choice, but it brings immediate gravity and editorial warmth. It frames the document as a "manual" rather than a "dashboard."
- **Data / Machinery:** `IBM Plex Mono`. This contrasts sharply with the serif. Whenever we talk about the raw machinery (files, routes, process IDs, code blocks), it switches to monospace. The type system enforces the difference between the intent and the implementation.
- **Micro-labels:** `Inter` in all-caps is used sparingly just for tiny utilitarian tags to avoid serif fatigue at small sizes.

## Color Rationale
**Industrial Rust & Charcoal.**
- Dark mode is not pure black; it's a very deep, warm charcoal (`#1c1b1a`), reminiscent of aged machinery or dark slate. 
- Light mode is a faded newsprint/cream (`#f5f3ef`).
- The primary accent is a Terracotta/Rust (`#c35a39`). It provides emphasis without the aggressive "error" screaming of a pure red, feeling more like red ink stamped on a ledger.
- A secondary Oxidized Slate (`#5b7b7a`) acts as a quiet accent for structural borders and diagrams.

## Layout / Structure Rationale
- **Border-driven Architecture:** The layout relies heavily on 1px solid borders (`var(--border)`) to delineate space, mimicking printed tables and ledgers. Elements don't float in space; they are rigidly boxed.
- **Progressive Narrative:** The document flows top to bottom chronologically through the stack, from the React SPA down to the raw `subprocess` boundary, explicitly mapping the event buffer handlers and promise resolutions.

## What Was Rejected
- **The "Glowing Hacker Interface"**: Rejected because it's the dominant, thoughtless trend for any tool remotely touching the terminal. 
- **Mermaid Default Styling**: The default Mermaid styling is far too soft and rounded, which breaks the rigid, editorial ledger feel. I heavily customized the Mermaid init variables to force sharp lines, transparent backgrounds, and IBM Plex Mono fonts to make the diagrams feel like they were drafted directly onto the page.

## Tone and Texture
The tone is serious, grounded, and slightly uncompromising. It doesn't try to look like a modern SaaS product. It looks like a document you would find bound in a binder in a control room.
