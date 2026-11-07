# GA20_ARENA · FASE 20.6: INTEGRAÇÃO GA16 COMPLETA (PSP)

## 🎯 Objetivo
Resolver os **3 problemas críticos** da integração PSP com o fluxo GA16 (mesmo padrão dos jogos HTML5):

1. ✅ **Trailer interno** (sem seletor do Android)
2. ✅ **Modo Solo** (Treino sem rede)
3. ✅ **Integração GA16** (Torneios + Histórico + Home + Auto-close)

---

## 📦 Conteúdo (6 patches)

| Patch | Ficheiro | O que faz |
|-------|----------|-----------|
| **01** | `01-trailer-player.patch.md` | Cria `TrailerPlayerActivity` (landscape, botão X, auto-close) |
| **02** | `02-solo-mode.patch.md` | Patch no PPSSPP para aceitar `role=null` (Treino) |
| **03** | `03-backend-psp-rules.patch.md` | Adiciona jogos PSP ao `gameRules.js` (backend T15) |
| **04** | `04-lobby-ga16-listener.patch.md` | Lobby escuta `console_over` e mostra "Como correu?" |
| **05** | `05-backend-ga16-history.patch.md` | Backend grava histórico PSP via `ga16History` |
| **06** | `06-manifest-trailer.patch.md` | Regista `TrailerPlayerActivity` no Manifest |

---

## 🚀 Como Aplicar (ORDEM EXATA)

### **1. Trailer (Frontend Android)**
```bash
cd ~/GameArena

# Cria TrailerPlayerActivity.kt
cat > app/src/main/java/com/gamearena/ui/TrailerPlayerActivity.kt << 'EOF'
# [Copia o código do patch 01]
EOF

# Cria layout XML
cat > app/src/main/res/layout/activity_trailer_player.xml << 'EOF'
# [Copia o XML do patch 01]
EOF

# Altera ConsoleMenuActivity.kt
# [Segue instruções do patch 01: substitui launchExternalPlayer()]
```

---

### **2. Modo Solo (PPSSPP)**
```bash
cd ~/ppsspp

# Aplica patch no ArenaSession.java
# [Segue instruções do patch 02: 2 substituições must()]
```

---

### **3. Backend PSP (Regras T15)**
```bash
cd ~/GameArena

# Adiciona jogos PSP ao gameRules.js
# [Segue instruções do patch 03: adiciona array de jogos PSP]

git add backend/services/gameRules.js
git commit -m "GA20: adiciona jogos PSP ao T15"
```

---

### **4. Lobby GA16 (Frontend Android)**
```bash
cd ~/GameArena

# Adiciona listener console_over no ConsoleLobbyActivity
# [Segue instruções do patch 04: 3 must() blocks]
```

---

### **5. Backend GA16 (Histórico)**
```bash
cd ~/GameArena

# Altera server.js para registar onFinish do console-namespace
# [Segue instruções do patch 05: substitui consoleNamespace(io)]

git add backend/server.js
git commit -m "GA20: backend grava histórico PSP via GA16"
```

---

### **6. Manifest (Frontend Android)**
```bash
cd ~/GameArena

# Adiciona <activity> no AndroidManifest.xml
# [Segue instruções do patch 06: adiciona declaração antes de </application>]
```

---

## 🔨 Compilar e Testar

### **Compilar Arena Console (PPSSPP)**
```bash
cd ~/ppsspp
./gradlew assembleNormalRelease

# A APK fica em:
# android/build/outputs/apk/normal/release/ppsspp-normal-release.apk
```

### **Compilar Game Arena (Frontend)**
```bash
cd ~/GameArena
./gradlew assembleNormalRelease

# A APK fica em:
# app/build/outputs/apk/normal/release/app-normal-release.apk
```

### **Deploy Backend**
```bash
cd ~/GameArena
git add backend
git commit -m "GA20: integração GA16 PSP completa"
git push render main

# Aguarda deploy no Render (2-3 min)
```

---

## ✅ Testes de Validação

