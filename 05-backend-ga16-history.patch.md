# GA20_ARENA · PATCH 5: Backend Grava Histórico de Partidas PSP (GA16)

## Contexto
O `console-namespace.js` (linha 82) já chama `opts.onFinish` quando uma partida acaba (com `winnerSeat`, `players`, `seats`).

O `ga16MatchReport.js` (linha 84) implementa `onFinish` para gravar histórico de jogos HTML5 (bubble, flappy).

**Solução:** Registar o handler `onFinish` do `console-namespace` para também gravar histórico PSP (via `ga16History.recordRoomResult`).

Isso replica o fluxo do HTML5 (GameWebViewActivity linha 964: `ApiClient.recordMatchResult`), mas do lado do servidor.

## Ficheiros afetados
- `backend/services/console-namespace.js` (1 linha alterada)
- `backend/server.js` (registar o handler)

---

## PATCH

### PASSO 1: No ficheiro `backend/services/console-namespace.js`, localiza onde o namespace é criado (linha ~5):

<!-- must(find_exact) -->
```javascript
/**
 * backend/services/console-namespace.js — GA20_ARENA (Fase 20.2.2): sala de matchmaking do Arena Console.
 *
 * Uso:  require('./services/console-namespace')(io, { onFinish })   // namespace '/console', path '/ws'
 */
```
<!-- must(end) -->

✅ **NÃO ALTERA NADA AQUI** — o `onFinish` já existe (linha 5 do comentário).

---

### PASSO 2: No ficheiro `backend/server.js`, localiza onde o `console-namespace` é registado:

Procura por `require('./services/console-namespace')` (deve estar perto do final do ficheiro, depois do `ga16MatchReport`):

<!-- must(find_exact) -->
```javascript
// GA20_ARENA (Fase 20.2.2): sala de matchmaking do Arena Console
const consoleNamespace = require('./services/console-namespace');
consoleNamespace(io);
```
<!-- must(end) -->

Substitui por (passa o handler `onFinish` que grava histórico):

<!-- must(replace_with) -->
```javascript
// GA20_ARENA (Fase 20.2.2): sala de matchmaking do Arena Console
const consoleNamespace = require('./services/console-namespace');
const ga16History = require('./services/ga16History'); // GA16_HISTORY: grava histórico + XP

consoleNamespace(io, {
  onFinish: async (info) => {
    // GA20_GA16: grava histórico de partida PSP (mesmo fluxo do bubble/flappy)
    // info = { code, winnerSeat, players, seats }
    try {
      const supabase = require('./supabaseClient')();
      
      // Busca o game_id da sala (rooms.config.gameId ou console_games via room_players)
      const { data: room, error: roomErr } = await supabase
        .from('rooms')
        .select('id, code, config')
        .eq('code', info.code)
        .maybeSingle();
      
      if (roomErr || !room) {
        console.error('[console] GA16: sala não encontrada:', info.code, roomErr?.message);
        return;
      }
      
      let cfg = room.config;
      if (typeof cfg === 'string') {
        try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; }
      }
      
      const gameId = (cfg && cfg.gameId) || 'psp_unknown';
      
      // Grava histórico via ga16History (mesmo que ga16MatchReport usa)
      await ga16History.recordRoomResult(supabase, {
        code: info.code,
        game: gameId,
        winnerSeat: info.winnerSeat,
        players: info.players,
        seats: info.seats
      });
      
      console.log('[console] GA16: histórico gravado:', info.code, gameId, 'winner:', info.winnerSeat);
    } catch (e) {
      console.error('[console] GA16 onFinish erro:', e.message || e);
    }
  }
});
```
<!-- must(end) -->

---

## Resultado
✅ Quando a partida PSP acabar, o servidor grava histórico para **ambos** os jogadores.  
✅ O `ga16History.recordRoomResult` já tem a lógica de deduplicação (linha 139 do `userHistory.js`: "sala já gravada nos últimos 15 min").  
✅ XP é atribuído automaticamente (vitória 100, derrota 25, empate 50).  
✅ O histórico aparece na aba **Histórico** da Game Arena (mesmo fluxo do HTML5).

---

## Como testar
1. Aplica este patch no backend.
2. Faz deploy (`git push render main`).
3. Joga uma partida PSP até ao fim (o servidor envia `console_over`).
4. Verifica na BD: `SELECT * FROM user_game_history WHERE game_id LIKE 'psp_%' ORDER BY played_at DESC LIMIT 5;`
5. Abre a aba **Histórico** no app → deve aparecer a partida PSP.

---

## NOTA: Ligação com o patch 04
O **patch 04** (`ConsoleLobbyActivity`) escuta `console_over` e mostra "Como correu?" ao utilizador.  
Este patch (05) grava o histórico **no servidor** quando `emu_result` chegar dos 2 emuladores.  

São **complementares:**
- ✅ Servidor grava via `ga16History` (sempre confiável).
- ✅ Cliente mostra diálogo de confirmação (UX melhor para o utilizador).
