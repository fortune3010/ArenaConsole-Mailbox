# Contrato Game Arena ↔ Arena Console (protocolo 1, revisão 20.2)

Completa o `fase20-1/CONTRATO-ARENA-CONSOLE.md`. O que mudou:

## Intent START_GAME
| Campo | Valor |
|---|---|
| action | `com.gamearena.console.START_GAME` |
| package | `com.gamearena.console` (**novo**: `setPackage`, nenhuma outra app recebe a partida) |
| ClipData + `FLAG_GRANT_READ_URI_PERMISSION` | a ISO em `content://` (igual à 20.1) |
| `arena_auth` (**novo**) | `PendingIntent` imutável criado pela Game Arena; nunca é enviado |

O Arena Console aceita a partida só se:
1. `arena_auth.getCreatorPackage()` for `com.gamearena`. O sistema Android preenche este valor, e outra app não o consegue falsificar;
2. a `com.gamearena` instalada estiver assinada com um dos SHA-256 de `arena_launcher_certs_sha256`;
3. houver ISO e os dados de rede forem válidos (`protocol_version` 1, servidor `https://gamer-fortune.onrender.com`).

Caso contrário, abre o portão "Abre pela Game Arena" e não carrega o emulador.

## Túnel ad hoc (namespace `/console`, path `/ws`, depois de `emu_join`)
| Sentido | Evento | Dados |
|---|---|---|
| emulador → servidor | `tun_open` | `{s: int, p: 27312 \| 27313}` |
| nos dois sentidos | `tun_data` | `{s: int, b: binário}` (máx. 128 KB por mensagem) |
| nos dois sentidos | `tun_close` | `{s: int}` |

- **27312:** servidor adhocctl (PRO online v1).
- **27313:** relay aemu_postoffice em TCP.
- **Isolamento:** o servidor cria uma instância por sala. Os streams de uma sala nunca veem os de outra.
- **Limites:** no máximo 32 streams por emulador.

## Resultado
| Caso | Regra |
|---|---|
| `emu_result {winnerRole: <adversário>}` | Admitir a derrota ou desistir. Conta **logo** (`reason: forfeit`). |
| `emu_result {winnerRole: <eu>}` ou `draw` | Só conta quando o outro emulador enviar o mesmo (`reason: agreed`). |
| Emulador sai a meio e não volta em 120 s, com o adversário ligado | DNF: perde quem saiu (`reason: dnf`). Não se aplica a quem já declarou vitória ou empate. |

- **Aviso aos jogadores:** o servidor envia `console_over {winnerRole, reason}` ao lobby e aos dois emuladores.
- **GA16:** o servidor chama `opts.onFinish({code, winnerSeat, players: 2, seats})` só para vitórias (não para empates).
