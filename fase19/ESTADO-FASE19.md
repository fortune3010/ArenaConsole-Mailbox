# Fase 19 — estado da auditoria (torneios com 8+ jogadores por partida)

## Confirmado — sem limite fixo (não precisa de patch)
| Onde | Resultado |
|---|---|
| `t15Engine.normalizeConfig` | Quando o jogo tem regras em `gameRules`, o pedido do criador só é aceite entre `rules.min` e `rules.max`. O tecto `games.maxPlayersPerRoom` só se aplica a jogos SEM regras. NeonRush passa a aceitar 2–8 com o `gameRules.js` desta fase. |
| `t15Engine.enforceGameRules` | Limita `playersPerMatch` a `rules.min..rules.max` (vem do `gameRules`, nada fixo). **Não mexe em `max_players`** (total do torneio). |
| `t15Engine.buildBracket` / `planRounds` | Usam `config.playersPerMatch` sem limite. |
| SQL `t15_matches` | `capacity` 1–16. `ga16_atomic_claims`, `t15_submit_claim`, `t15_report_result` e `ga16_timeout_decide` usam `capacity`/`cardinality(player_ids)`, sem 4 fixo. |
| `ga16MatchReport.recordBubble` | Já usa `gameRules` (Fase 18) → NeonRush 8, Impostor 10. |

## Por confirmar — BLOQUEADO (falta informação)
1. **`backend/services/ga15SyncFix.js`**: só chegaram as linhas onde é chamado, não o código. É ele que cria as salas de torneio no all-ready. Se gravar `rooms.max_players` com um valor fixo ou com `games.maxPlayersPerRoom`, uma partida de NeonRush com 8 jogadores falha.
2. **`backend/routes/rooms.js:293`**: `const allowed = Number(game.maxPlayersPerRoom) || 2;` limita as salas pelo valor da tabela `games`. A query a `games` só devolveu 8ball (2), ludo (2) e fruit (4); falta o NeonRush.

## O que correr
```
grep -n "max_players\|maxPlayers\|capacity\|playersPerMatch\|insert\|from('rooms')" backend/services/ga15SyncFix.js
sed -n '280,300p' backend/routes/rooms.js
```
```sql
select id, "maxPlayersPerRoom" from games where id ilike '%neon%' or id ilike '%flappy%' or id ilike '%impostor%';
```

## Correção provável (só depois de confirmar)
- Se o NeonRush tiver `maxPlayersPerRoom` < 8:
  `update games set "maxPlayersPerRoom" = 8 where id = '<id do neonrush>';`
- Se o `ga15SyncFix` tiver um 4 fixo: patch nesse ficheiro (entregue quando o código chegar).
