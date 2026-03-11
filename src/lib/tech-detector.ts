import * as fs from 'node:fs';
import * as path from 'node:path';
import { listScenarios, findScenarioPath, getFlightPlansRepoPath } from './catalog.js';
import { parsePlan } from './plan-parser.js';
import type {
  TechStackDetection,
  DetectionEvidence,
  ScenarioMatch,
  FlightPlan,
} from './types.js';

// ---------------------------------------------------------------------------
// Project Tech Stack Detection
// ---------------------------------------------------------------------------

/**
 * Detect all technology stacks present in a project directory.
 * Returns an array because a project can have multiple tech layers
 * (e.g., a .NET backend with a Node.js frontend).
 */
export function detectTechStack(projectDir: string): TechStackDetection[] {
  const absDir = path.resolve(projectDir);
  const detections: TechStackDetection[] = [];

  const detectors = [
    detectDotNet,
    detectJava,
    detectNodeJs,
    detectPython,
    detectVB6,
    detectCobol,
  ];

  for (const detector of detectors) {
    const result = detector(absDir);
    if (result) {
      detections.push(result);
    }
  }

  return detections;
}

// ---------------------------------------------------------------------------
// Scenario Matching
// ---------------------------------------------------------------------------

interface ScenarioExpectation {
  repositoryType: string | null;
  sourceFramework: string | null;
  sourceVersion: string | null;
  buildSystem: string | null;
  sourceLanguage: string | null;
  versionRange: string[] | null;
}

/**
 * Match detected tech stacks against all active flight plan scenarios.
 * Returns matches sorted by confidence (high first) then alphabetically.
 */
export function matchScenarios(
  detections: TechStackDetection[],
  repoPath?: string,
): ScenarioMatch[] {
  const base = repoPath ?? getFlightPlansRepoPath();
  const allScenarios = listScenarios(base);
  const activeScenarios = allScenarios.filter(s => s.status === 'Active');
  const matches: ScenarioMatch[] = [];

  for (const scenario of activeScenarios) {
    // Skip meta scenarios like create-a-flight-plan
    if (scenario.name === 'create-a-flight-plan') continue;

    const scenarioDir = findScenarioPath(scenario.name, base);
    if (!scenarioDir) continue;

    const yamlPath = path.join(scenarioDir, 'FlightPlanPackage', 'flightplan.yaml');
    if (!fs.existsSync(yamlPath)) continue;

    let plan: FlightPlan;
    try {
      plan = parsePlan(yamlPath);
    } catch {
      continue;
    }

    const expectations = extractExpectations(plan);

    for (const detection of detections) {
      const result = computeConfidence(detection, expectations, plan, scenario.name);
      if (result) {
        matches.push({
          scenario,
          plan,
          confidence: result.confidence,
          matchReason: result.reason,
          matchedProperties: result.matchedProps,
        });
      }
    }

    // Check cross-cutting scenarios that don't depend on a specific detection
    const crossMatch = checkCrossCutting(scenario.name, plan, detections);
    if (crossMatch && !matches.some(m => m.scenario.name === scenario.name)) {
      matches.push({
        scenario,
        plan,
        confidence: crossMatch.confidence,
        matchReason: crossMatch.reason,
        matchedProperties: crossMatch.matchedProps,
      });
    }
  }

  // Deduplicate by scenario name (keep highest confidence)
  const seen = new Map<string, ScenarioMatch>();
  for (const m of matches) {
    const existing = seen.get(m.scenario.name);
    if (!existing || confidenceRank(m.confidence) > confidenceRank(existing.confidence)) {
      seen.set(m.scenario.name, m);
    }
  }

  // Sort: high → medium → low, then alphabetical
  return Array.from(seen.values()).sort((a, b) => {
    const rankDiff = confidenceRank(b.confidence) - confidenceRank(a.confidence);
    if (rankDiff !== 0) return rankDiff;
    return a.scenario.name.localeCompare(b.scenario.name);
  });
}

