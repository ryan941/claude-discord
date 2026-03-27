import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export interface SkillMatch {
  name: string;
  content: string;  // SKILL.md content
  args: string;     // remaining text after /command
}

interface SkillInfo {
  name: string;
  dir: string;      // full path to skill directory
}

// Cache: cwd → { skills, timestamp }
const skillCache = new Map<string, { skills: SkillInfo[]; names: Set<string>; ts: number }>();
const CACHE_TTL = 30_000; // 30 seconds

// Scan .claude/skills/ (project-level) and ~/.claude/skills/ (user-level)
function discoverSkills(cwd: string): SkillInfo[] {
  const cached = skillCache.get(cwd);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.skills;
  }

  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  const dirs = [
    join(cwd, ".claude", "skills"),                              // project-level
    join(process.env.HOME || "~", ".claude", "skills"),          // user-level
  ];

  for (const baseDir of dirs) {
    if (!existsSync(baseDir)) continue;

    const entries = readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue; // project-level takes priority

      const skillMd = join(baseDir, entry.name, "SKILL.md");
      if (existsSync(skillMd)) {
        seen.add(entry.name);
        skills.push({ name: entry.name, dir: join(baseDir, entry.name) });
      }
    }
  }

  // Build lowercase name set for fast lookup
  const names = new Set(skills.map((s) => s.name.toLowerCase()));
  skillCache.set(cwd, { skills, names, ts: Date.now() });

  return skills;
}

// Fast check: is this message potentially a skill command?
// Uses cached skill names — no disk I/O if cache is warm
export function isSkillCommand(message: string, cwd: string): boolean {
  if (!message.startsWith("/")) return false;

  const firstSpace = message.indexOf(" ");
  const command = firstSpace === -1
    ? message.slice(1).toLowerCase()
    : message.slice(1, firstSpace).toLowerCase();

  // Skip built-in bot commands
  if (["bind", "unbind", "projects", "skills"].includes(command)) return false;

  // Skip file paths
  if (/[\/\\.~]/.test(command)) return false;

  const cached = skillCache.get(cwd);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    // Fast path: check against cached names
    if (cached.names.has(command)) return true;
    // Check partial match
    for (const name of cached.names) {
      if (name.startsWith(command)) return true;
    }
    return false;
  }

  // Cache miss — discover will populate it
  const skills = discoverSkills(cwd);
  const lc = skills.map((s) => s.name.toLowerCase());
  return lc.includes(command) || lc.some((n) => n.startsWith(command));
}

// Warm the cache for a project — call on channel bind or bot startup
export function preloadSkills(cwd: string): string[] {
  const skills = discoverSkills(cwd);
  return skills.map((s) => s.name);
}

// Resolve a /command to a skill (reads SKILL.md)
export function resolveSkill(message: string, cwd: string): SkillMatch | null {
  if (!message.startsWith("/")) return null;

  const firstSpace = message.indexOf(" ");
  const command = firstSpace === -1
    ? message.slice(1).toLowerCase()
    : message.slice(1, firstSpace).toLowerCase();
  const args = firstSpace === -1 ? "" : message.slice(firstSpace + 1).trim();

  // Skip built-in bot commands
  if (["bind", "unbind", "projects", "skills"].includes(command)) return null;

  // Skip file paths
  if (/[\/\\.~]/.test(command)) return null;

  const skills = discoverSkills(cwd);

  // Exact match first
  let match = skills.find((s) => s.name.toLowerCase() === command);

  // Partial match (e.g., /pm matches "pm-flow" or "PM")
  if (!match) {
    match = skills.find((s) => s.name.toLowerCase().startsWith(command));
  }

  if (!match) return null;

  const skillMdPath = join(match.dir, "SKILL.md");
  const content = readFileSync(skillMdPath, "utf-8");

  return { name: match.name, content, args };
}

// Build prompt with skill instructions prepended
export function buildSkillPrompt(skill: SkillMatch, originalMessage: string): string {
  const parts = [
    `<skill name="${skill.name}">`,
    skill.content,
    `</skill>`,
    "",
    `User request: ${skill.args || originalMessage}`,
  ];
  return parts.join("\n");
}

// List available skills for a project
export function listSkills(cwd: string): string[] {
  return discoverSkills(cwd).map((s) => s.name);
}
