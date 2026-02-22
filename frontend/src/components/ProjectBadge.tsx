import { getProjectColor } from "../lib/utils";

interface ProjectBadgeProps {
  name: string;
  className?: string;
}

export function ProjectBadge({ name, className = "" }: ProjectBadgeProps) {
  const color = getProjectColor(name);

  return (
    <span
      className={`font-mono text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded whitespace-nowrap ${className}`}
      style={{ background: color.bg, color: color.text }}
    >
      {name}
    </span>
  );
}