function confidenceRank(c: 'high' | 'medium' | 'low'): number {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Expectation Extraction
// ---------------------------------------------------------------------------

function extractExpectations(plan: FlightPlan): ScenarioExpectation {
  const params = plan.parameters ?? {};

  // Extract repository_type from entry gates
  let repositoryType: string | null = null;
  for (const gate of plan.gates.entry ?? []) {
    const repoMatch = gate.condition.match(/repository_type\s*==\s*"(\w+)"/);
    if (repoMatch) {
      repositoryType = repoMatch[1];
      break;
    }
  }

  // Extract source version from various parameter keys
  const sourceFramework = params.source_framework ?? null;
  const sourceVersion = params.source_jdk ?? params.source_python_version ?? params.source_node_version ?? null;
  const buildSystem = params.build_system ?? params.source_build_system ?? null;
  const sourceLanguage = params.source_language ?? null;

  // Extract version range from entry gates (e.g., source_framework in ["net6.0", "net7.0"])
  let versionRange: string[] | null = null;
  for (const gate of plan.gates.entry ?? []) {
    const rangeMatch = gate.condition.match(/source_framework\s+in\s+\[([^\]]+)\]/);
    if (rangeMatch) {
      versionRange = rangeMatch[1]
        .split(',')
        .map(s => s.trim().replace(/"/g, ''));
      break;
    }
  }

  return { repositoryType, sourceFramework, sourceVersion, buildSystem, sourceLanguage, versionRange };
}

// ---------------------------------------------------------------------------
// Confidence Computation
// ---------------------------------------------------------------------------

function computeConfidence(
  detection: TechStackDetection,
  expectations: ScenarioExpectation,
  plan: FlightPlan,
  scenarioName: string,
): { confidence: 'high' | 'medium' | 'low'; reason: string; matchedProps: string[] } | null {
  // If scenario expects a specific repository type and it doesn't match, skip
  if (expectations.repositoryType && detection.repositoryType !== expectations.repositoryType) {
    return null;
  }

  // No repo type expectation and not a cross-cutting → skip
  if (!expectations.repositoryType) {
    return null; // handled by cross-cutting check
  }

  const matchedProps: string[] = [`repositoryType=${detection.repositoryType}`];

  // Check source framework match (.NET)
  if (expectations.sourceFramework && detection.framework) {
    if (detection.framework === expectations.sourceFramework) {
      matchedProps.push(`source_framework=${detection.framework}`);
      return {
        confidence: 'high',
        reason: `Project framework ${detection.framework} matches scenario source ${expectations.sourceFramework}`,
        matchedProps,
      };
    }
    // Check if framework is in the version range from entry gates
    if (expectations.versionRange && expectations.versionRange.includes(detection.framework)) {
      matchedProps.push(`source_framework=${detection.framework} (in range)`);
      return {
        confidence: 'high',
        reason: `Project framework ${detection.framework} is within supported range`,
        matchedProps,
      };
    }
  }

  // Check source JDK version match (Java)
  if (expectations.sourceVersion && detection.runtimeVersion) {
    const detectedVer = detection.runtimeVersion.replace(/^1\./, ''); // normalize "1.8" → "8"
    if (detectedVer === expectations.sourceVersion) {
      matchedProps.push(`source_version=${detectedVer}`);
      return {
        confidence: 'high',
        reason: `Project runtime version ${detectedVer} matches scenario source ${expectations.sourceVersion}`,
        matchedProps,
      };
    }
  }

  // Check build system match (e.g., java-maven-to-gradle)
  if (expectations.buildSystem && detection.buildSystem) {
    if (detection.buildSystem === expectations.buildSystem) {
      matchedProps.push(`build_system=${detection.buildSystem}`);
      return {
        confidence: 'high',
        reason: `Project build system ${detection.buildSystem} matches scenario`,
        matchedProps,
      };
    }
  }

  // Check language match for conversion scenarios (e.g., javascript-to-typescript)
  if (expectations.sourceLanguage && detection.language) {
    if (detection.language === expectations.sourceLanguage) {
      matchedProps.push(`language=${detection.language}`);
      return {
        confidence: 'high',
        reason: `Project language ${detection.language} matches scenario source language`,
        matchedProps,
      };
    }
  }

  // .NET Framework detection for framework-to-modern scenarios
  if (detection.repositoryType === 'dotnet' && detection.framework) {
    const tfm = detection.framework.toLowerCase();
    const isFramework = tfm.startsWith('net4') || tfm.startsWith('v4') || tfm.startsWith('net3');
    if (isFramework && scenarioName.includes('dotnetframework-to-')) {
      matchedProps.push(`framework=${detection.framework} (legacy .NET Framework)`);
      return {
        confidence: 'high',
        reason: `Legacy .NET Framework project detected, matches framework migration scenario`,
        matchedProps,
      };
    }
  }

  // Repo type matches but no specific version match → medium
  return {
    confidence: 'medium',
    reason: `Project type ${detection.repositoryType} matches but version/framework could not be precisely matched`,
    matchedProps,
  };
}

// ---------------------------------------------------------------------------
// Cross-cutting Scenario Detection
// ---------------------------------------------------------------------------

function checkCrossCutting(
  scenarioName: string,
  plan: FlightPlan,
  detections: TechStackDetection[],
): { confidence: 'high' | 'medium' | 'low'; reason: string; matchedProps: string[] } | null {
  if (detections.length === 0) return null;

  switch (scenarioName) {
    case 'javascript-to-typescript': {
      const jsDetection = detections.find(d => d.repositoryType === 'nodejs');
      if (jsDetection && jsDetection.language === 'javascript') {
        return {
          confidence: 'high',
          reason: 'JavaScript project without TypeScript — candidate for TypeScript migration',
          matchedProps: ['language=javascript', 'typescript=missing'],
        };
      }
      return null;
    }

    case 'unit-test-adoption': {
      // Include for any detected tech if no test directories found
      if (detections.length > 0) {
        return {
          confidence: 'low',
          reason: 'Cross-cutting: unit test adoption applies to all project types',
          matchedProps: ['cross-cutting'],
        };
      }
      return null;
    }

    case 'manual-to-automated-integration': {
      if (detections.length > 0) {
        return {
          confidence: 'low',
          reason: 'Cross-cutting: integration test automation applies to all project types',
          matchedProps: ['cross-cutting'],
        };
      }
      return null;
    }

    case 'ui-automation-playwright': {
      // Only suggest if there's a web project (Node.js or .NET with web indicators)
      const hasWeb = detections.some(d =>
        d.repositoryType === 'nodejs' || d.repositoryType === 'dotnet',
      );
      if (hasWeb) {
        return {
          confidence: 'low',
          reason: 'Cross-cutting: Playwright UI automation for web projects',
          matchedProps: ['cross-cutting', 'web-project'],
        };
      }
      return null;
    }

    case 'monolith-to-microservices': {
      if (detections.length > 0) {
        return {
          confidence: 'low',
          reason: 'Cross-cutting: monolith decomposition may apply',
          matchedProps: ['cross-cutting'],
        };
      }
      return null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Individual Tech Detectors
// ---------------------------------------------------------------------------

function detectDotNet(projectDir: string): TechStackDetection | null {
  const evidence: DetectionEvidence[] = [];

  const projectFiles = findFilesShallow(projectDir, ['.csproj', '.fsproj', '.vbproj']);
  const slnFiles = findFilesShallow(projectDir, ['.sln']);

  if (projectFiles.length === 0 && slnFiles.length === 0) return null;

  let framework: string | undefined;
  let frameworkVersion: string | undefined;
  let language = 'csharp';

  for (const pf of projectFiles) {
    if (pf.endsWith('.fsproj')) language = 'fsharp';
    if (pf.endsWith('.vbproj')) language = 'vbnet';

    try {
      const content = fs.readFileSync(pf, 'utf-8');
      const tfmMatch = content.match(/<TargetFramework(?:s)?>\s*([^<]+)\s*<\//);
      if (tfmMatch) {
        const tfm = tfmMatch[1].split(';')[0].trim();
        framework = tfm;

        // Extract version: "net6.0" -> "6.0", "net48" -> "4.8"
        const modernMatch = tfm.match(/^net(\d+\.\d+)/);
        const fwMatch = tfm.match(/^net(\d)(\d+)$/);
        const vMatch = tfm.match(/^v(\d+\.\d+)/);
        if (modernMatch) {
          frameworkVersion = modernMatch[1];
        } else if (fwMatch) {
          frameworkVersion = `${fwMatch[1]}.${fwMatch[2]}`;
        } else if (vMatch) {
          frameworkVersion = vMatch[1];
        }

        evidence.push({
          file: path.relative(projectDir, pf),
          property: 'TargetFramework',
          value: tfm,
        });
      }
    } catch {
      // skip unreadable files
    }

    // Check for packages.config (legacy .NET Framework indicator)
    const pkgConfigPath = path.join(path.dirname(pf), 'packages.config');
    if (fs.existsSync(pkgConfigPath)) {
      evidence.push({
        file: path.relative(projectDir, pkgConfigPath),
        property: 'packages.config',
        value: 'present (legacy .NET Framework)',
      });
    }
  }

  for (const sf of slnFiles) {
    evidence.push({
      file: path.relative(projectDir, sf),
      property: '.sln',
      value: 'present',
    });
  }

  return {
    language,
    framework,
    frameworkVersion,
    buildSystem: 'msbuild',
    repositoryType: 'dotnet',
    evidence,
  };
}

function detectJava(projectDir: string): TechStackDetection | null {
  const evidence: DetectionEvidence[] = [];

  const pomFiles = findFilesShallow(projectDir, ['pom.xml']);
  const gradleFiles = findFilesShallow(projectDir, ['build.gradle', 'build.gradle.kts']);

  if (pomFiles.length === 0 && gradleFiles.length === 0) return null;

  let buildSystem: string;
  let runtimeVersion: string | undefined;

  if (pomFiles.length > 0) {
    buildSystem = 'maven';
    try {
      const content = fs.readFileSync(pomFiles[0], 'utf-8');

      const javaVersion = content.match(/<java\.version>\s*(\d+)\s*<\//);
      const compilerRelease = content.match(/<maven\.compiler\.release>\s*(\d+)\s*<\//);
      const compilerSource = content.match(/<maven\.compiler\.source>\s*([^<]+)\s*<\//);

      if (javaVersion) {
        runtimeVersion = javaVersion[1];
        evidence.push({ file: 'pom.xml', property: 'java.version', value: javaVersion[1] });
      } else if (compilerRelease) {
        runtimeVersion = compilerRelease[1];
        evidence.push({ file: 'pom.xml', property: 'maven.compiler.release', value: compilerRelease[1] });
      } else if (compilerSource) {
        runtimeVersion = compilerSource[1].replace(/^1\./, ''); // "1.8" → "8"
        evidence.push({ file: 'pom.xml', property: 'maven.compiler.source', value: compilerSource[1] });
      }

      evidence.push({ file: 'pom.xml', property: 'build-system', value: 'maven' });
    } catch {
      evidence.push({ file: 'pom.xml', property: 'build-system', value: 'maven' });
    }
  } else {
    buildSystem = 'gradle';
    const gradleFile = gradleFiles[0];
    const gradleName = path.basename(gradleFile);
    try {
      const content = fs.readFileSync(gradleFile, 'utf-8');

      const toolchainMatch = content.match(/languageVersion\s*=\s*JavaLanguageVersion\.of\((\d+)\)/);
      const sourceCompat = content.match(/sourceCompatibility\s*=\s*['"]?(\d+)['"]?/);
      const targetCompat = content.match(/targetCompatibility\s*=\s*['"]?(\d+)['"]?/);

      if (toolchainMatch) {
        runtimeVersion = toolchainMatch[1];
        evidence.push({ file: gradleName, property: 'toolchain.languageVersion', value: toolchainMatch[1] });
      } else if (sourceCompat) {
        runtimeVersion = sourceCompat[1];
        evidence.push({ file: gradleName, property: 'sourceCompatibility', value: sourceCompat[1] });
      } else if (targetCompat) {
        runtimeVersion = targetCompat[1];
        evidence.push({ file: gradleName, property: 'targetCompatibility', value: targetCompat[1] });
      }

      evidence.push({ file: gradleName, property: 'build-system', value: 'gradle' });
    } catch {
      evidence.push({ file: gradleName, property: 'build-system', value: 'gradle' });
    }
  }

  return {
    language: 'java',
    framework: undefined,
    frameworkVersion: undefined,
    buildSystem,
    runtimeVersion,
    repositoryType: 'java',
    evidence,
  };
}

function detectNodeJs(projectDir: string): TechStackDetection | null {
  const pkgJsonPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return null;

  const evidence: DetectionEvidence[] = [];
  let runtimeVersion: string | undefined;
  let language = 'javascript';

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

    // Check engines.node
    if (pkg.engines?.node) {
      runtimeVersion = pkg.engines.node;
      evidence.push({ file: 'package.json', property: 'engines.node', value: pkg.engines.node });
    }

    // Check for TypeScript dependency
    const hasTsDep = !!(pkg.devDependencies?.typescript || pkg.dependencies?.typescript);
    const hasTsConfig = fs.existsSync(path.join(projectDir, 'tsconfig.json'));

    if (hasTsDep || hasTsConfig) {
      language = 'typescript';
      evidence.push({ file: 'package.json', property: 'typescript', value: 'present' });
    } else {
      evidence.push({ file: 'package.json', property: 'typescript', value: 'not found' });
    }

    evidence.push({ file: 'package.json', property: 'name', value: pkg.name ?? '(unnamed)' });
  } catch {
    evidence.push({ file: 'package.json', property: 'parse', value: 'failed' });
  }

  // Check .nvmrc
  const nvmrcPath = path.join(projectDir, '.nvmrc');
  if (fs.existsSync(nvmrcPath)) {
    try {
      const version = fs.readFileSync(nvmrcPath, 'utf-8').trim();
      runtimeVersion = version;
      evidence.push({ file: '.nvmrc', property: 'node-version', value: version });
    } catch { /* skip */ }
  }

  // Check .node-version
  const nodeVersionPath = path.join(projectDir, '.node-version');
  if (fs.existsSync(nodeVersionPath)) {
    try {
      const version = fs.readFileSync(nodeVersionPath, 'utf-8').trim();
      runtimeVersion = version;
      evidence.push({ file: '.node-version', property: 'node-version', value: version });
    } catch { /* skip */ }
  }

  return {
    language,
    framework: undefined,
    frameworkVersion: undefined,
    buildSystem: 'npm',
    runtimeVersion,
    repositoryType: 'nodejs',
    evidence,
  };
}

function detectPython(projectDir: string): TechStackDetection | null {
  const evidence: DetectionEvidence[] = [];
  let runtimeVersion: string | undefined;
  let language = 'python';

  // Check pyproject.toml
  const pyprojectPath = path.join(projectDir, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      evidence.push({ file: 'pyproject.toml', property: 'exists', value: 'true' });

      const requiresPython = content.match(/requires-python\s*=\s*"([^"]+)"/);
      if (requiresPython) {
        runtimeVersion = requiresPython[1];
        evidence.push({ file: 'pyproject.toml', property: 'requires-python', value: requiresPython[1] });
      }
    } catch { /* skip */ }
  }

  // Check setup.py
  const setupPyPath = path.join(projectDir, 'setup.py');
  if (fs.existsSync(setupPyPath)) {
    try {
      const content = fs.readFileSync(setupPyPath, 'utf-8');
      evidence.push({ file: 'setup.py', property: 'exists', value: 'true' });

      const pythonRequires = content.match(/python_requires\s*=\s*['"]([^'"]+)['"]/);
      if (pythonRequires) {
        runtimeVersion = pythonRequires[1];
        evidence.push({ file: 'setup.py', property: 'python_requires', value: pythonRequires[1] });
      }

      // Detect Python 2 indicators
      if (content.includes('print ') && !content.includes('print(')) {
        language = 'python2';
        evidence.push({ file: 'setup.py', property: 'python2-indicator', value: 'print statement without parens' });
      }
    } catch { /* skip */ }
  }

  // Check setup.cfg
  const setupCfgPath = path.join(projectDir, 'setup.cfg');
  if (fs.existsSync(setupCfgPath)) {
    try {
      const content = fs.readFileSync(setupCfgPath, 'utf-8');
      evidence.push({ file: 'setup.cfg', property: 'exists', value: 'true' });

      const pythonRequires = content.match(/python_requires\s*=\s*(.+)/);
      if (pythonRequires) {
        runtimeVersion = pythonRequires[1].trim();
        evidence.push({ file: 'setup.cfg', property: 'python_requires', value: runtimeVersion });
      }
    } catch { /* skip */ }
  }

  // Check requirements.txt
  const reqPath = path.join(projectDir, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    evidence.push({ file: 'requirements.txt', property: 'exists', value: 'true' });
  }

  // Check Pipfile
  const pipfilePath = path.join(projectDir, 'Pipfile');
  if (fs.existsSync(pipfilePath)) {
    try {
      const content = fs.readFileSync(pipfilePath, 'utf-8');
      evidence.push({ file: 'Pipfile', property: 'exists', value: 'true' });

      const pythonVersion = content.match(/python_version\s*=\s*"([^"]+)"/);
      if (pythonVersion) {
        runtimeVersion = pythonVersion[1];
        evidence.push({ file: 'Pipfile', property: 'python_version', value: pythonVersion[1] });
      }
    } catch { /* skip */ }
  }

  // If no Python files found at all, return null
  if (evidence.length === 0) return null;

  return {
    language,
    framework: undefined,
    frameworkVersion: undefined,
    buildSystem: 'pip',
    runtimeVersion,
    repositoryType: 'python',
    evidence,
  };
}

function detectVB6(projectDir: string): TechStackDetection | null {
  const vbpFiles = findFilesShallow(projectDir, ['.vbp']);
  const frmFiles = findFilesShallow(projectDir, ['.frm']);
  const basFiles = findFilesShallow(projectDir, ['.bas']);
  const clsFiles = findFilesShallow(projectDir, ['.cls']);

  if (vbpFiles.length === 0 && frmFiles.length === 0 && basFiles.length === 0) return null;

  const evidence: DetectionEvidence[] = [];
  if (vbpFiles.length > 0) {
    evidence.push({ file: path.relative(projectDir, vbpFiles[0]), property: '.vbp', value: `${vbpFiles.length} project file(s)` });
  }
  if (frmFiles.length > 0) {
    evidence.push({ file: '(multiple)', property: '.frm files', value: `${frmFiles.length} form(s)` });
  }
  if (basFiles.length > 0) {
    evidence.push({ file: '(multiple)', property: '.bas files', value: `${basFiles.length} module(s)` });
  }
  if (clsFiles.length > 0) {
    evidence.push({ file: '(multiple)', property: '.cls files', value: `${clsFiles.length} class(es)` });
  }

  return {
    language: 'vb6',
    framework: 'vb6',
    frameworkVersion: '6.0',
    buildSystem: undefined,
    runtimeVersion: undefined,
    repositoryType: 'vb6',
    evidence,
  };
}

function detectCobol(projectDir: string): TechStackDetection | null {
  const cblFiles = findFilesShallow(projectDir, ['.cbl', '.cob']);
  const cpyFiles = findFilesShallow(projectDir, ['.cpy']);

  if (cblFiles.length === 0) return null;

  const evidence: DetectionEvidence[] = [];
  evidence.push({ file: '(multiple)', property: '.cbl/.cob files', value: `${cblFiles.length} source file(s)` });
  if (cpyFiles.length > 0) {
    evidence.push({ file: '(multiple)', property: '.cpy files', value: `${cpyFiles.length} copybook(s)` });
  }

  return {
    language: 'cobol',
    framework: undefined,
    frameworkVersion: undefined,
    buildSystem: undefined,
    runtimeVersion: undefined,
    repositoryType: 'cobol',
    evidence,
  };
}

// ---------------------------------------------------------------------------
// File Scanning Helper
// ---------------------------------------------------------------------------

/**
 * Find files matching given extensions/names in a directory.
 * Scans root + one level of subdirectories (same pattern as gate-evaluator.ts).
 * Skips dot-prefixed directories, node_modules, bin, obj, dist.
 */
function findFilesShallow(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  const skipDirs = new Set(['node_modules', 'bin', 'obj', 'dist', '.git', '.vs', '.idea']);

  if (!fs.existsSync(dir)) return results;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        for (const ext of extensions) {
          if (entry.name.endsWith(ext) || entry.name === ext) {
            results.push(path.join(dir, entry.name));
          }
        }
      }
      // Check one level deep
      if (entry.isDirectory() && !entry.name.startsWith('.') && !skipDirs.has(entry.name)) {
        try {
          const subEntries = fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isFile()) {
              for (const ext of extensions) {
                if (sub.name.endsWith(ext) || sub.name === ext) {
                  results.push(path.join(dir, entry.name, sub.name));
                }
              }
            }
          }
        } catch {
          // skip unreadable subdirs
        }
      }
    }
  } catch {
    // ignore read errors
  }

  return results;
}
