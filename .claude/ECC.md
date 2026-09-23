# ECC — påslaget

Skills, agents och commands från [affaan-m/ECC](https://github.com/affaan-m/ecc),
commit `dd6ee538aee0f548d4a6b520118f875431fd749e`.

De ligger i `.claude/skills`, `.claude/agents` och `.claude/commands` och
styr varje Claude-session i det här repot. Hooks, `rules/` och `install.sh`
från ECC är inte med — bara de tre mapparna. Husreglerna i `CLAUDE.md` går
före ECC:s allmänna där de krockar.

Innehåll: 292 skills, 68 agents, 94 commands — 746 filer.

Genomgånget före kopieringen: inga riktiga nycklar (namn som `ANTHROPIC_API_KEY`
förekommer i säkerhets-skills som beskriver vad man letar efter), inga
destruktiva kommandon i skripten, och inga utgående adresser utöver
platshållare och fal.ai, github.com och iconify. Det är en översikt, inte en
granskning av alla 746 filerna.

Värt att veta om enskilda filer: `skills/configure-ecc/SKILL.md` säger åt
agenten att köra `node scripts/setup.js --yes` och
`npx --yes --package ecc-universal ecc install` utan att fråga. Den kör bara om
någon ber om ECC-uppsättning, men den finns.

Kontrollerat före påslaget: alla 68 agenter och alla 292 skills har giltig
frontmatter (namn och beskrivning), inga dubbla namn, och modellerna är
`sonnet`, `opus` eller `haiku`. Två krockar med det som finns inbyggt:
`commands/code-review.md` och `skills/security-review` skuggar de inbyggda
kommandona med samma namn.

Beskrivningarna är tillsammans runt 24 000 tokens, som laddas i varje session.
Behövs bara en del av dem — till exempel de som rör JavaScript, webb, tester,
granskning och säkerhet — går resten att ta bort ur `.claude/skills`.

Uppdatering görs genom att hämta om de tre mapparna från repot ovan, inte
genom att ändra filerna här.
