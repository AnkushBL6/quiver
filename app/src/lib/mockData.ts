// Static content for the browser mock: realistic skills, repositories and the
// skills.sh directory. Engine lives in mock.ts.

export const HOME = "/Users/maya";

export interface SeedSkill {
  id: string;
  description: string;
  name?: string;
  source?: string; // owner/repo, "local:<path>" or undefined (hand-made)
  skillPath?: string;
  license?: string;
  version?: string;
  allowedTools?: string;
  files?: string[]; // extra files besides SKILL.md; dirs end with "/"
  /** Coverage profile for managed skills (default: every agent, as in universal mode). */
  reach?: "all" | "most" | "some" | "few" | "one";
  /** Exceptions: agents this managed skill was switched off for. */
  missing?: string[];
  /** Unmanaged: agent ids where a real copy lives (no canonical). */
  only?: string[];
  plugin?: string;
  daysAgo?: number;
  /** One of the user's own skills in ~/Skills. */
  mine?: boolean;
  forkedFrom?: string;
  /** Uncommitted git changes inside the skill folder: [relative path, status]. */
  changes?: [string, string][];
}

export const SEED_SKILLS: SeedSkill[] = [
  // ── Yours (~/Skills, a git repo) ──
  {
    id: "pr-description",
    mine: true,
    description:
      "Write a pull request description from the branch diff: what changed, why, how it was tested, and what reviewers should look at first.",
    files: ["template.md"],
    changes: [["SKILL.md", "M"], ["template.md", "M"]],
    daysAgo: 0,
  },
  {
    id: "typescript-house-style",
    mine: true,
    description:
      "House rules for TypeScript in our repos: strict null checks, no default exports, discriminated unions over enums, and zod at every boundary.",
    files: ["examples/", "examples/result-type.ts"],
    daysAgo: 5,
  },
  {
    id: "db-migration-playbook",
    mine: true,
    description:
      "Plan a zero-downtime Postgres migration: expand, backfill, switch reads, contract. Flags locking DDL before it ships.",
    files: ["checklist.md"],
    changes: [["checklist.md", "??"]],
    daysAgo: 1,
  },
  {
    id: "doc-coauthoring",
    mine: true,
    forkedFrom: "anthropics/skills",
    description:
      "Guide users through a structured workflow for co-authoring documentation: proposals, technical specs, decision docs. Gathers context, iterates on structure, and tests the doc with a fresh reader.",
    daysAgo: 27,
  },

  // ── anthropics/skills (16) ──
  {
    id: "pdf",
    source: "anthropics/skills",
    description:
      "Use this skill whenever the user wants to do anything with PDF files: reading or extracting text and tables, merging or splitting documents, rotating pages, adding watermarks, filling forms, encrypting, extracting images, and OCR on scanned PDFs.",
    license: "Proprietary. LICENSE.txt has complete terms",
    files: ["LICENSE.txt", "forms.md", "reference.md", "scripts/", "scripts/fill_fillable_fields.py", "scripts/extract_form_field_info.py", "scripts/convert_pdf_to_images.py"],
    daysAgo: 41,
  },
  {
    id: "docx",
    source: "anthropics/skills",
    description:
      "Create, read, edit, or manipulate Word documents (.docx). Handles tracked changes, comments, tables of contents, headers and page numbers, and converting content into a polished Word document.",
    license: "Proprietary. LICENSE.txt has complete terms",
    files: ["LICENSE.txt", "ooxml.md", "docx-js.md", "scripts/", "scripts/document.py", "scripts/utilities.py"],
    daysAgo: 41,
  },
  {
    id: "pptx",
    source: "anthropics/skills",
    description:
      "Presentation creation, editing, and analysis. Use when working with .pptx files: creating decks from scratch, editing layouts, adding speaker notes, or extracting slide content.",
    license: "Proprietary. LICENSE.txt has complete terms",
    files: ["LICENSE.txt", "html2pptx.md", "ooxml.md", "scripts/", "scripts/thumbnail.py", "scripts/rearrange.py"],
    daysAgo: 41,
  },
  {
    id: "xlsx",
    source: "anthropics/skills",
    description:
      "Comprehensive spreadsheet creation, editing, and analysis with support for formulas, formatting, data analysis, and visualization. Use for .xlsx, .xlsm, .csv and .tsv files.",
    license: "Proprietary. LICENSE.txt has complete terms",
    files: ["LICENSE.txt", "recalc.py"],
    daysAgo: 41,
  },
  {
    id: "frontend-design",
    source: "anthropics/skills",
    description:
      "Create distinctive, production-grade frontend interfaces with high design quality. Use when building web components, pages, dashboards or landing pages, or when styling and beautifying any web UI.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt"],
    daysAgo: 18,
  },
  {
    id: "mcp-builder",
    source: "anthropics/skills",
    description:
      "Guide for creating high-quality MCP (Model Context Protocol) servers that let LLMs interact with external services through well-designed tools, in Python (FastMCP) or TypeScript (MCP SDK).",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt", "reference/", "reference/mcp_best_practices.md", "reference/python_mcp_server.md", "reference/node_mcp_server.md", "scripts/", "scripts/evaluation.py"],
    daysAgo: 33,
  },
  {
    id: "skill-creator",
    source: "anthropics/skills",
    description:
      "Guide for creating effective skills. Use when the user wants to create a new skill, or update an existing one, that extends an agent with specialized knowledge, workflows, or tool integrations.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt", "references/", "references/workflows.md", "references/output-patterns.md", "scripts/", "scripts/init_skill.py", "scripts/package_skill.py", "scripts/quick_validate.py"],
    daysAgo: 33,
  },
  {
    id: "canvas-design",
    source: "anthropics/skills",
    description:
      "Create beautiful visual art in .png and .pdf documents using a design philosophy. Use when the user asks for a poster, piece of art, or other static visual design.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt", "canvas-fonts/"],
    daysAgo: 60,
  },
  {
    id: "algorithmic-art",
    source: "anthropics/skills",
    description:
      "Create algorithmic art with p5.js using seeded randomness and interactive parameter exploration. Use for generative art, flow fields, or particle systems.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt", "templates/", "templates/viewer.html", "templates/generator_template.js"],
    missing: ["cursor"],
    daysAgo: 60,
  },
  {
    id: "brand-guidelines",
    source: "anthropics/skills",
    description:
      "Apply the official brand colors and typography to any artifact that benefits from a consistent look: slides, docs, landing pages, and diagrams.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt"],
    daysAgo: 60,
  },
  {
    id: "internal-comms",
    source: "anthropics/skills",
    description:
      "A set of resources to help write all kinds of internal communications: status reports, leadership updates, incident reports, FAQs, and company newsletters.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt", "examples/", "examples/3p-updates.md", "examples/company-newsletter.md", "examples/faq-answers.md"],
    daysAgo: 60,
  },
  {
    id: "webapp-testing",
    source: "anthropics/skills",
    description:
      "Toolkit for interacting with and testing local web applications using Playwright. Verifies frontend behavior, captures screenshots, and reads browser logs.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt", "scripts/", "scripts/with_server.py", "examples/", "examples/element_discovery.py"],
    daysAgo: 27,
  },
  {
    id: "slack-gif-creator",
    source: "anthropics/skills",
    description:
      "Knowledge and utilities for creating animated GIFs optimized for Slack, with constraints, validation tools, and animation concepts.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt", "core/", "core/gif_builder.py", "core/validators.py"],
    missing: ["github-copilot", "windsurf", "goose"],
    daysAgo: 90,
  },
  {
    id: "theme-factory",
    source: "anthropics/skills",
    description: "Toolkit for styling artifacts with a theme: ten preset color and font themes for slides, docs, reports and landing pages.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt", "themes/", "themes/ocean.md", "themes/sunset.md"],
    daysAgo: 60,
  },
  {
    id: "web-artifacts-builder",
    source: "anthropics/skills",
    description: "Suite of tools for creating elaborate, multi-component HTML artifacts using React, Tailwind CSS and shadcn/ui.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt", "scripts/", "scripts/init-artifact.sh", "scripts/bundle-artifact.sh"],
    daysAgo: 33,
  },
  {
    id: "claude-api",
    source: "anthropics/skills",
    description: "Build apps with the Claude API and SDKs: model choice, streaming, tool use, prompt caching, batches and token counting.",
    license: "Complete terms in LICENSE.txt",
    files: ["LICENSE.txt", "python.md", "typescript.md"],
    daysAgo: 9,
  },

  // ── obra/superpowers (10) ──
  {
    id: "brainstorming",
    source: "obra/superpowers",
    description:
      "You MUST use this before any creative work: creating features, building components, adding functionality, or modifying behavior. Explores intent, requirements and design before implementation.",
    daysAgo: 12,
  },
  {
    id: "systematic-debugging",
    source: "obra/superpowers",
    description: "Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes.",
    files: ["root-cause-tracing.md", "defense-in-depth.md", "condition-based-waiting.md", "find-polluter.sh"],
    daysAgo: 12,
  },
  {
    id: "writing-plans",
    source: "obra/superpowers",
    description:
      "Use when you have a spec or requirements for a multi-step task, before touching code. Produces a bite-sized implementation plan with exact file paths and verification steps.",
    daysAgo: 12,
  },
  {
    id: "executing-plans",
    source: "obra/superpowers",
    description:
      "Use when you have a written implementation plan to execute in a separate session, with review checkpoints between batches.",
    daysAgo: 12,
  },
  {
    id: "test-driven-development",
    source: "obra/superpowers",
    description:
      "Use when implementing any feature or bugfix, before writing implementation code. Write the test first, watch it fail, write minimal code to pass.",
    files: ["testing-anti-patterns.md"],
    daysAgo: 12,
  },
  {
    id: "requesting-code-review",
    source: "obra/superpowers",
    description:
      "Use when completing tasks, implementing major features, or before merging, to verify the work meets requirements with a structured reviewer pass.",
    files: ["code-reviewer.md"],
    daysAgo: 12,
  },
  {
    id: "receiving-code-review",
    source: "obra/superpowers",
    description: "Use when receiving code review feedback, before implementing suggestions. Requires technical rigor and verification, not blind agreement.",
    daysAgo: 12,
  },
  {
    id: "verification-before-completion",
    source: "obra/superpowers",
    description:
      "Use when about to claim work is complete, fixed, or passing. Requires running verification commands and confirming output before making any success claims.",
    daysAgo: 12,
  },
  {
    id: "using-git-worktrees",
    source: "obra/superpowers",
    description: "Use when starting feature work that needs isolation from the current workspace. Creates isolated git worktrees with smart directory selection.",
    daysAgo: 12,
  },
  {
    id: "dispatching-parallel-agents",
    source: "obra/superpowers",
    description: "Use when facing two or more independent tasks that can be worked on without shared state or sequential dependencies.",
    daysAgo: 12,
  },

  // ── affaan-m/everything-claude-code (9) ──
  {
    id: "backend-patterns",
    source: "affaan-m/everything-claude-code",
    description: "Backend architecture patterns, API design, database optimization, and server-side best practices for Node.js, Express, and Next.js API routes.",
    daysAgo: 15,
  },
  {
    id: "frontend-patterns",
    source: "affaan-m/everything-claude-code",
    description: "Frontend development patterns for React and Next.js: state management, data fetching, performance optimization, and UI best practices.",
    daysAgo: 15,
  },
  {
    id: "coding-standards",
    source: "affaan-m/everything-claude-code",
    description: "Universal coding standards and best practices for TypeScript, JavaScript, React, and Node.js: naming, error handling, immutability and file size.",
    daysAgo: 15,
  },
  {
    id: "postgres-patterns",
    source: "affaan-m/everything-claude-code",
    description: "PostgreSQL patterns for query optimization, schema design, indexing, and security, based on Supabase best practices.",
    daysAgo: 15,
  },
  {
    id: "golang-patterns",
    source: "affaan-m/everything-claude-code",
    description: "Idiomatic Go patterns, best practices, and conventions for building robust, efficient, and maintainable Go applications.",
    daysAgo: 15,
  },
  {
    id: "security-review",
    source: "affaan-m/everything-claude-code",
    description: "Review code for security issues: authentication, input handling, secrets, injection, and unsafe dependencies. Use before shipping anything user-facing.",
    files: ["checklist.md"],
    daysAgo: 15,
  },
  {
    id: "tdd-workflow",
    source: "affaan-m/everything-claude-code",
    description: "Test-driven workflow with 80% coverage targets: write tests first, implement, refactor, and verify with unit, integration and E2E suites.",
    daysAgo: 15,
  },
  {
    id: "strategic-compact",
    source: "affaan-m/everything-claude-code",
    description: "Suggests manual context compaction at logical intervals to preserve context through task phases rather than arbitrary auto-compaction.",
    daysAgo: 15,
  },
  {
    id: "verification-loop",
    source: "affaan-m/everything-claude-code",
    description: "A verification loop for every change: build, type-check, lint, test, and review the diff before calling the work done.",
    daysAgo: 15,
  },

  // ── mattpocock/skills (6) ──
  {
    id: "tdd",
    source: "mattpocock/skills",
    description:
      "Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions red-green-refactor, or wants integration tests.",
    files: ["mocking.md", "refactoring.md", "tests.md"],
    daysAgo: 5,
  },
  {
    id: "grill-me",
    source: "mattpocock/skills",
    description:
      "Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree.",
    daysAgo: 5,
  },
  {
    id: "handoff",
    source: "mattpocock/skills",
    description: "Compact the current conversation into a handoff document for another agent to pick up.",
    daysAgo: 5,
  },
  {
    id: "grill-with-docs",
    source: "mattpocock/skills",
    description: "Grilling session that challenges your plan against the existing domain model and updates CONTEXT.md and ADRs inline.",
    daysAgo: 5,
  },
  {
    id: "improve-codebase-architecture",
    source: "mattpocock/skills",
    description: "Find deepening opportunities in a codebase, informed by the domain language in CONTEXT.md and the decisions in docs/adr/.",
    daysAgo: 5,
  },
  {
    id: "prototype",
    source: "mattpocock/skills",
    description: "Build a throwaway prototype to flesh out a design: a runnable terminal app for state questions, or several radically different UI variations.",
    daysAgo: 5,
  },

  // ── vercel-labs/agent-skills (5) ──
  {
    id: "react-best-practices",
    source: "vercel-labs/agent-skills",
    description:
      "React and Next.js performance optimization guidelines from Vercel Engineering. Use when writing, reviewing, or refactoring React components, data fetching, or bundle size.",
    files: ["rules/", "rules/async-parallel.md", "rules/bundle-barrel-imports.md", "rules/rerender-memo.md", "AGENTS.md"],
    daysAgo: 8,
  },
  {
    id: "web-design-guidelines",
    source: "vercel-labs/agent-skills",
    description:
      "Review UI code for Web Interface Guidelines compliance. Use when asked to review UI, check accessibility, audit design, or review UX.",
    daysAgo: 8,
  },
  {
    id: "composition-patterns",
    source: "vercel-labs/agent-skills",
    description: "React composition patterns that scale: compound components, render props, context providers and avoiding boolean prop proliferation.",
    daysAgo: 8,
  },
  {
    id: "vercel-deploy-claimable",
    source: "vercel-labs/agent-skills",
    description: "Deploy applications and websites to Vercel and return a claimable preview URL.",
    daysAgo: 8,
  },
  {
    id: "react-native-guidelines",
    source: "vercel-labs/agent-skills",
    description: "Guidelines for React Native and Expo apps: list performance, animations on the UI thread, native modules and platform differences.",
    daysAgo: 8,
  },

  // ── wshobson/agents (3) ──
  {
    id: "async-python-patterns",
    source: "wshobson/agents",
    description:
      "Master Python asyncio, concurrent programming, and async/await patterns for high-performance applications. Use when building async APIs, concurrent systems, or I/O-bound services.",
    daysAgo: 70,
  },
  {
    id: "python-performance-optimization",
    source: "wshobson/agents",
    description:
      "Profile and optimize Python code using cProfile, memory profilers, and performance best practices. Use when debugging slow Python code or optimizing bottlenecks.",
    daysAgo: 70,
  },
  {
    id: "grafana-dashboards",
    source: "wshobson/agents",
    description: "Create and manage production Grafana dashboards for real-time visualization of system and application metrics.",
    daysAgo: 80,
  },

  // ── vercel-labs/next-skills, supabase/agent-skills (1 each) ──
  {
    id: "next-best-practices",
    source: "vercel-labs/next-skills",
    description:
      "Next.js best practices: file conventions, RSC boundaries, data patterns, async APIs, metadata, error handling, route handlers, image and font optimization, bundling.",
    files: ["rsc-boundaries.md", "data-patterns.md", "error-handling.md", "route-handlers.md"],
    daysAgo: 22,
  },
  {
    id: "supabase-postgres-best-practices",
    source: "supabase/agent-skills",
    description:
      "Postgres performance optimization and best practices from Supabase. Use when writing, reviewing, or optimizing Postgres queries, schema designs, indexes, or RLS policies.",
    files: ["references/", "references/query-missing-indexes.md", "references/security-rls-performance.md"],
    daysAgo: 30,
  },

  // ── Added by hand (in the store, no known source) (12) ──
  {
    id: "code-review",
    description:
      "Review the current diff for correctness bugs, risky patterns, and missing tests. Reports findings ranked by severity with suggested fixes.",
    source: "local:~/code/dotfiles/skills/code-review",
    daysAgo: 9,
  },
  {
    id: "release-notes",
    source: "local:~/code/dotfiles/skills/release-notes",
    description:
      "Draft release notes from merged PRs since the last tag. Groups changes by area, credits contributors, and flags breaking changes.",
    files: ["template.md"],
    daysAgo: 3,
  },
  {
    id: "api-conventions",
    description: "",
    daysAgo: 2,
  },
  {
    id: "design-review-checklist",
    description:
      "Checklist-driven review of a UI change: spacing, type scale, color contrast, focus states, empty and loading states, and reduced-motion support.",
    daysAgo: 6,
  },
  {
    id: "incident-runbook",
    description:
      "Walk through Acme's incident response runbook: declare, assign roles, open the war room channel, and draft the customer status update.",
    daysAgo: 19,
  },
  {
    id: "remotion-best-practices",
    description: "Best practices for Remotion: video creation in React, compositions, sequencing, audio, captions and rendering.",
    files: ["rules/", "rules/animations.md", "rules/audio.md", "rules/subtitles.md"],
    daysAgo: 45,
  },
  {
    id: "better-auth-best-practices",
    description:
      "Configure Better Auth server and client, set up database adapters, manage sessions, add plugins, and handle environment variables for TypeScript authentication.",
    daysAgo: 52,
  },
  {
    id: "caveman",
    description: "Ultra-compressed communication mode. Cuts token usage by speaking like a caveman while keeping full technical accuracy.",
    daysAgo: 14,
  },
  {
    id: "humanizer",
    description:
      "Rewrite AI-sounding text so it reads like the writer without changing what it says. Removes stock phrases, forced triads and filler.",
    license: "MIT",
    version: "4.0.0",
    daysAgo: 7,
  },
  {
    id: "stripe-best-practices",
    description: "Best practices for building Stripe integrations: Checkout, Payment Intents, webhooks, idempotency, and testing.",
    daysAgo: 36,
  },
  {
    id: "cloudflare-workers",
    description: "Build and deploy Cloudflare Workers with Wrangler: bindings, KV, D1, R2, Durable Objects and Queues.",
    daysAgo: 40,
  },
  {
    id: "zod-schemas",
    description: "Write zod schemas for API boundaries: parse, don't validate; share types between client and server; keep error messages user-friendly.",
    daysAgo: 11,
  },

  // ── Only in one agent (unmanaged) (3) ──
  {
    id: "commit-message-style",
    description:
      "Write commit messages in the team's Conventional Commits style with a 50-character subject, imperative mood, and a wrapped body explaining why.",
    only: ["claude-code"],
    daysAgo: 4,
  },
  {
    id: "cursor-rules-migrator",
    description: "Convert legacy .cursorrules files into Agent Skills with proper frontmatter and progressive disclosure.",
    only: ["cursor"],
    daysAgo: 25,
  },
  {
    id: "gemini-deploy-checklist",
    description: "Pre-deploy checklist for Cloud Run services: env vars, min instances, health checks, and rollback plan.",
    only: ["gemini-cli"],
    daysAgo: 16,
  },

  // ── Plugin skills (read-only) (3) ──
  {
    id: "figma-implement-design",
    plugin: "figma@claude-plugins-official",
    description: "Translate a Figma frame into production code that matches the design system, using the Figma MCP server for tokens and assets.",
    daysAgo: 30,
  },
  {
    id: "sentry-triage",
    plugin: "sentry@claude-plugins-official",
    description: "Triage a Sentry issue: pull the stack trace, find the offending commit, and propose a fix with a regression test.",
    daysAgo: 30,
  },
  {
    id: "vercel-deploy",
    plugin: "vercel@claude-plugins-official",
    description: "Deploy the current project to Vercel, stream the build logs, and report the preview URL.",
    daysAgo: 30,
  },
];

