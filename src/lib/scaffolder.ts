import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type {
  FlightPlan,
  TechStackDetection,
  ScaffoldResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScaffoldOptions {
  scenarioName: string;
  projectDir: string;
  detection: TechStackDetection;
  targetVersion?: string;
}

/**
 * Scaffold a new FlightPlanPackage at .github/modernize/flightplans/<scenarioName>/
 * pre-filled with tech-specific content based on the detected stack.
 */
export function scaffoldFlightPlan(options: ScaffoldOptions): ScaffoldResult {
  const { scenarioName, projectDir, detection, targetVersion } = options;

  const fpDir = path.join(
    path.resolve(projectDir),
    '.github',
    'modernize',
    'flightplans',
    scenarioName,
  );
  fs.mkdirSync(fpDir, { recursive: true });

  const plan = buildFlightPlanData(scenarioName, detection, targetVersion);
  const createdFiles: string[] = [];

  // flightplan.yaml
  const yamlContent = generateFlightPlanYaml(plan, detection);
  fs.writeFileSync(path.join(fpDir, 'flightplan.yaml'), yamlContent, 'utf-8');
  createdFiles.push('flightplan.yaml');

  // Prompts/
  const promptsDir = path.join(fpDir, 'Prompts');
  fs.mkdirSync(promptsDir, { recursive: true });

  const flowDoc = generateFlowDocument(scenarioName, detection);
  fs.writeFileSync(path.join(promptsDir, '00-flow-of-the-approach.md'), flowDoc, 'utf-8');
  createdFiles.push('Prompts/00-flow-of-the-approach.md');

  const promptSteps: Array<{ step: string; slug: string; title: string }> = [
    { step: '00', slug: 'assess-the-application', title: 'Assess the Application' },
    { step: '01', slug: 'establish-vision', title: 'Establish the Migration Vision' },
    { step: '02', slug: 'create-roadmap', title: 'Create the Migration Roadmap' },
    { step: '03', slug: 'create-progress-tracker', title: 'Create a Progress Tracker' },
    { step: '04', slug: 'queue-more-work', title: 'Queue Work Items' },
    { step: '05', slug: 'spec-next-work-item', title: 'Spec the Next Work Item' },
    { step: '06', slug: 'implement-next-work-item', title: 'Implement the Work Item' },
    { step: '07', slug: 'start-feedback-loop', title: 'Feedback and Iterate' },
  ];

  for (const p of promptSteps) {
    const fileName = `${p.step}-${p.slug}.prompt.md`;
    const content = generatePromptFile(p.step, p.slug, p.title, scenarioName, detection);
    fs.writeFileSync(path.join(promptsDir, fileName), content, 'utf-8');
    createdFiles.push(`Prompts/${fileName}`);
  }

  // Skills/
  const skillDir = path.join(fpDir, 'Skills', 'migration-assessment');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    generateSkillMd(detection),
    'utf-8',
  );
  createdFiles.push('Skills/migration-assessment/SKILL.md');

  // Templates/
  const templatesDir = path.join(fpDir, 'Templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  fs.writeFileSync(
    path.join(templatesDir, 'assessment-template.md'),
    generateAssessmentTemplate(detection),
    'utf-8',
  );
  createdFiles.push('Templates/assessment-template.md');

  fs.writeFileSync(
    path.join(templatesDir, 'MIGRATION_PLAN.md'),
    generateMigrationPlanTemplate(detection),
    'utf-8',
  );
  createdFiles.push('Templates/MIGRATION_PLAN.md');

  // .install-metadata.json
  const metadata = {
    scenario: scenarioName,
    version: plan.version,
    installedAt: new Date().toISOString(),
    source: 'scaffolded',
  };
  fs.writeFileSync(
    path.join(fpDir, '.install-metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8',
  );

  return { installedPath: fpDir, plan, createdFiles };
}

/**
 * Generate a suggested scenario name from the detected tech stack.
 * Pattern: custom-{source}-to-{target}
 */
export function suggestScenarioName(detection: TechStackDetection): string {
  const parts: string[] = ['custom'];

  switch (detection.repositoryType) {
    case 'dotnet': {
      const fw = (detection.framework ?? '').toLowerCase();
      if (fw.match(/^net\d/)) {
        // net5.0, net6.0 → dotnet50, dotnet60
        const ver = (detection.frameworkVersion ?? '').replace('.', '');
        parts.push(`dotnet${ver || fw.replace(/[^0-9]/g, '')}`);
      } else if (fw.includes('v4') || fw.includes('net4') || fw.includes('netstandard')) {
        parts.push('dotnetframework');
      } else {
        parts.push('dotnet');
      }
      break;
    }
    case 'java': {
      const ver = detection.runtimeVersion?.split('.')[0] ?? '';
      parts.push(`java${ver}`);
      break;
    }
    case 'nodejs': {
      const ver = detection.runtimeVersion?.replace(/[^0-9]/g, '').slice(0, 2) ?? '';
      parts.push(`node${ver}`);
      break;
    }
    case 'python': {
      const ver = detection.runtimeVersion?.charAt(0) ?? '';
      parts.push(`python${ver}`);
      break;
    }
    default:
      parts.push(detection.repositoryType);
  }

  parts.push('to');
  parts.push(getDefaultTarget(detection.repositoryType));

  return parts.join('-');
}

/**
 * Validate that a scenario name is usable.
 */
export function validateScenarioName(
  name: string,
  projectDir: string,
): { valid: boolean; reason?: string } {
  if (!name || name.length === 0) {
    return { valid: false, reason: 'Name cannot be empty' };
  }
  if (name.length > 64) {
    return { valid: false, reason: 'Name must be 64 characters or fewer' };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length > 1) {
    return { valid: false, reason: 'Name must be kebab-case (lowercase letters, numbers, hyphens)' };
  }
  const existing = path.join(
    path.resolve(projectDir),
    '.github',
    'modernize',
    'flightplans',
    name,
  );
  if (fs.existsSync(existing)) {
    return { valid: false, reason: `A flight plan named "${name}" already exists` };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getDefaultTarget(repoType: string): string {
  switch (repoType) {
    case 'dotnet': return 'dotnet9';
    case 'java': return 'java21';
    case 'nodejs': return 'nodelts';
    case 'python': return 'python3';
    case 'vb6': return 'csharp';
    case 'cobol': return 'java';
    default: return 'modern';
  }
}

function getTargetFramework(repoType: string, targetVersion?: string): string {
  if (targetVersion) return targetVersion;
  switch (repoType) {
    case 'dotnet': return 'net9.0';
    case 'java': return '21';
    case 'nodejs': return '22';
    case 'python': return '3.12';
    case 'vb6': return 'C# / .NET 9';
    case 'cobol': return 'Java 21';
    default: return 'latest';
  }
}

function getTechDisplayName(repoType: string): string {
  switch (repoType) {
    case 'dotnet': return '.NET';
    case 'java': return 'Java';
    case 'nodejs': return 'Node.js';
    case 'python': return 'Python';
    case 'vb6': return 'Visual Basic 6';
    case 'cobol': return 'COBOL';
    default: return repoType;
  }
}

function getToolSuggestions(repoType: string): string {
  switch (repoType) {
    case 'dotnet':
      return '- Run AppCAT (Application Compatibility Assessment Tool)\n- Use .NET Upgrade Assistant\n- Analyze NuGet package compatibility';
    case 'java':
      return '- Run OpenRewrite migration recipes\n- Use Eclipse Migration Toolkit\n- Analyze Maven/Gradle dependency compatibility';
    case 'nodejs':
      return '- Run npm audit for vulnerability scan\n- Use npm-check-updates (ncu) for dependency analysis\n- Check Node.js version compatibility';
    case 'python':
      return '- Run 2to3 for Python 2→3 migration analysis\n- Use pyupgrade for syntax modernization\n- Analyze requirements.txt for deprecated packages';
    case 'vb6':
      return '- Inventory all VB6 forms, modules, and classes\n- Identify COM dependencies and ActiveX controls\n- Map VB6 patterns to C#/.NET equivalents';
    case 'cobol':
      return '- Use Micro Focus Enterprise Analyzer for COBOL assessment\n- Analyze copybook structures and data layouts\n- Map COBOL programs to Java service boundaries';
    default:
      return '- Inventory source files and dependencies\n- Identify deprecated APIs and patterns\n- Analyze build system configuration';
  }
}

// ---------------------------------------------------------------------------
// FlightPlan data builder
// ---------------------------------------------------------------------------

function buildFlightPlanData(
  scenarioName: string,
  detection: TechStackDetection,
  targetVersion?: string,
): FlightPlan {
  const target = getTargetFramework(detection.repositoryType, targetVersion);
  const source = detection.framework ?? detection.runtimeVersion ?? detection.language;
  const techName = getTechDisplayName(detection.repositoryType);

  return {
    scenario: scenarioName,
    version: '0.1.0',
    intent:
      `Migrate ${techName} application from ${source} to ${target}. ` +
      `This is a custom flight plan scaffolded by modernize-cli based on the detected ` +
      `technology stack. Customize the gates, skills, and prompts to match your ` +
      `specific migration requirements.`,
    parameters: buildParameters(detection, target),
    execution_modes: {
      plan_only: {
        enabled: true,
        output: 'reports/PLANNING_REPORT.md',
        description: 'Analyze codebase, estimate effort, identify risks — no files modified.',
      },
      gates_only: {
        enabled: true,
        output: 'console',
        description: 'Evaluate all gate conditions against current state — no files written.',
      },
    },
    skills: [
      {
        id: 'migration-assessment',
        version: '1.0.0',
        phase: 'discovery',
        location: '',
      },
    ],
    gates: buildGates(detection, source, target),
    required_artifacts: [
      { name: 'docs/vision.md', description: 'Migration vision and scope document' },
      { name: 'docs/roadmap.md', description: 'Phased migration roadmap' },
      { name: 'docs/progress.md', description: 'Progress tracking document' },
      { name: 'reports/assessment.md', description: 'Technical assessment report' },
      { name: 'reports/MIGRATION_PLAN.md', description: 'Detailed migration plan' },
      { name: 'reports/RISK_ASSESSMENT.md', description: 'Risk register and mitigation strategies' },
    ],
    human_controls: [
      {
        trigger: 'breaking_change_detected',
        required: true,
        description: 'Breaking changes require human review and explicit sign-off before proceeding.',
      },
      {
        trigger: 'migration_plan_ready',
        required: true,
        description: 'Migration plan must be reviewed and approved by tech lead before implementation begins.',
      },
      {
        trigger: 'deployment_ready',
        required: true,
        description: 'Final deployment requires human approval after all exit gates pass.',
      },
    ],
  };
}

function buildParameters(
  detection: TechStackDetection,
  target: string,
): Record<string, string> {
  const params: Record<string, string> = {};

  switch (detection.repositoryType) {
    case 'dotnet':
      params.source_framework = detection.framework ?? 'unknown';
      params.target_framework = target;
      params.migration_strategy = 'side-by-side';
      params.breaking_changes_allowed = 'false';
      params.test_framework = 'xunit';
      break;
    case 'java':
      params.source_jdk = detection.runtimeVersion ?? 'unknown';
      params.target_jdk = target;
      params.build_system = detection.buildSystem ?? 'maven';
      params.test_framework = 'junit5';
      break;
    case 'nodejs':
      params.source_node_version = detection.runtimeVersion ?? 'unknown';
      params.target_node_version = target;
      params.source_language = detection.language;
      params.build_system = detection.buildSystem ?? 'npm';
      break;
    case 'python':
      params.source_python = detection.runtimeVersion ?? 'unknown';
      params.target_python = target;
      params.build_system = detection.buildSystem ?? 'pip';
      break;
    case 'vb6':
      params.source_language = 'vb6';
      params.target_language = 'csharp';
      params.target_framework = 'net9.0';
      break;
    case 'cobol':
      params.source_language = 'cobol';
      params.target_language = 'java';
      params.target_jdk = '21';
      break;
    default:
      params.source = detection.framework ?? detection.language;
      params.target = target;
  }

  return params;
}

function buildGates(
  detection: TechStackDetection,
  source: string,
  target: string,
): FlightPlan['gates'] {
  return {
    entry: [
      {
        name: `${detection.repositoryType}-repository-check`,
        condition: `repository_type == "${detection.repositoryType}"`,
        description: `Repository must be a ${getTechDisplayName(detection.repositoryType)} project`,
      },
      {
        name: 'source-version-check',
        condition: `source_version == "${source}"`,
        description: `Source version must match detected: ${source}`,
      },
    ],
    output_integrity: [
      {
        name: 'vision-document-exists',
        condition: 'artifact_exists("docs/vision.md") == true',
        description: 'Vision document must be created before migration begins',
      },
      {
        name: 'roadmap-document-exists',
        condition: 'artifact_exists("docs/roadmap.md") == true',
        description: 'Roadmap document must be created before implementation begins',
      },
    ],
    risk: [
      {
        name: 'critical-vulnerability-threshold',
        condition: 'critical_vulnerabilities == 0',
        description: 'No critical security vulnerabilities allowed in target',
      },
      {
        name: 'breaking-change-approval',
        condition: 'breaking_changes_approved == true OR breaking_changes_count == 0',
        description: 'All breaking changes must be explicitly approved',
      },
    ],
    exit: [
      {
        name: 'build-success',
        condition: 'build_status == "success"',
        description: 'Solution must build successfully on target framework',
      },
      {
        name: 'test-pass-rate',
        condition: 'test_pass_rate >= 0.95',
        description: '95% or higher test pass rate required',
      },
      {
        name: 'target-version-updated',
        condition: `target_version == "${target}"`,
        description: `All components must target ${target}`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// File content generators
// ---------------------------------------------------------------------------

function generateFlightPlanYaml(plan: FlightPlan, detection: TechStackDetection): string {
  const header = [
    `# Flight Plan: ${plan.scenario}`,
    `# Scaffolded by modernize-cli on ${new Date().toISOString().split('T')[0]}`,
    `# Source tech: ${detection.framework ?? detection.runtimeVersion ?? detection.repositoryType}`,
    `# Customize gates, skills, and prompts for your specific migration needs.`,
    '',
  ].join('\n');

  const yamlContent = yaml.dump(plan, {
    lineWidth: 120,
    quotingType: '"',
    forceQuotes: false,
    noRefs: true,
  });

  return header + yamlContent;
}

function generateFlowDocument(
  scenarioName: string,
  detection: TechStackDetection,
): string {
  const techName = getTechDisplayName(detection.repositoryType);
  const source = detection.framework ?? detection.runtimeVersion ?? detection.language;
  const target = getTargetFramework(detection.repositoryType);

  return `# ${scenarioName} — Flow of the Approach

## Overview

This flight plan governs the migration of a **${techName}** application from **${source}** to **${target}**.

The approach follows an 8-step orchestration flow that ensures governance, quality, and traceability at every stage.

## Prompt Sequence

| Step | Prompt | Purpose |
|------|--------|---------|
| 00 | Assess the Application | Analyze current state, dependencies, and migration readiness |
| 01 | Establish the Migration Vision | Define scope, goals, success criteria, and constraints |
| 02 | Create the Migration Roadmap | Break the migration into phases with dependencies and milestones |
| 03 | Create a Progress Tracker | Set up tracking for work items, gates, and milestones |
| 04 | Queue Work Items | Identify and prioritize the next batch of migration tasks |
| 05 | Spec the Next Work Item | Write detailed technical specs for the next task |
| 06 | Implement the Work Item | Execute the migration task with gate checks |
| 07 | Feedback and Iterate | Review results, update progress, plan next iteration |

## Flow Diagram

\`\`\`mermaid
graph TD
    A[00 - Assess] --> B[01 - Vision]
    B --> C[02 - Roadmap]
    C --> D[03 - Progress Tracker]
    D --> E[04 - Queue Work]
    E --> F[05 - Spec Item]
    F --> G[06 - Implement]
    G --> H[07 - Feedback]
    H -->|More work| E
    H -->|Done| I[Exit Gates]
\`\`\`

## Governance

- **Entry Gates** must pass before Step 00 begins
- **Output Integrity Gates** are checked after Steps 01-03
- **Risk Gates** are checked before and during Step 06
- **Exit Gates** must all pass for the migration to be considered complete
- **Human Controls** trigger mandatory pause points for review

## Customization

This is a scaffolded flight plan. To customize:
1. Add scenario-specific skills in the \`Skills/\` directory
2. Refine the prompts with your specific migration patterns
3. Adjust gate conditions to match your quality thresholds
4. Update templates with your project-specific sections
`;
}

function generatePromptFile(
  step: string,
  slug: string,
  title: string,
  scenarioName: string,
  detection: TechStackDetection,
): string {
  const techName = getTechDisplayName(detection.repositoryType);
  const source = detection.framework ?? detection.runtimeVersion ?? detection.language;
  const target = getTargetFramework(detection.repositoryType);
  const tools = getToolSuggestions(detection.repositoryType);

  const promptBodies: Record<string, string> = {
    '00': `You are a ${techName} migration specialist. Assess this application for migration from ${source} to ${target}.

## PROJECT CONTEXT
- Source: ${source}
- Target: ${target}
- Technology: ${techName}
- Scenario: ${scenarioName}

## YOUR TASK

1. **Scan the codebase** — Identify all source files, configuration, and dependencies
2. **Run assessment tools**:
${tools}
3. **Document findings** — Create \`reports/assessment.md\` using the assessment template
4. **Identify blockers** — List any breaking changes, deprecated APIs, or incompatible dependencies
5. **Estimate effort** — Provide a rough effort estimate (small/medium/large) for the migration

## OUTPUT
- \`reports/assessment.md\` — Complete assessment report
- Console summary of key findings and risk level`,

    '01': `Based on the assessment from Step 00, establish the migration vision.

## PROJECT CONTEXT
- Source: ${source} | Target: ${target}
- Assessment: See \`reports/assessment.md\`

## YOUR TASK

1. **Define scope** — What is being migrated and what is out of scope
2. **Set success criteria** — Measurable criteria for migration completion
3. **Identify constraints** — Time, budget, team, technology constraints
4. **Choose strategy** — In-place upgrade, side-by-side, rewrite, or hybrid
5. **Document the vision** — Create \`docs/vision.md\`

## OUTPUT
- \`docs/vision.md\` — Migration vision document with scope, criteria, and strategy`,

    '02': `Based on the vision from Step 01, create a phased migration roadmap.

## PROJECT CONTEXT
- Vision: See \`docs/vision.md\`
- Assessment: See \`reports/assessment.md\`

## YOUR TASK

1. **Define phases** — Break the migration into sequential phases
2. **Map dependencies** — Identify what must happen before what
3. **Set milestones** — Define checkpoints with measurable outcomes
4. **Assign priorities** — Order work by risk, dependency, and value
5. **Create the roadmap** — Document in \`docs/roadmap.md\`

## OUTPUT
- \`docs/roadmap.md\` — Phased migration roadmap with milestones`,

    '03': `Set up progress tracking for the migration.

## YOUR TASK

1. **Create work item structure** — List all migration tasks from the roadmap
2. **Define tracking fields** — Status, assignee, phase, blockers
3. **Set up the tracker** — Create \`docs/progress.md\`
4. **Link to gates** — Map gate conditions to progress milestones

## OUTPUT
- \`docs/progress.md\` — Progress tracking document`,

    '04': `Review the roadmap and progress tracker to identify and queue the next batch of work items.

## YOUR TASK

1. **Review current progress** — Check \`docs/progress.md\` for completed and in-progress items
2. **Identify next items** — Select the next set of work items from the roadmap
3. **Check gate readiness** — Verify entry conditions for the next phase
4. **Queue work** — Update \`docs/progress.md\` with queued items and priorities

## OUTPUT
- Updated \`docs/progress.md\` with next batch of queued work items`,

    '05': `Write a detailed technical specification for the next work item in the queue.

## YOUR TASK

1. **Select the item** — Pick the highest-priority queued item from \`docs/progress.md\`
2. **Analyze impact** — What files, APIs, and dependencies are affected
3. **Design the change** — Describe the exact transformations needed
4. **Identify risks** — What could go wrong and how to mitigate
5. **Define done** — What does "complete" look like for this item

## OUTPUT
- Technical spec for the work item (in progress tracker or separate doc)
- Updated \`docs/progress.md\` marking the item as in-progress`,

    '06': `Implement the work item specified in Step 05.

## YOUR TASK

1. **Execute the migration** — Apply the transformations from the spec
2. **Run tests** — Verify the change doesn't break existing functionality
3. **Check risk gates** — Ensure no critical vulnerabilities introduced
4. **Update tracking** — Mark the item as complete in \`docs/progress.md\`

## GOVERNANCE CHECKPOINTS
- If breaking changes detected → pause for human approval (human_control: breaking_change_detected)
- Check risk gates after implementation
- Verify output integrity gates for any required artifacts

## OUTPUT
- Implemented changes
- Updated test results
- Updated \`docs/progress.md\``,

    '07': `Review the results of the latest implementation cycle and plan the next iteration.

## YOUR TASK

1. **Review results** — What was completed, what issues arose
2. **Update progress** — Refresh \`docs/progress.md\` with latest status
3. **Check exit gates** — Are all exit conditions met?
4. **Plan next iteration** — If more work remains, go back to Step 04
5. **Generate summary** — If all gates pass, create final migration summary

## DECISION POINT
- If exit gates **pass** → Migration complete, generate final report
- If exit gates **fail** → Return to Step 04 to queue remaining work

## OUTPUT
- Updated progress tracking
- Decision: continue iteration or declare completion`,
  };

  const body = promptBodies[step] ?? `Complete step ${step}: ${title} for the ${scenarioName} migration.`;

  return `\`\`\`\`prompt
---
name: ${slug}
description: "${title}"
---

# Step ${step}: ${title}

${body}
\`\`\`\`
`;
}

function generateSkillMd(detection: TechStackDetection): string {
  const techName = getTechDisplayName(detection.repositoryType);
  const tools = getToolSuggestions(detection.repositoryType);
  const source = detection.framework ?? detection.runtimeVersion ?? detection.language;
  const target = getTargetFramework(detection.repositoryType);

  return `---
name: migration-assessment
description: Assess the ${techName} application for migration readiness from ${source} to ${target}.
---

# Migration Assessment

## Purpose

Analyze the source ${techName} application to identify migration blockers, compatibility issues,
and recommended approaches for migrating from **${source}** to **${target}**.

## When to Use

Use this skill during the **discovery** phase (Step 00) to produce a comprehensive
assessment of the application's migration readiness.

## Assessment Tools

${tools}

## Steps

1. **Inventory source files** — Scan the project for all source files, configs, and manifests
2. **Analyze dependencies** — Check all dependencies for target compatibility
3. **Identify deprecated APIs** — Find usage of APIs removed or changed in the target
4. **Check configuration** — Verify build, deployment, and runtime configs are compatible
5. **Assess test coverage** — Evaluate existing test coverage as a migration safety net
6. **Document findings** — Generate \`reports/assessment.md\` from the assessment template

## Output

- \`reports/assessment.md\` — Human-readable assessment with metrics, risks, and recommendations
- Console summary with key findings

## Edge Cases

- Multi-project solutions: assess each project individually and document dependencies
- Mixed framework versions: note version discrepancies across projects
- Third-party dependencies without target support: flag as blockers with alternatives
`;
}

function generateAssessmentTemplate(detection: TechStackDetection): string {
  const techName = getTechDisplayName(detection.repositoryType);
  const source = detection.framework ?? detection.runtimeVersion ?? detection.language;
  const target = getTargetFramework(detection.repositoryType);

  return `# Assessment Report: ${techName} Migration

## Executive Summary

| Metric | Value |
|--------|-------|
| Source Framework | ${source} |
| Target Framework | ${target} |
| Project Count | _[fill in]_ |
| Total Source Files | _[fill in]_ |
| Lines of Code | _[fill in]_ |
| Migration Risk | _[Low / Medium / High / Critical]_ |
| Estimated Effort | _[Small / Medium / Large]_ |

## Project Structure

_[Describe the solution structure, project dependencies, and key components]_

## Dependency Analysis

| Dependency | Current Version | Target Compatible | Action Required |
|-----------|----------------|-------------------|-----------------|
| _[name]_ | _[version]_ | _[Yes/No/Partial]_ | _[action]_ |

## Breaking Changes

### High Impact
_[List breaking changes that require significant rework]_

### Medium Impact
_[List breaking changes with moderate effort to resolve]_

### Low Impact
_[List minor breaking changes or deprecation warnings]_

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| _[risk]_ | _[L/M/H]_ | _[L/M/H]_ | _[strategy]_ |

## Recommendations

1. _[Primary recommendation]_
2. _[Secondary recommendation]_
3. _[Additional recommendations]_
`;
}

function generateMigrationPlanTemplate(detection: TechStackDetection): string {
  const techName = getTechDisplayName(detection.repositoryType);
  const source = detection.framework ?? detection.runtimeVersion ?? detection.language;
  const target = getTargetFramework(detection.repositoryType);

  return `# Migration Plan: ${techName} ${source} to ${target}

## Migration Strategy

**Approach:** _[In-place / Side-by-side / Rewrite / Hybrid]_

**Rationale:** _[Why this approach was chosen based on the assessment]_

## Phase Breakdown

### Phase 1: Preparation
- [ ] Complete assessment report
- [ ] Set up target environment
- [ ] Create branch/workspace for migration
- [ ] Establish baseline test suite

### Phase 2: Core Migration
- [ ] Update framework references
- [ ] Resolve breaking changes
- [ ] Update dependencies to compatible versions
- [ ] Migrate configuration files

### Phase 3: Validation
- [ ] Run full test suite on target
- [ ] Perform integration testing
- [ ] Execute performance benchmarks
- [ ] Security scan on migrated code

### Phase 4: Deployment
- [ ] Update CI/CD pipeline for target
- [ ] Deploy to staging environment
- [ ] Run smoke tests in staging
- [ ] Production deployment with rollback plan

## Mapping Rules

| Source Pattern | Target Pattern | Notes |
|---------------|---------------|-------|
| _[source API/pattern]_ | _[target equivalent]_ | _[migration notes]_ |

## Success Criteria

- [ ] All projects target ${target}
- [ ] Build succeeds with zero errors
- [ ] Test pass rate >= 95%
- [ ] No critical security vulnerabilities
- [ ] Performance within acceptable thresholds
`;
}
