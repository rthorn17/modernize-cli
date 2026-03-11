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