// ── Repositories the mock can "resolve" ─────────────────────────────────────

export interface RepoSkill {
  id: string;
  description: string;
  path?: string;
  invalid?: boolean;
}

export const REPOS: Record<string, RepoSkill[]> = {
  "anthropics/skills": [
    ...SEED_SKILLS.filter((s) => s.source === "anthropics/skills").map((s) => ({ id: s.id, description: s.description })),
    { id: "template-skill", description: "", invalid: true },
  ],
  "obra/superpowers": [
    ...SEED_SKILLS.filter((s) => s.source === "obra/superpowers").map((s) => ({ id: s.id, description: s.description })),
    { id: "writing-skills", description: "Use when creating new skills, editing existing skills, or verifying skills work before deployment." },
    { id: "subagent-driven-development", description: "Use when executing implementation plans with independent tasks in the current session, one fresh subagent per task." },
  ],
  "vercel-labs/agent-skills": [
    ...SEED_SKILLS.filter((s) => s.source === "vercel-labs/agent-skills").map((s) => ({ id: s.id, description: s.description })),
  ],
  "vercel-labs/next-skills": [
    { id: "next-best-practices", description: SEED_SKILLS.find((s) => s.id === "next-best-practices")!.description },
    { id: "next-cache-components", description: "Next.js 16 Cache Components: PPR, the use cache directive, cacheLife, cacheTag and updateTag." },
    { id: "next-upgrade", description: "Upgrade Next.js to the latest version following official migration guides and codemods." },
  ],
  "mattpocock/skills": [
    ...SEED_SKILLS.filter((s) => s.source === "mattpocock/skills").map((s) => ({ id: s.id, description: s.description })),
    { id: "write-a-prd", description: "Turn a rough idea into a product requirements document through a short interview, then file it as an issue." },
  ],
  "affaan-m/everything-claude-code": [
    ...SEED_SKILLS.filter((s) => s.source === "affaan-m/everything-claude-code").map((s) => ({ id: s.id, description: s.description })),
    { id: "continuous-learning", description: "Extract reusable patterns from sessions and save them as learned skills for future use." },
    { id: "eval-harness", description: "Formal evaluation framework for agent sessions implementing eval-driven development." },
  ],
  "supabase/agent-skills": [
    { id: "supabase-postgres-best-practices", description: SEED_SKILLS.find((s) => s.id === "supabase-postgres-best-practices")!.description },
  ],
  "remotion-dev/skills": [
    { id: "remotion-best-practices", description: SEED_SKILLS.find((s) => s.id === "remotion-best-practices")!.description },
  ],
  "wshobson/agents": [
    ...SEED_SKILLS.filter((s) => s.source === "wshobson/agents").map((s) => ({ id: s.id, description: s.description })),
    { id: "rag-implementation", description: "Build Retrieval-Augmented Generation systems with vector databases and semantic search for knowledge-grounded AI applications." },
    { id: "github-actions-templates", description: "Create production-ready GitHub Actions workflows for automated testing, building, and deploying applications." },
    { id: "k8s-security-policies", description: "Implement Kubernetes security policies including NetworkPolicy, PodSecurityPolicy, and RBAC for production-grade security." },
  ],
  "blader/humanizer": [{ id: "humanizer", description: SEED_SKILLS.find((s) => s.id === "humanizer")!.description }],
  "juliusbrussee/caveman": [
    { id: "caveman", description: SEED_SKILLS.find((s) => s.id === "caveman")!.description },
    { id: "caveman-commit", description: "Ultra-compressed commit message generator. Conventional Commits format, subject ≤50 chars, why over what." },
    { id: "caveman-review", description: "Ultra-compressed code review comments. One line per finding: location, problem, fix." },
  ],
  "better-auth/skills": [
    { id: "better-auth-best-practices", description: SEED_SKILLS.find((s) => s.id === "better-auth-best-practices")!.description },
  ],
  "callstackincubator/agent-skills": [
    { id: "react-native-best-practices", description: "Performance optimization for React Native: FPS, TTI, bundle size, memory leaks, re-renders and animations." },
    { id: "upgrading-react-native", description: "Upgrade React Native apps to newer versions using the Upgrade Helper, with dependency and native-module guidance." },
  ],
  "expo/skills": [
    { id: "building-native-ui", description: "Complete guide for building beautiful apps with Expo Router: styling, components, navigation, animations and native tabs." },
    { id: "expo-deployment", description: "Deploy Expo apps to the App Store, Play Store and web hosting with EAS." },
    { id: "upgrading-expo", description: "Upgrade Expo SDK versions and fix dependency issues." },
  ],
  "stripe/ai": [
    { id: "stripe-best-practices", description: "Best practices for building Stripe integrations: Checkout, Payment Intents, webhooks, idempotency, and testing." },
  ],
  "cloudflare/skills": [
    { id: "cloudflare-workers", description: "Build and deploy Cloudflare Workers with Wrangler: bindings, KV, D1, R2, Durable Objects and Queues." },
    { id: "durable-objects", description: "Design stateful serverless apps with Durable Objects: coordination, WebSockets, alarms and SQLite storage." },
  ],
};

