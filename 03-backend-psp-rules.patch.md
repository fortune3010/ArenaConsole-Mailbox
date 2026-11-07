# GA20_ARENA · PATCH 3: Backend Reconhece Jogos PSP (Torneios T15)

## Contexto
O backend T15 (`t15Engine.js` linha 59) usa `gameRules.findRules()` para validar que um jogo é multiplayer e suporta torneios.

Atualmente, `gameRules.js` só tem jogos HTML5 (dama, ludo, bubble, etc.).

**Solução:** Adicionar jogos PSP ao `gameRules.js` com `mode: "pvp"`, `min: 2`, `max: 2` (1v1).

## Ficheiros afetados
- `backend/services/gameRules.js`

---

## PATCH

No ficheiro `backend/services/gameRules.js`, localiza a lista de jogos (cerca da linha 10-40):

<!-- must(find_exact) -->
```javascript
const GAMES = [
  { key: 'dama', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'airhockey', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'ludo', mode: 'pvp', min: 2, max: 4, playersPerMatch: 4 },
  { key: 'pool', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'fruit', mode: 'pvp', min: 2, max: 4, playersPerMatch: 2 },
  { key: 'flappy', mode: 'pvp', min: 2, max: 4, playersPerMatch: 2 },
  { key: 'galinhas', mode: 'pvp', min: 2, max: 4, playersPerMatch: 2 },
  { key: 'bubble', mode: 'pvp', min: 2, max: 4, playersPerMatch: 4 },
  { key: 'impostor', mode: 'pvp', min: 4, max: 10, playersPerMatch: 8 },
  { key: 'neonrush', mode: 'pvp', min: 2, max: 12, playersPerMatch: 2 },
  { key: 'hockey', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 }
];
```
<!-- must(end) -->

Adiciona os jogos PSP **NO FIM** da lista (antes do `];`):

<!-- must(replace_with) -->
```javascript
const GAMES = [
  { key: 'dama', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'airhockey', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'ludo', mode: 'pvp', min: 2, max: 4, playersPerMatch: 4 },
  { key: 'pool', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'fruit', mode: 'pvp', min: 2, max: 4, playersPerMatch: 2 },
  { key: 'flappy', mode: 'pvp', min: 2, max: 4, playersPerMatch: 2 },
  { key: 'galinhas', mode: 'pvp', min: 2, max: 4, playersPerMatch: 2 },
  { key: 'bubble', mode: 'pvp', min: 2, max: 4, playersPerMatch: 4 },
  { key: 'impostor', mode: 'pvp', min: 4, max: 10, playersPerMatch: 8 },
  { key: 'neonrush', mode: 'pvp', min: 2, max: 12, playersPerMatch: 2 },
  { key: 'hockey', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  
  // GA20_ARENA: jogos PSP (Arena Console) — todos 1v1
  { key: 'psp_tekken', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'psp_naruto', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'psp_dragonball', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'psp_godofwar', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'psp_gta', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'psp_nfs', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'psp_pes', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 },
  { key: 'psp_wwe', mode: 'pvp', min: 2, max: 2, playersPerMatch: 2 }
];
```
<!-- must(end) -->

---

## Resultado
✅ O backend aceita criar torneios com jogos PSP (ex: `gameKey: "psp_tekken"`).  
✅ O `t15Engine.js` (linha 59) encontra as regras e valida `playersPerMatch=2`.  
✅ O frontend pode listar jogos PSP no `CreateTournamentActivity` (se o catálogo tiver `compatTitle` marcado como multiplayer).

---

## Como testar
1. Aplica este patch no backend.
2. Faz deploy (`git push render main`).
3. No app Android, cria um torneio com um jogo PSP.
4. O servidor deve aceitar (sem erro "jogo não suportado").

---

## NOTA: O `gameKey` tem de coincidir com o banco de dados
O `console_games.game_id` (ex: `"psp_tekken"`) tem de ser o mesmo que o `gameKey` no `gameRules.js`.
Se o catálogo PSP usar IDs diferentes (ex: `"tekken_6"`), ajusta a lista acima para coincidir.