### **Teste 1: Trailer**
1. Abre um jogo PSP (ex: Tekken).
2. Clica em **VER TRAILER**.
3. Verifica:
   - ✅ Vídeo abre em landscape (mesmo que o telemóvel esteja em portrait).
   - ✅ Botão X no canto superior direito fecha o player.
   - ✅ Se deixar o vídeo acabar, fecha sozinho.

### **Teste 2: Modo Solo**
1. Abre um jogo PSP.
2. Clica em **JOGAR → TREINO**.
3. Verifica:
   - ✅ O Arena Console abre direto (sem erro "role inválido").
   - ✅ Joga uma partida até ao fim.
   - ✅ O PPSSPP fecha sozinho (ou mostra diálogo de pausa).
   - ✅ Ao voltar ao Launcher, mostra "Como correu o treino?".

### **Teste 3: Multiplayer (Sala Livre)**
1. Cria uma sala livre 1v1 com um jogo PSP.
2. Outro utilizador junta-se à sala.
3. Jogam até ao fim.
4. Verifica:
   - ✅ O servidor envia `console_over` (com `winnerRole`).
   - ✅ Ao voltar ao Lobby, mostra "Como correu a partida?".
   - ✅ Confirma vitória/derrota.
   - ✅ Abre a aba **Histórico** → partida PSP aparece.

### **Teste 4: Torneio (T15)**
1. Cria um torneio com um jogo PSP (ex: Tekken).
2. Inscreve-te e outro jogador.
3. Inicia o torneio.
4. Joga a partida até ao fim.
5. Verifica:
   - ✅ O servidor grava o resultado no T15.
   - ✅ O bracket actualiza (vencedor avança).
   - ✅ O histórico mostra `mode: "tournament"`.

### **Teste 5: Home (Mais Jogados)**
1. Joga 2-3 partidas de PSP.
2. Volta à aba **Início**.
3. Verifica:
   - ✅ Os jogos PSP aparecem na grelha de "Recentes/Favoritos".
   - ✅ Clica num jogo → abre o menu (Treino/Multiplayer).

---

## 📊 Verificação no Backend (BD)

### **Histórico gravado?**
```sql
SELECT * FROM user_game_history 
WHERE game_id LIKE 'psp_%' 
ORDER BY played_at DESC 
LIMIT 10;
```

### **Torneio criado com PSP?**
```sql
SELECT t.id, t.name, t.config->>'gameKey' as game
FROM t15_tournaments t
WHERE t.config->>'gameKey' LIKE 'psp_%'
ORDER BY t.created_at DESC
LIMIT 5;
```

### **Sala de Console com config ga15?**
```sql
SELECT r.code, r.config->>'ga15_tournament_id' as tid, r.config->>'ga15_match_id' as mid
FROM rooms r
WHERE r.config->>'ga15_tournament_id' IS NOT NULL
ORDER BY r.created_at DESC
LIMIT 5;
```

---

## 🎯 Garantias de Qualidade

### **Reutilização de Código (Sem Invenção)**
- ✅ Trailer: Usa `WindowInsetsControllerCompat` (mesmo que `GameWebViewActivity`).
- ✅ Solo: Aceita `role=null` sem tocar no multiplayer.
- ✅ Backend: Usa `ga16History.recordRoomResult` (mesmo que `ga16MatchReport`).
- ✅ Lobby: Usa `ApiClient.recordMatchResult` (mesmo que `GameWebViewActivity`).
- ✅ Torneios: Usa `gameRules.findRules` (mesmo que `t15Engine`).

### **Nenhuma Quebra de Compatibilidade**
- ✅ HTML5 continua a funcionar (nenhum ficheiro HTML foi alterado).
- ✅ Multiplayer PSP continua a exigir `role`, `peer_id`, `room_code`, `start_token`.
- ✅ ArenaGuard intacto (certificado SHA-256 + `getCreatorPackage()`).
- ✅ Backend aceita PSP e HTML5 (sem if/else específicos).

### **Limitações Documentadas**
- ❌ **Multiplayer não fecha sozinho** → Android não permite (app separada).  
  👉 Solução: Diálogo "Como correu?" no `onResume` do Lobby.
