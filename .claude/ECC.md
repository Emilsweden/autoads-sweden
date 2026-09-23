# ECC — ett urval, påslaget

Från [affaan-m/ECC](https://github.com/affaan-m/ecc), commit
`dd6ee538aee0f548d4a6b520118f875431fd749e`. Bara det som passar det här
projektet: en webbapp i vanlig JavaScript, en Cloudflare-worker med D1,
Playwright-tester och riktiga kundbokningar.

Allt av ECC laddas i varje session. Hela paketet — 292 skills, 68 agenter,
94 kommandon — kostade runt 24 000 tokens per session, och de flesta
beskrivningarna fick ändå inte plats i listan. Urvalet nedan är runt 2 600.

## Det som finns

**Skills (23):** tdd-workflow, verification-loop, e2e-testing,
ai-regression-testing, error-handling, api-design, backend-patterns,
database-migrations, accessibility, browser-qa, canary-watch,
deployment-patterns, github-ops, inherit-legacy-style, safety-guard,
click-path-audit, production-audit, strategic-compact, context-budget,
token-budget-advisor, ecc-guide, intent-driven-development,
make-interfaces-feel-better.

**Agenter (14):** planner, architect, code-architect, code-explorer,
code-reviewer, security-reviewer, tdd-guide, e2e-runner, typescript-reviewer,
silent-failure-hunter, pr-test-analyzer, performance-optimizer, doc-updater,
a11y-architect.

`planner` och `architect` kör på Opus, som tar av Pro-gränsen fortast. Övriga
kör på Sonnet, utom `doc-updater` som kör på Haiku.

**Kommandon (7):** plan, feature-dev, review-pr, test-coverage, checkpoint,
update-docs, aside.

## Ändrat mot ECC

- `commands/review-pr.md` startar inte längre `comment-analyzer`,
  `type-design-analyzer` och `code-simplifier` — de är bortvalda, och varje
  agent i en granskning tar av Pro-gränsen.
- ECC:s `code-review` och `security-review` är bortvalda, så att de inbyggda
  kommandona med samma namn fungerar.
- Hooks, `rules/` och `install.sh` från ECC är inte med. Husreglerna i
  `CLAUDE.md` går före ECC:s allmänna där de krockar.

## Få tillbaka något

Allt som valdes bort finns kvar i historiken. En enskild skill tas tillbaka med

    git checkout 2391f39 -- .claude/skills/<namn>

och en agent eller ett kommando på samma sätt (`.claude/agents/<namn>.md`,
`.claude/commands/<namn>.md`).

## Innan det slogs på

Genomgånget: inga riktiga nycklar, inga destruktiva kommandon i skripten, inga
utgående adresser utöver platshållare och välkända tjänster. Alla agenter och
skills har giltig frontmatter och unika namn.
