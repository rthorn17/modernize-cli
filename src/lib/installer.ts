import * as fs from 'node:fs';
import * as path from 'node:path';
import { parsePlan } from './plan-parser.js';
import { findScenarioPath, getFlightPlansRepoPath } from './catalog.js';
import type { InstalledPlan } from './types.js';

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function installFlightPlan(
  scenarioName: string,
  projectDir: string,
  repoPath?: string,
): { installedPath: string; plan: ReturnType<typeof parsePlan> } {
  const base = repoPath ?? getFlightPlansRepoPath();
  const scenarioDir = findScenarioPath(scenarioName, base);

  if (!scenarioDir) {
    throw new Error(`Scenario "${scenarioName}" not found in FlightPlans repository at ${base}`);
  }

  const packageDir = path.join(scenarioDir, 'FlightPlanPackage');
  const yamlPath = path.join(packageDir, 'flightplan.yaml');

  if (!fs.existsSync(yamlPath)) {
    throw new Error(`No flightplan.yaml found at ${yamlPath}`);
  }

  const plan = parsePlan(yamlPath);

  // Destination inside the target project
  const destDir = path.join(projectDir, '.github', 'modernize', 'flightplans', scenarioName);

  // Copy FlightPlanPackage contents
  copyDirRecursive(packageDir, destDir);

  // Copy Instructions.md if present
  const instructionsPath = path.join(scenarioDir, 'Instructions.md');
  if (fs.existsSync(instructionsPath)) {
    fs.copyFileSync(instructionsPath, path.join(destDir, 'Instructions.md'));
  }

  // Resolve shared assets from flightplan.yaml resolution section
  if (plan.resolution) {
    const scenariosRoot = path.join(base, 'Scenarios');
    const sharedRoot = path.join(base, 'Shared');

    // Copy shared skills referenced by the plan
    for (const skill of plan.skills) {
      if (skill.location === 'shared') {
        const sharedSkillDir = path.join(sharedRoot, 'Skills', skill.id);
        if (fs.existsSync(sharedSkillDir)) {
          const destSkillDir = path.join(destDir, 'Skills', skill.id);
          copyDirRecursive(sharedSkillDir, destSkillDir);
        }
      }
    }

    // Copy shared templates
    const sharedTemplatesDir = path.join(sharedRoot, 'Templates');
    if (fs.existsSync(sharedTemplatesDir)) {
      const destTemplatesDir = path.join(destDir, 'Templates');
      fs.mkdirSync(destTemplatesDir, { recursive: true });
      const templates = fs.readdirSync(sharedTemplatesDir, { withFileTypes: true });
      for (const t of templates) {
        if (t.isFile()) {
          const src = path.join(sharedTemplatesDir, t.name);
          const dest = path.join(destTemplatesDir, t.name);
          if (!fs.existsSync(dest)) {
            fs.copyFileSync(src, dest);
          }
        }
      }
    }
  }

  // Write install metadata
  const metadata: InstalledPlan = {
    scenario: plan.scenario,
    version: plan.version,
    installedAt: new Date().toISOString(),
    source: packageDir,
  };
  fs.writeFileSync(
    path.join(destDir, '.install-metadata.json'),
    JSON.stringify(metadata, null, 2),
  );

  return { installedPath: destDir, plan };
}
