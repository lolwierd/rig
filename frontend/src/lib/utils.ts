/**
 * Generate a deterministic color from a string (project name).
 * Each project always gets the same color badge.
 */

const PROJECT_COLORS = [
  { bg: "bg-amber-dim", text: "text-amber" },
  { bg: "bg-green-dim", text: "text-green" },
  { bg: "bg-blue-dim", text: "text-blue" },
  { bg: "bg-violet-dim", text: "text-violet" },
  { bg: "bg-red-dim", text: "text-red" },
] as const;

// Amber/green/blue/violet/red as raw hex for inline styles
const PROJECT_COLORS_RAW = [
  { bg: "rgba(212, 160, 84, 0.1)", text: "#d4a054" },
  { bg: "rgba(127, 186, 106, 0.1)", text: "#7fba6a" },
  { bg: "rgba(106, 159, 212, 0.1)", text: "#6a9fd4" },
  { bg: "rgba(154, 133, 196, 0.1)", text: "#9a85c4" },
  { bg: "rgba(201, 112, 100, 0.1)", text: "#c97064" },
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getProjectColor(name: string) {
  const idx = hashString(name) % PROJECT_COLORS_RAW.length;
  return PROJECT_COLORS_RAW[idx];
}

export function getProjectColorClasses(name: string) {
  const idx = hashString(name) % PROJECT_COLORS.length;
  return PROJECT_COLORS[idx];
}

/** Get the tool color class */
export function getToolColor(tool: string): string {
  switch (tool) {
    case "read":
      return "text-blue";
    case "edit":
      return "text-amber";
    case "write":
      return "text-green";
    case "bash":
      return "text-violet";
    case "grep":
    case "find":
    case "ls":
      return "text-text-dim";
    default:
      return "text-text-dim";
  }
}

/** Truncate path to last N segments */
export function truncatePath(path: string, maxSegments = 3): string {
  const segments = path.split("/");
  if (segments.length <= maxSegments) return path;
  return "…/" + segments.slice(-maxSegments).join("/");
}