/** Local folders and zips the mock knows about (paths from the demo file picker). */
export const LOCAL_SOURCES: Record<string, { kind: "local" | "zip"; skills: RepoSkill[] }> = {
  "~/Downloads/team-skills": {
    kind: "local",
    skills: [
      { id: "oncall-handbook", path: "oncall-handbook", description: "Answer questions about the on-call rotation, escalation paths, and paging policy using the team handbook." },
      { id: "sql-style", path: "sql-style", description: "Enforce the team's SQL style: lowercase keywords, CTEs over subqueries, explicit column lists, snake_case aliases." },
      { id: "release-checklist", path: "release-checklist", description: "Step-by-step release checklist: freeze, changelog, version bump, tag, publish, announce." },
      { id: "scratchpad", path: "scratchpad", description: "", invalid: true },
    ],
  },
  "~/Downloads/release-notes-skill.zip": {
    kind: "zip",
    skills: [{ id: "release-notes-writer", path: "", description: "Turn a list of merged pull requests into crisp, user-facing release notes grouped by theme." }],
  },
};

// ── skills.sh directory ─────────────────────────────────────────────────────

const INSTALLS: Record<string, number> = {
  "vercel-labs/agent-skills/react-best-practices": 184_210,
  "anthropics/skills/frontend-design": 162_884,
  "vercel-labs/agent-skills/web-design-guidelines": 141_032,
  "anthropics/skills/pdf": 98_540,
  "anthropics/skills/skill-creator": 92_118,
  "obra/superpowers/brainstorming": 88_407,
  "obra/superpowers/systematic-debugging": 81_993,
  "anthropics/skills/docx": 74_350,
  "vercel-labs/next-skills/next-best-practices": 71_204,
  "anthropics/skills/xlsx": 66_871,
  "anthropics/skills/pptx": 61_502,
  "obra/superpowers/test-driven-development": 58_930,
  "anthropics/skills/mcp-builder": 55_116,
  "supabase/agent-skills/supabase-postgres-best-practices": 49_870,
  "obra/superpowers/writing-plans": 47_311,
  "remotion-dev/skills/remotion-best-practices": 44_008,
  "expo/skills/building-native-ui": 39_215,
  "anthropics/skills/webapp-testing": 37_644,
  "mattpocock/skills/tdd": 35_902,
  "vercel-labs/agent-skills/composition-patterns": 33_480,
  "obra/superpowers/executing-plans": 31_066,
  "callstackincubator/agent-skills/react-native-best-practices": 29_715,
  "anthropics/skills/canvas-design": 27_391,
  "better-auth/skills/better-auth-best-practices": 26_120,
  "mattpocock/skills/grill-me": 24_877,
  "obra/superpowers/requesting-code-review": 23_604,
  "stripe/ai/stripe-best-practices": 22_948,
  "wshobson/agents/async-python-patterns": 21_330,
  "anthropics/skills/theme-factory": 20_517,
  "anthropics/skills/algorithmic-art": 19_206,
  "obra/superpowers/verification-before-completion": 18_772,
  "cloudflare/skills/cloudflare-workers": 17_390,
  "blader/humanizer/humanizer": 16_844,
  "anthropics/skills/web-artifacts-builder": 15_901,
  "obra/superpowers/using-git-worktrees": 15_233,
  "wshobson/agents/rag-implementation": 14_102,
  "mattpocock/skills/improve-codebase-architecture": 13_588,
  "anthropics/skills/brand-guidelines": 12_960,
  "juliusbrussee/caveman/caveman": 12_431,
  "anthropics/skills/doc-coauthoring": 11_872,
  "expo/skills/expo-deployment": 11_050,
  "obra/superpowers/dispatching-parallel-agents": 10_644,
  "vercel-labs/next-skills/next-cache-components": 9_870,
  "mattpocock/skills/handoff": 9_402,
  "wshobson/agents/github-actions-templates": 8_955,
  "anthropics/skills/internal-comms": 8_310,
  "mattpocock/skills/prototype": 7_944,
  "cloudflare/skills/durable-objects": 7_021,
  "anthropics/skills/slack-gif-creator": 6_734,
  "wshobson/agents/python-performance-optimization": 6_402,
  "expo/skills/upgrading-expo": 5_877,
  "callstackincubator/agent-skills/upgrading-react-native": 5_210,
  "juliusbrussee/caveman/caveman-commit": 4_988,
  "vercel-labs/next-skills/next-upgrade": 4_560,
  "mattpocock/skills/grill-with-docs": 4_311,
  "wshobson/agents/grafana-dashboards": 3_902,
  "obra/superpowers/receiving-code-review": 3_640,
  "wshobson/agents/k8s-security-policies": 2_877,
  "juliusbrussee/caveman/caveman-review": 2_455,
  "vercel-labs/agent-skills/vercel-deploy-claimable": 2_101,
};

