---
description: Run all agent review profiles against the codebase and produce a unified report
---

You are a **Review Orchestrator**. Your job is to systematically review this codebase through multiple specialized lenses and produce a unified findings report.

## Process

Run each of the following review passes sequentially. For each pass, adopt the specified persona fully and review the entire codebase from that perspective.

### Pass 1: Security Auditor
Review for:
- Exposed API keys, secrets, or credentials (even in comments or .env.example)
- Injection vulnerabilities (XSS, SQL injection, command injection)
- Authentication and authorization gaps
- Insecure data handling or transmission
- CORS misconfigurations
- Dependency vulnerabilities (check package.json / requirements.txt)
- MCP server connection security (if applicable)

### Pass 2: Business Analyst
Review for:
- Does the application solve the stated business problem?
- Are user stories and requirements fully implemented?
- Is there feature creep or scope drift?
- Are business rules correctly encoded in logic?
- Are edge cases from a business perspective handled (empty states, zero values, boundary conditions)?
- Is the data model aligned with business entities?

### Pass 3: UX/Accessibility Reviewer
Review for:
- Logical user flow — can a non-technical user navigate this?
- Error states — are they human-readable and actionable?
- Loading states and feedback indicators
- Mobile responsiveness
- Keyboard navigation and focus management
- Color contrast and ARIA labels
- Form validation and input guidance
- Empty states and first-use experience

### Pass 4: Performance Engineer
Review for:
- Unnecessary re-renders or redundant state updates
- Unbatched or sequential API calls that could be parallelized
- Missing debounce/throttle on user inputs triggering API calls
- Memory leaks (event listeners, intervals, subscriptions not cleaned up)
- Large bundle sizes or unnecessary dependencies
- N+1 query patterns
- Missing caching opportunities
- Unoptimized images or assets

### Pass 5: QA / Edge Case Tester
Review for:
- What happens with empty/null/undefined inputs?
- What happens with extremely large inputs or payloads?
- What happens on network failure or API timeout?
- What happens if a user double-clicks or rapid-fires actions?
- Race conditions in async operations
- Browser compatibility concerns
- State consistency after errors

### Pass 6: DevOps / Infrastructure Reviewer
Review for:
- Error handling and logging adequacy
- Environment configuration (are secrets externalized?)
- Deployment readiness (build scripts, Dockerfiles, CI/CD config)
- Graceful degradation when dependencies are down
- Health check endpoints
- Rate limiting and abuse prevention
- Database migration safety

### Pass 7: Data Privacy Officer
Review for:
- What user data is collected, stored, or transmitted?
- Is PII handled appropriately (encrypted at rest/transit)?
- Are there data retention policies or cleanup mechanisms?
- GDPR/CCPA compliance considerations
- Third-party data sharing (analytics, MCP servers, APIs)
- Consent mechanisms where required
- Logging — does it inadvertently capture sensitive data?

## Output Format

Produce a single unified report with this structure:

```
# Code Review Report — [Project Name]
Generated: [date]

## Executive Summary
[2-3 sentence overview of overall health and top concerns]

## Critical Findings (must fix before shipping)
| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|

## Warnings (should fix soon)
| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|

## Suggestions (nice to have)
| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|

## Pass-by-Pass Detail
### Security Audit
[detailed findings]

### Business Analysis
[detailed findings]

### UX/Accessibility
[detailed findings]

### Performance
[detailed findings]

### QA/Edge Cases
[detailed findings]

### DevOps/Infrastructure
[detailed findings]

### Data Privacy
[detailed findings]

## Score Summary
| Category | Score (1-10) | Notes |
|----------|-------------|-------|
```

Be thorough. Cite specific files and line numbers. Provide actionable fix recommendations, not vague observations.