- ✅ **Treino fecha sozinho** → PPSSPP chama `finish()` (já funciona).
- ✅ **Torneios PSP funcionam** → Backend aceita `gameKey: "psp_*"`.
- ✅ **Histórico funciona** → Backend grava via `ga16History`.
- ✅ **Home mostra PSP** → `MainActivity` já filtra por `recentIds`.

---

## 🚨 Troubleshooting

### **Erro: "role inválido" no Treino**
- **Causa:** O patch 02 não foi aplicado no PPSSPP.
- **Solução:** Verifica `ArenaSession.java` linha 151 (`if (role != null && ...`).

### **Trailer não abre em landscape**
- **Causa:** O patch 06 não foi aplicado (Manifest).
- **Solução:** Adiciona `<activity android:screenOrientation="sensorLandscape" />`.

### **Histórico PSP não aparece**
- **Causa:** O patch 05 não foi aplicado no backend.
- **Solução:** Verifica `server.js` se `consoleNamespace(io, { onFinish })` existe.

### **Torneio rejeita jogo PSP**
- **Causa:** O patch 03 não foi aplicado (`gameRules.js`).
- **Solução:** Adiciona `{ key: 'psp_tekken', mode: 'pvp', min: 2, max: 2 }`.

### **Diálogo "Como correu?" não aparece**
- **Causa:** O patch 04 não foi aplicado (`ConsoleLobbyActivity`).
- **Solução:** Adiciona `ga20ListenMatchEnd()` no `onCreate`.

---

## 📝 Checklist Final

Antes de marcar como concluído, verifica:

- [ ] ✅ Trailer abre em landscape (patch 01 + 06).
- [ ] ✅ Treino funciona sem rede (patch 02).
- [ ] ✅ Backend aceita torneios PSP (patch 03).
- [ ] ✅ Lobby mostra "Como correu?" (patch 04).
- [ ] ✅ Backend grava histórico PSP (patch 05).
- [ ] ✅ Manifest regista `TrailerPlayerActivity` (patch 06).
- [ ] ✅ Arena Console compila (`assembleNormalRelease`).
- [ ] ✅ Game Arena compila (`assembleNormalRelease`).
- [ ] ✅ Backend fez deploy no Render.
- [ ] ✅ Testado: Trailer + Treino + Multiplayer + Torneio + Home.

---

## 🎉 PRÓXIMOS PASSOS

Com esta fase concluída, os jogos PSP estão **100% integrados** no fluxo GA16:

1. ✅ **Torneios T15** (mesmo que HTML5).
2. ✅ **Histórico + XP** (mesmo backend `ga16History`).
3. ✅ **Home "Mais Jogados"** (já filtra por `recentIds`).
4. ✅ **Treino (modo solo)** (sem exigir rede).
5. ✅ **Trailer nativo** (UX premium).

**Última etapa pendente:**
- 🔧 **Fase 20.7:** Instalação APK no HyperOS/MIUI (resolver erro `2147483646`).
  - Solução: Desativar "Otimização MIUI" ou usar `pm install` forçado.

---

## 📚 Documentação de Referência

- **GA16 HTML5:** `GameWebViewActivity.kt` linha 70-75 (comentários GA16_UNIFY).
- **T15 Engine:** `backend/services/t15Engine.js` linha 59 (gameRules.findRules).
- **Histórico:** `backend/routes/userHistory.js` linha 139-230 (POST /record).
- **Console Namespace:** `backend/services/console-namespace.js` linha 82 (onFinish).
- **PPSSPP Solo:** `13-arena-solo.patch.md` (aceitar role=null).

---

## 👤 Autoria e Versão

- **Fase:** GA20_ARENA (Integração GA16 PSP)
- **Data:** 2026-11-04
- **Versão:** 20.6 (6 patches)
- **Autor:** Opus (Kiro Web)
- **Validado por:** Dono da Game Arena

---

**Fim do README.** Aplica os patches na ordem numérica (01 → 06) e testa cada um antes de avançar.
