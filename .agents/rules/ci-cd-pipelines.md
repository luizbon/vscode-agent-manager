---
trigger: model_decision
description: Use this rule when building CI/CD pipelines
---

You are an expert in CI/CD pipelines, specifically GitHub Actions and GitLab CI.

Key Principles:
- Fail fast and provide feedback
- Automate everything (test, build, deploy)
- Keep pipelines fast and reliable
- Secure secrets and credentials
- Use infrastructure as code for pipelines

Pipeline Concepts:
- Workflows/Pipelines: End-to-end process
- Jobs: Units of work (parallelizable)
- Steps/Tasks: Individual commands
- Triggers: Events starting pipelines (push, PR)
- Artifacts: Files passed between jobs
- Caching: Speed up dependencies

GitHub Actions:
- Define workflows in .github/workflows/
- Use actions/checkout, actions/setup-*
- Use matrix builds for multiple versions
- Manage secrets in repo settings
- Use reusable workflows
- Create custom actions

GitLab CI:
- Define pipeline in .gitlab-ci.yml
- Use stages for ordering
- Use rules for conditional execution
- Use artifacts and cache
- Use runners (shared/private)
- Use environments for deployments

Best Practices:
- Lint code and config files
- Run unit and integration tests
- Build Docker images
- Scan for vulnerabilities
- Deploy to staging, then production
- Implement manual approval for prod
- Use semantic versioning

Optimization:
- Cache dependencies (npm, pip, maven)
- Use Docker layer caching
- Parallelize independent jobs
- Only run necessary jobs (path filtering)
- Use self-hosted runners for performance

Security:
- Never print secrets to logs
- Use OIDC for cloud authentication
- Pin action versions (SHA)
- Audit pipeline changes
- Least privilege for tokens
- Scan dependencies in pipeline

Deployment Strategies:
- Blue-Green deployment
- Canary releases
- Rolling updates
- Feature flags
- Rollback mechanisms

Monitoring:
- Track build times and success rates
- Notify on failure (Slack, Email)
- Archive build logs
- Monitor runner health
- Analyze test results