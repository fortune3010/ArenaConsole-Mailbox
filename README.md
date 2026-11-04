# GameArena — entrega Fases 16 a 19

Cada pasta repete a estrutura do repo `Arenaapk` (`app/src/main/...`, `backend/...`, `scripts/`).
Copiar o conteúdo de uma fase para a raiz do `~/GameArena` põe cada ficheiro no sítio certo.

## Ordem de aplicação
1. **fase16** — popup premium, card do Histórico, redirect
2. **fase18** — histórico + XP no servidor (correr `fase18/sql/ga18-xp-to-next.sql` no Supabase)
3. **fase17** — chat de voz (o `GameWebViewActivity.kt` da fase17 substitui o da fase16)
4. **fase19** — NeonRush 8 por partida (depende da fase18)

## Scripts (na raiz do repo GameArena, por esta ordem)
```
node scripts/ga16-unify-html.js
node scripts/ga16-unify-html-2.js
node scripts/ga17-voice-inject.js
node scripts/ga17-register-voice.js
```
Todos usam `must()` e são idempotentes.
