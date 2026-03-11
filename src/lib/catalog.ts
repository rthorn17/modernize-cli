import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ScenarioEntry } from './types.js';

export function getFlightPlansRepoPath(): string {
  if (process.env.FLIGHTPLANS_REPO_PATH) {
    return process.env.FLIGHTPLANS_REPO_PATH;
  }
  // Default: sibling directory convention
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  return path.join(home, 'Documents', 'GitHub Repos', 'FlightPlans');
}

export function listScenarios(repoPath?: string): ScenarioEntry[] {
  const base = repoPath ?? getFlightPlansRepoPath();
  const indexPath = path.join(base, 'Scenarios', '_index.md');

  if (!fs.existsSync(indexPath)) {
    throw new Error(`Scenarios catalog not found at ${indexPath}. Set FLIGHTPLANS_REPO_PATH env var.`);
  }

  const content = fs.readFileSync(indexPath, 'utf-8').replace(/\r/g, '');
  const lines = content.split('\n');
  const scenarios: ScenarioEntry[] = [];
  let currentCategory = '';

  for (const line of lines) {
    // Detect category headings like "## 1. Framework & Runtime Upgrades"
    const headingMatch = line.match(/^##\s+(?:\d+\.\s+)?(.+)/);
    if (headingMatch) {
      currentCategory = headingMatch[1].trim();
      continue;
    }

    // Parse table rows: | name | Status | Description |
    const rowMatch = line.match(/^\|\s*\[?([^\]|]+)\]?(?:\([^)]*\))?\s*\|\s*(Active|Planned)\s*\|\s*(.+?)\s*\|$/);
    if (rowMatch) {
      const name = rowMatch[1].trim();
      const status = rowMatch[2].trim() as 'Active' | 'Planned';
      const description = rowMatch[3].trim();

      // Check if there's a link
      const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
      const link = linkMatch ? linkMatch[2] : undefined;

      scenarios.push({ name, status, description, category: currentCategory, link });
    }
  }

  return scenarios;
}

export function findScenarioPath(scenarioName: string, repoPath?: string): string | null {
  const base = repoPath ?? getFlightPlansRepoPath();
  const scenariosDir = path.join(base, 'Scenarios');

  if (!fs.existsSync(scenariosDir)) return null;

  // Search all category directories
  const categories = fs.readdirSync(scenariosDir, { withFileTypes: true });
  for (const cat of categories) {
    if (!cat.isDirectory() || cat.name.startsWith('_')) continue;
    const scenarioDir = path.join(scenariosDir, cat.name, scenarioName);
    const packageDir = path.join(scenarioDir, 'FlightPlanPackage');
    if (fs.existsSync(packageDir)) {
      return scenarioDir;
    }
  }
  return null;
}
