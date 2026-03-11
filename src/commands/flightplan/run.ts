import { Args, Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { findInstalledPlan, parsePlan } from '../../lib/plan-parser.js';

const STEP_NAMES: Record<string, string> = {
  '00-assess': 'Assess the application',
  '01-vision': 'Establish the migration vision',
  '02-roadmap': 'Create the migration roadmap',
  '03-progress': 'Create a progress tracker',
  '04-plan': 'Queue work items',
  '05-spec': 'Spec the next work item',
  '06-implement': 'Implement the work item',
  '07-iterate': 'Feedback and iterate',
};

export default class FlightplanRun extends Command {
  static override description = 'Display or run a Flight Plan orchestration step';

  static override args = {
    step: Args.string({
      description: 'Step to run (e.g., 00-assess, 01-vision, 02-roadmap)',
      required: true,
    }),
  };

  static override flags = {
    source: Flags.string({
      description: 'Path to the target project',
      default: '.',
    }),
  };

  static override examples = [
    'modernize flightplan run 00-assess',
    'modernize flightplan run 04-plan --source ./my-project',
  ];

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FlightplanRun);
    const projectDir = flags.source;

    const yamlPath = findInstalledPlan(projectDir);
    if (!yamlPath) {
      this.error('No Flight Plan installed. Run "modernize flightplan install <scenario>" first.');
    }

    const plan = parsePlan(yamlPath);
    const planDir = path.dirname(yamlPath);
    const promptsDir = path.join(planDir, 'Prompts');

    if (!fs.existsSync(promptsDir)) {
      this.error(`No Prompts directory found at ${promptsDir}`);
    }

    // Find the matching prompt file
    const promptFiles = fs.readdirSync(promptsDir).filter(f => f.endsWith('.prompt.md'));
    const matchingPrompt = promptFiles.find(f => f.startsWith(args.step));

    if (!matchingPrompt) {
      // Try partial match
      const partialMatch = promptFiles.find(f =>
        f.toLowerCase().includes(args.step.toLowerCase()),
      );

      if (!partialMatch) {
        this.log('');
        this.log(chalk.red(`  Step "${args.step}" not found.`));
        this.log('');
        this.log(chalk.bold('  Available steps:'));
        for (const f of promptFiles) {
          const stepName = f.replace('.prompt.md', '');
          this.log(`    - ${stepName}`);
        }
        this.log('');
        return;
      }

      // Use the partial match
      this.displayPrompt(path.join(promptsDir, partialMatch), plan);
      return;
    }

    this.displayPrompt(path.join(promptsDir, matchingPrompt), plan);
  }

  private displayPrompt(promptPath: string, plan: ReturnType<typeof parsePlan>): void {
    const content = fs.readFileSync(promptPath, 'utf-8');
    const fileName = path.basename(promptPath, '.prompt.md');
    const stepDescription = STEP_NAMES[fileName] ?? fileName;

    this.log('');
    this.log(chalk.bold(`Step: ${fileName}`));
    this.log(chalk.gray(`${stepDescription} — ${plan.scenario} v${plan.version}`));
    this.log(chalk.gray('─'.repeat(70)));
    this.log('');
    this.log(content);
    this.log('');
    this.log(chalk.gray('─'.repeat(70)));
    this.log(chalk.gray('Copy this prompt into your AI assistant to execute this step.'));
    this.log('');
  }
}
