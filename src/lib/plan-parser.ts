import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { FlightPlan } from './types.js';

export function parsePlan(yamlPath: string): FlightPlan {
  const raw = fs.readFileSync(yamlPath, 'utf-8');
  const doc = yaml.load(raw) as Record<string, unknown>;

  return {
    scenario: (doc.scenario as string) ?? '',
    version: String(doc.version ?? ''),
    intent: (doc.intent as string) ?? '',
    parameters: (doc.parameters as Record<string, string>) ?? {},
    execution_modes: doc.execution_modes as FlightPlan['execution_modes'],
    resolution: doc.resolution as FlightPlan['resolution'],
    skills: (doc.skills as FlightPlan['skills']) ?? [],
    gates: normalizeGates(doc.gates as Record<string, unknown[]>),
    required_artifacts: (doc.required_artifacts as FlightPlan['required_artifacts']) ?? [],
    human_controls: (doc.human_controls as FlightPlan['human_controls']) ?? [],
  };
}

function normalizeGates(raw: Record<string, unknown[]> | undefined): FlightPlan['gates'] {
  if (!raw) return { entry: [], output_integrity: [], risk: [], exit: [] };
  return {
    entry: (raw.entry ?? []) as FlightPlan['gates']['entry'],
    output_integrity: (raw.output_integrity ?? []) as FlightPlan['gates']['output_integrity'],
    risk: (raw.risk ?? []) as FlightPlan['gates']['risk'],
    exit: (raw.exit ?? []) as FlightPlan['gates']['exit'],
  };
}

export function findInstalledPlan(projectDir: string): string | null {
  const fpDir = path.join(projectDir, '.github', 'modernize', 'flightplans');
  if (!fs.existsSync(fpDir)) return null;
  const entries = fs.readdirSync(fpDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const yamlPath = path.join(fpDir, entry.name, 'flightplan.yaml');
      if (fs.existsSync(yamlPath)) return yamlPath;
    }
  }
  return null;
}
