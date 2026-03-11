export interface FlightPlan {
  scenario: string;
  version: string;
  intent: string;
  parameters: Record<string, string>;
  execution_modes?: ExecutionModes;
  resolution?: Resolution;
  skills: Skill[];
  gates: Gates;
  required_artifacts: Artifact[];
  human_controls: HumanControl[];
}

export interface ExecutionModes {
  plan_only?: ExecutionMode;
  gates_only?: ExecutionMode;
}

export interface ExecutionMode {
  enabled: boolean;
  output: string;
  description: string;
}

export interface Resolution {
  skills: string[];
  templates: string[];
}

export interface Gates {
  entry: Gate[];
  output_integrity: Gate[];
  risk: Gate[];
  exit: Gate[];
}

export interface Gate {
  name: string;
  condition: string;
  description: string;
}

export interface GateResult {
  name: string;
  category: string;
  condition: string;
  description: string;
  passed: boolean;
  reason?: string;
}

export interface Skill {
  id: string;
  version: string;
  phase: string;
  location?: string;
}

export interface Artifact {
  name: string;
  description: string;
}

export interface HumanControl {
  trigger: string;
  required: boolean;
  description: string;
}

export interface ScenarioEntry {
  name: string;
  status: 'Active' | 'Planned';
  description: string;
  category: string;
  link?: string;
}

export interface InstalledPlan {
  scenario: string;
  version: string;
  installedAt: string;
  source: string;
}

// --- Enhanced Assessment Types ---

/** Detected technology stack of a project */
export interface TechStackDetection {
  /** Primary language (e.g., 'csharp', 'java', 'javascript', 'python', 'vb6', 'cobol') */
  language: string;
  /** Framework identifier (e.g., 'net6.0', 'net48', 'spring-boot') */
  framework?: string;
  /** Framework version string (e.g., '6.0', '4.8') */
  frameworkVersion?: string;
  /** Build system (e.g., 'msbuild', 'maven', 'gradle', 'npm', 'pip') */
  buildSystem?: string;
  /** Runtime/JDK/Node version if detectable */
  runtimeVersion?: string;
  /** Repository type for gate matching (e.g., 'dotnet', 'java', 'nodejs', 'python') */
  repositoryType: string;
  /** Raw evidence: the files and values that led to this detection */
  evidence: DetectionEvidence[];
}

export interface DetectionEvidence {
  file: string;
  property: string;
  value: string;
}

/** A scenario that matched the detected tech stack */
export interface ScenarioMatch {
  /** The scenario catalog entry */
  scenario: ScenarioEntry;
  /** The parsed flight plan */
  plan: FlightPlan;
  /** Confidence level of the match */
  confidence: 'high' | 'medium' | 'low';
  /** Why this scenario matched */
  matchReason: string;
  /** Which detected tech properties drove the match */
  matchedProperties: string[];
}

/** Result of scaffolding a new flight plan */
export interface ScaffoldResult {
  /** Absolute path where the scaffold was created */
  installedPath: string;
  /** The generated FlightPlan object */
  plan: FlightPlan;
  /** List of all created file paths (relative to installedPath) */
  createdFiles: string[];
}