export const DIRECTORY = Object.entries(INSTALLS).map(([id, installs]) => {
  const parts = id.split("/");
  const name = parts[parts.length - 1];
  const source = parts.slice(0, -1).join("/");
  const repo = REPOS[source]?.find((r) => r.id === name);
  return { id, name, source, installs, description: repo?.description ?? "" };
});

// ── SKILL.md bodies ─────────────────────────────────────────────────────────

const BODIES: Record<string, string> = {
  pdf: `# PDF Processing Guide

## Overview

This guide covers essential PDF processing operations using Python libraries and command-line tools. For advanced features, JavaScript libraries, and detailed examples, see [reference.md](reference.md). If you need to fill out a PDF form, read [forms.md](forms.md) and follow its instructions.

## Quick start

\`\`\`python
from pypdf import PdfReader, PdfWriter

# Read a PDF
reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")

# Extract text
text = ""
for page in reader.pages:
    text += page.extract_text()
\`\`\`

## Python libraries

### pypdf: basic operations

Use pypdf for merging, splitting, rotating and encrypting. It is pure Python and has no system dependencies.

\`\`\`python
writer = PdfWriter()
for path in ["a.pdf", "b.pdf", "c.pdf"]:
    for page in PdfReader(path).pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as out:
    writer.write(out)
\`\`\`

### pdfplumber: text and tables

pdfplumber keeps the layout, which makes it the best choice for tables and for text where column order matters.

\`\`\`python
import pdfplumber

with pdfplumber.open("report.pdf") as pdf:
    for page in pdf.pages:
        for table in page.extract_tables():
            print(table)
\`\`\`

### reportlab: create new PDFs

Build documents from scratch with the low-level Canvas API, or with Platypus when you want flowing paragraphs, tables and page templates.

## Common tasks

| Task | Best tool | Notes |
|------|-----------|-------|
| Merge PDFs | pypdf | Keeps bookmarks |
| Split pages | pypdf | One file per page or ranges |
| Extract tables | pdfplumber | \`page.extract_tables()\` |
| Create PDFs | reportlab | Canvas or Platypus |
| OCR scanned pages | pytesseract | Convert to images first |
| Command-line merge | qpdf | \`qpdf --empty --pages a.pdf b.pdf -- out.pdf\` |

## Command-line tools

- **pdftotext** (poppler): fast text extraction, use \`-layout\` to keep columns.
- **qpdf**: merge, split, rotate, decrypt; never re-encodes content.
- **pdftk**: older but still handy for bursting and stamping.

\`\`\`bash
pdftotext -layout input.pdf output.txt
qpdf input.pdf --pages . 1-5 -- first-five.pdf
\`\`\`

## Filling forms

1. Run \`scripts/extract_form_field_info.py\` to list the fillable fields.
2. Write the values to \`field_values.json\`.
3. Run \`scripts/fill_fillable_fields.py\` and check the output visually.
4. If the form has no fillable fields, convert pages to images with \`scripts/convert_pdf_to_images.py\` and annotate them instead.

> **Important:** never flatten a form before verifying every field rendered correctly.

## Scanned documents

Scanned PDFs contain images, not text. Convert each page to an image, run OCR, then rebuild a searchable PDF if the user needs one:

\`\`\`python
from pdf2image import convert_from_path
import pytesseract

for i, image in enumerate(convert_from_path("scan.pdf", dpi=300)):
    print(f"--- page {i + 1} ---")
    print(pytesseract.image_to_string(image))
\`\`\`

## Checks before you finish

- [ ] Page count matches the source documents
- [ ] Text is selectable where the user expects it
- [ ] Bookmarks and links survived the merge
- [ ] File size is reasonable (re-compress images if not)
`,
  "systematic-debugging": `# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** always find the root cause before attempting fixes. Symptom fixes are failure.

## The four phases

You must complete each phase before proceeding to the next.

### Phase 1: Root cause investigation

1. **Read error messages carefully.** They often contain the exact solution.
2. **Reproduce consistently.** If you can't trigger it reliably, gather more data.
3. **Check recent changes.** \`git diff\`, recent commits, new dependencies.
4. **Trace data flow.** See [root-cause-tracing.md](root-cause-tracing.md).

### Phase 2: Pattern analysis

- Find working examples in the same codebase.
- Compare against references; read them completely.
- List every difference, however small.

### Phase 3: Hypothesis and testing

Form a single hypothesis. Test it with the smallest possible change. One variable at a time.

### Phase 4: Implementation

- [ ] Create a failing test case
- [ ] Implement a single fix
- [ ] Verify the fix and run the full suite

## Red flags

If you catch yourself thinking *"just try changing X and see if it works"*, stop and return to Phase 1.
`,
  "frontend-design": `This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

## Design thinking

Before coding, understand the context and commit to a **bold** aesthetic direction:

- **Purpose:** what problem does this interface solve? Who uses it?
- **Tone:** brutally minimal, editorial, retro-futuristic, soft and organic, industrial…
- **Differentiation:** what makes this unforgettable?

## Frontend aesthetics guidelines

- **Typography:** choose fonts that are beautiful, unique, and interesting. Pair a distinctive display font with a refined body font.
- **Color and theme:** commit to a cohesive palette. Dominant colors with sharp accents outperform timid, evenly distributed palettes.
- **Motion:** prioritize CSS-only solutions. Focus on high-impact moments: one well-orchestrated page load beats scattered micro-interactions.
- **Spatial composition:** unexpected layouts, asymmetry, overlap, generous negative space *or* controlled density.

\`\`\`css
:root {
  --ink: #14110f;
  --paper: #f4efe6;
  --accent: oklch(0.62 0.19 35);
}
\`\`\`

Remember: match implementation complexity to the aesthetic vision.
`,
};

