# Fase 19 — COMPLETA (sem patches de código adicionais)

## Auditoria
| Onde | Limita jogadores por partida? |
|---|---|
| `t15Engine.normalizeConfig` | Não. Jogos com regras: aceita `rules.min..rules.max` (gameRules). |
| `t15Engine.enforceGameRules` | Não. Usa `gameRules`; não mexe em `max_players`. |
| `ga15SyncFix.ga15EnsureRoomLocked` | Não. `max_players: n` com `n = group.playerIds.length` (jogadores reais da partida T15). Não lê `games.maxPlayersPerRoom`. |
| SQL `t15_matches` + funções | Não. `capacity` 1–16, tudo por `capacity`/`cardinality`. |
| `ga16MatchReport` (Fase 18) | Não. Máximo vem do `gameRules`. |

## Ficheiros da Fase 19
- `backend/services/gameRules.js` — NeonRush 2–8
- `app/src/main/java/com/gamearena/ui/CreateTournamentActivity.kt` — espelho das regras
- `sql/ga19-max-players-salas.sql` — opcional, só para SALAS LIVRES (ver abaixo)

## Salas livres (fora dos torneios)
`routes/rooms.js:293` → `allowed = Number(game.maxPlayersPerRoom) || 2`. O `2` é o valor por omissão seguro
(jogo sem valor na tabela = 1x1) e fica como está. O limite real vem da tabela `games`; se o NeonRush/Flappy/Impostor
estiverem abaixo de 8/12/10, corre `sql/ga19-max-players-salas.sql`.
