import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FlightPlan, Gate, GateResult } from './types.js';

type GateCategory = 'entry' | 'output_integrity' | 'risk' | 'exit';

export function evaluateGates(
  plan: FlightPlan,
  projectDir: string,
  categories?: GateCategory[],
): GateResult[] {
  const results: GateResult[] = [];
  const toCheck = categories ?? (['entry', 'output_integrity', 'risk', 'exit'] as const);

  for (const category of toCheck) {
    const gates = plan.gates[category] ?? [];
    for (const gate of gates) {
      results.push(evaluateGate(gate, category, plan, projectDir));
    }
  }

  return results;
}

function evaluateGate(
  gate: Gate,
  category: string,
  plan: FlightPlan,
  projectDir: string,
): GateResult {
  const { condition } = gate;

  // artifact_exists("path") checks
  const artifactMatch = condition.match(/artifact_exists\("([^"]+)"\)\s*==\s*true/);
  if (artifactMatch) {
    const filePath = path.join(projectDir, artifactMatch[1]);
    const exists = fs.existsSync(filePath);
    return {
      name: gate.name,
      category,
      condition,
      description: gate.description,
      passed: exists,
      reason: exists ? 'File found' : `File not found: ${artifactMatch[1]}`,
    };
  }

  // repository_type checks
  const repoTypeMatch = condition.match(/repository_type\s*==\s*"(\w+)"/);
  if (repoTypeMatch) {
    const expected = repoTypeMatch[1];
    const passed = checkRepositoryType(projectDir, expected);
    return {
      name: gate.name,
      category,
      condition,
      description: gate.description,
      passed,
      reason: passed ? `Project is ${expected}` : `Project does not appear to be ${expected}`,
    };
  }

  // source_framework checks
  const frameworkMatch = condition.match(/source_framework\s+in\s+\[([^\]]+)\]/);
  if (frameworkMatch) {
    // For POC, assume it passes if project files exist
    return {
      name: gate.name,
      category,
      condition,
      description: gate.description,
      passed: false,
      reason: 'Framework detection not yet implemented (POC)',
    };
  }

  // build_status checks
  if (condition.includes('build_status')) {
    return {
      name: gate.name,
      category,
      condition,
      description: gate.description,
      passed: false,
      reason: 'Build status check requires running build (use --run-build)',
    };
  }

  // Numeric comparison checks (test_pass_rate, code_coverage, etc.)
  const numericMatch = condition.match(/(\w+)\s*(>=|<=|==|>|<)\s*([\d.]+)/);
  if (numericMatch) {
    return {
      name: gate.name,
      category,
      condition,
      description: gate.description,
      passed: false,
      reason: `Metric "${numericMatch[1]}" requires runtime evaluation`,
    };
  }

  // Boolean condition checks
  if (condition.includes('== true') || condition.includes('== false')) {
    return {
      name: gate.name,
      category,
      condition,
      description: gate.description,
      passed: false,
      reason: 'Condition requires runtime evaluation',
    };
  }

  // Default: cannot evaluate
  return {
    name: gate.name,
    category,
    condition,
    description: gate.description,
    passed: false,
    reason: 'Condition not evaluable in static analysis',
  };
}

function checkRepositoryType(projectDir: string, expected: string): boolean {
  switch (expected) {
    case 'dotnet': {
      // Look for .csproj, .sln, .fsproj files
      return findFileWithExtension(projectDir, ['.csproj', '.sln', '.fsproj']);
    }
    case 'java': {
      return findFileWithExtension(projectDir, ['pom.xml', 'build.gradle', 'build.gradle.kts']);
    }
    case 'monolith': {
      // Heuristic: single large project = monolith
      return true;
    }
    default:
      return false;
  }
}

function findFileWithExtension(dir: string, extensions: string[]): boolean {
  if (!fs.existsSync(dir)) return false;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        for (const ext of extensions) {
          if (entry.name.endsWith(ext) || entry.name === ext) return true;
        }
      }
      // Check one level deep
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        const subEntries = fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isFile()) {
            for (const ext of extensions) {
              if (sub.name.endsWith(ext) || sub.name === ext) return true;
            }
          }
        }
      }
    }
  } catch {
    // ignore read errors
  }
  return false;
}
