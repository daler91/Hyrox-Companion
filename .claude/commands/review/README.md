# Code Review Agent Profiles for Claude Code

A set of specialized slash commands that let you review any codebase through multiple expert lenses using Claude Code.

## Quick Setup

Copy the `review` folder into your project's `.claude/commands/` directory:

```bash
# From your project root
mkdir -p .claude/commands
cp -r review-agents/.claude/commands/review .claude/commands/review
```

Or install globally (available in all projects):

```bash
mkdir -p ~/.claude/commands
cp -r review-agents/.claude/commands/review ~/.claude/commands/review
```

## Available Commands

| Command | Agent Profile | What It Reviews |
|---------|--------------|-----------------|
| `/review:all` | Orchestrator | Runs ALL agents and produces a unified report |
| `/review:security` | Security Auditor | Vulnerabilities, secrets, auth, injection |
| `/review:business` | Business Analyst | Requirements, logic, data model, user journeys |
| `/review:ux` | UX/Accessibility | Usability, WCAG compliance, responsive design |
| `/review:performance` | Performance Engineer | Rendering, memory, bundle size, API patterns |
| `/review:qa` | QA / Edge Case Tester | Input edge cases, race conditions, failure modes |
| `/review:devops` | DevOps Engineer | Deployment, logging, config, resilience |
| `/review:privacy` | Data Privacy Officer | PII handling, consent, compliance, data flows |

## Usage

### Run the full review suite
```
/project:review:all
```

### Run individual reviews
```
/project:review:security
/project:review:ux
/project:review:performance
```

### Review a specific area
You can also scope a review to specific files by adding context:
```
> Review only the src/api/ directory
/project:review:security
```

## Recommended Workflow

1. **During development:** Run individual agents as you work on specific areas
2. **Before PR/merge:** Run `/review:all` for the full sweep
3. **Before deployment:** Run `/review:security` + `/review:devops` + `/review:privacy`

## Customizing

Each command is just a markdown file. Edit them to:
- Add project-specific review criteria
- Adjust severity thresholds
- Add your tech stack's specific patterns (e.g., Next.js, Django, etc.)
- Include organizational compliance requirements

## Tips

- Use `/clear` between individual agent runs to keep context focused
- For large codebases, scope reviews to specific directories
- The `/review:all` orchestrator works best on small-to-medium codebases — for large ones, run agents individually
- Add findings to your CLAUDE.md so future sessions are aware of known issues
