/**
 * Maps note types to their accent color CSS variables.
 * Single source of truth for type→color mapping used across Sidebar, NoteList, and Inspector.
 */

const TYPE_COLOR_MAP: Record<string, string> = {
  Project: 'var(--accent-red)',
  Experiment: 'var(--accent-red)',
  Responsibility: 'var(--accent-purple)',
  Procedure: 'var(--accent-purple)',
  Person: 'var(--accent-yellow)',
  Event: 'var(--accent-yellow)',
  Topic: 'var(--accent-green)',
  Type: 'var(--accent-blue)',
}

const TYPE_LIGHT_COLOR_MAP: Record<string, string> = {
  Project: 'var(--accent-red-light)',
  Experiment: 'var(--accent-red-light)',
  Responsibility: 'var(--accent-purple-light)',
  Procedure: 'var(--accent-purple-light)',
  Person: 'var(--accent-yellow-light)',
  Event: 'var(--accent-yellow-light)',
  Topic: 'var(--accent-green-light)',
  Type: 'var(--accent-blue-light)',
}

const DEFAULT_COLOR = 'var(--accent-blue)'
const DEFAULT_LIGHT_COLOR = 'var(--accent-blue-light)'

/** Returns the CSS variable for the accent color of a given note type */
export function getTypeColor(isA: string | null): string {
  return (isA && TYPE_COLOR_MAP[isA]) ?? DEFAULT_COLOR
}

/** Returns the CSS variable for the light/background variant of a given note type's color */
export function getTypeLightColor(isA: string | null): string {
  return (isA && TYPE_LIGHT_COLOR_MAP[isA]) ?? DEFAULT_LIGHT_COLOR
}