function titleCase(id: string) {
  return id
    .split("-")
    .map((w) => (w.length <= 3 && /^(pdf|sql|mcp|api|tdd|ui|ux|rls)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function bodyFor(id: string, description: string, files: string[]): string {
  if (BODIES[id]) return BODIES[id];
  const title = titleCase(id);
  const refs = files.filter((f) => f.endsWith(".md") && !f.includes("/"));
  const scripts = files.filter((f) => /\.(py|sh|js|ts)$/.test(f));
  let md = `# ${title}\n\n${description ? "" : "_No description yet._\n\n"}## When to use\n\n`;
  md += `- The task clearly matches the description above.\n- The user mentions ${title.toLowerCase()} by name.\n- A previous step produced output that this skill can refine.\n\n`;
  md += `## Workflow\n\n1. Gather context: read the relevant files and confirm the goal in one sentence.\n2. Make a short plan and share it before editing anything.\n3. Apply the changes in small, verifiable steps.\n4. Verify: run the checks below and report what passed.\n\n`;
  if (scripts.length) {
    md += `## Scripts\n\n`;
    for (const s of scripts) md += `- \`${s}\`\n`;
    md += `\n\`\`\`bash\npython ${scripts[0]} --help\n\`\`\`\n\n`;
  }
  if (refs.length) {
    md += `## References\n\nLoad these only when needed:\n\n`;
    for (const r of refs) md += `- [${r}](${r})\n`;
    md += `\n`;
  }
  md += `## Checks\n\n- [ ] Output matches the conventions in this repo\n- [ ] No unrelated changes\n- [ ] Summary lists anything left undone\n`;
  return md;
}

export function fileText(skillId: string, path: string, description: string): string {
  const base = path.split("/").pop() ?? path;
  if (base === "LICENSE.txt") {
    return `Copyright (c) 2025\n\nLicensed under the terms described in the repository's LICENSE file.\nRedistribution of this skill is subject to those terms.\n`;
  }
  if (base.endsWith(".py")) {
    const fn = base.replace(/\.py$/, "");
    return `#!/usr/bin/env python3\n"""${fn.replace(/_/g, " ")} for the ${skillId} skill."""\n\nimport argparse\nimport json\nimport sys\n\n\ndef main() -> int:\n    parser = argparse.ArgumentParser(description=__doc__)\n    parser.add_argument("input", help="input file")\n    parser.add_argument("--json", action="store_true", help="emit JSON")\n    args = parser.parse_args()\n\n    result = {"input": args.input, "ok": True}\n    if args.json:\n        json.dump(result, sys.stdout, indent=2)\n    else:\n        print(f"Processed {args.input}")\n    return 0\n\n\nif __name__ == "__main__":\n    raise SystemExit(main())\n`;
  }
  if (base.endsWith(".sh")) {
    return `#!/usr/bin/env bash\nset -euo pipefail\n\n# ${base}: helper for ${skillId}\nfor f in "$@"; do\n  echo "checking $f"\ndone\n`;
  }
  if (base.endsWith(".js") || base.endsWith(".ts")) {
    return `// ${base}: part of the ${skillId} skill\nexport function run(input) {\n  return { input, ok: true };\n}\n`;
  }
  if (base.endsWith(".html")) {
    return `<!doctype html>\n<html>\n  <head><meta charset="utf-8" /><title>${skillId}</title></head>\n  <body>\n    <main id="app"></main>\n  </body>\n</html>\n`;
  }
  return `# ${titleCase(base.replace(/\.md$/, ""))}\n\nSupporting notes for **${skillId}**. ${description}\n\n## Details\n\n- Keep SKILL.md short; put long reference material here.\n- The agent loads this file only when the task needs it.\n`;
}
