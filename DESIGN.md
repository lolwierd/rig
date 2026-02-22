# Rig — Design Document

## The Concept

Rig is a **dispatch console**, not a chatbot.

You're on the bus, you think of a feature, you open Rig, you dispatch it. You check back later and see what happened. The interface should feel like an **operations logbook** — you write directives, you watch work happen, you review results. It's personal infrastructure, not a SaaS product. It's YOUR workbench.

The name says it all — a rig is an apparatus, a setup, a piece of purpose-built equipment. The design should feel like well-made equipment: precise, purposeful, every part functional, nothing decorative without reason.

## The Hook

**Tool calls as first-class log entries.** Most coding agent UIs hide tool calls behind grey collapsibles or footnotes. In Rig, tool calls ARE the work. They're displayed as compact, scannable log lines:

```
15:04:22  read   src/config.ts
15:04:24  edit   src/main.ts  +12 -3
15:04:26  bash   npm install dayjs
15:04:31  write  src/utils/date.ts  (new)
```

The session isn't a conversation — it's a **work log**. You see exactly what the agent is doing, in real time, like watching a build log. The agent's prose/thinking is there too, but the tool calls give the session its rhythm and scanability.

**The Board.** The home screen isn't "pick a project, then pick a session." It's a flat, unified board of all your recent dispatches across all projects. Active ones pulse. Completed ones are calm. You see everything at a glance — like a departures board at a train station. This serves the async nature perfectly: you come to Rig to check the board, see what's done, dispatch new work.

## Typography

**Bricolage Grotesque** for headings and UI chrome. The name literally means "DIY construction" — a found-materials aesthetic that maps directly to "rig." It has optical sizing that makes it elegant at large sizes and functional at small ones. Slightly quirky, not sterile, has opinions.

**IBM Plex Mono** for everything technical — timestamps, file paths, tool call labels, code, the log entries. IBM designed this for their industrial systems. It has the precision and legibility of equipment readouts. Using it for the log entries gives them that "operations console" texture.

The hierarchy is: Bricolage for what the UI says to you, Plex Mono for what the system says to you.

## Color

**Warm charcoal + amber/copper.** Like brass fittings on dark steel.

The dark mode is the primary experience — this is used on phones at night, on the bus, in bed. Near-black background (#0c0c0e) with warm charcoal surfaces. The accent is amber (#d4a054) — not tech-blue, not startup-purple. Amber says "warm glow" and "machinery" simultaneously.

Light mode: warm linen paper (#f5f0eb) with charcoal text, like an engineer's notebook. The amber accent carries through.

Status colors are functional, not decorative:
- Running: amber pulse (the accent color, doing double duty)
- Complete: muted sage green
- Error: warm red (not alarm-bell red, more like a warning lamp)

## Layout & Information Architecture

Three views, but NOT three columns. Rig is mobile-first. The views are:

### 1. The Board (Home)
A flat list of sessions, newest first, across all projects. Each row:
- Project badge (color-coded, just the name)
- Task summary (first prompt, truncated — prioritized space)
- Status indicator (●/✓/✕)
- Relative timestamp

*Model names are hidden from the list view to maximize space for the task summary. They are revealed on hover or in the session detail view.*

Active sessions cluster at the top. A search bar filters by project or prompt text. The "New" button is prominent — dispatching work should be one tap away.

On desktop (>1024px): the board takes ~400px on the left, and the selected session opens on the right. Master-detail pattern.

On mobile: the board is full-screen. Tap → pushes to session detail.

### 2. Session Detail (The Log)
Top bar: project name, model selector, thinking level, stop button (when active).

The body is a log — not chat bubbles. The log has two kinds of entries:
- **Directives** (your prompts): displayed as plain text blocks with a subtle tinted background and a small monospace "you" label. No one-sided borders on rounded elements — that's cheap. Minimal styling — you wrote them, you know what they say.
- **Agent work**: tool calls as compact log lines (the hook), interspersed with the agent's prose rendered as markdown. Code blocks get syntax highlighting.

Bottom: input bar. On mobile, it's a slim single-line that expands on tap. On desktop, it's always visible.

A collapsible **"Files"** panel (side panel on desktop, bottom sheet on mobile) shows files touched in this session, extracted from tool call events.

### 3. New Dispatch
Not a separate screen — it's a bottom sheet (mobile) or modal (desktop). Quick compose:
- Project selector (searchable dropdown)
- Message input (auto-focus)
- Model selector (defaults to your last-used model)
- "Dispatch" button

**Model Picker Design**:
- A popover menu that feels like equipment selection.
- Searchable list of enabled models (shortcuts).
- "Show all" expands to the full registry grouped by provider.
- Two-line layout: Display Name (Bricolage) + Model ID (Mono).
- Amber selection state with checkmark.

Should take <5 seconds from open to sent. This is the core UX — make dispatching work from your phone effortless.

## What Was Rejected

**Three-column Slack layout** (projects | sessions | chat). This is what everyone does. It wastes space on mobile, forces a project-first mental model when sessions should be the primary unit, and looks like every other team messaging tool. Rig isn't a messaging tool.

**Chat bubbles.** Rounded bubbles with avatar icons and "typing..." indicators. That's for conversations between equals. The agent isn't your peer — it's your tool. A log format is more honest about the relationship and more scannable for technical work.

**Project-first navigation.** The original plan had you pick a project, then see sessions, then chat. But most of the time you want to either (a) check what's running, or (b) dispatch something new. Projects are a filter, not a navigational level. The board flattens everything.

**Blue accent color.** Every dev tool uses blue. VSCode, GitHub, Docker, Kubernetes dashboards — it's the "default developer color." Amber/copper is warmer, more industrial, more "rig."

## Tone and Texture

Rig should feel like a **well-used workshop**. Not pristine, not flashy. The kind of place where the tools are arranged just so, where everything has a purpose, where the surfaces show evidence of real work being done. Warm, competent, slightly rough around the edges in a way that says "this is for doing, not for showing off."

The log entries scrolling by should feel like ticker tape — information flowing through a machine. When a session is active, there's a subtle sense of activity — a pulse, a moving indicator — but nothing animated for animation's sake.

The transitions between views should be swift and physical. Slide transitions on mobile, not fades. Things move like they have weight.

## The Detail Nobody Will Notice

The project badges use a deterministic color derived from the project path hash — so each project always gets the same color, and you start recognizing your projects by color before you read the name. Your brain pattern-matches faster than it reads.
