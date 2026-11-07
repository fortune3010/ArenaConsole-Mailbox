# GA20_ARENA · PATCH 2: Modo Solo (Treino sem Rede)

## Contexto
O botão **JOGAR → TREINO** no `ConsoleMenuActivity` abre o Arena Console **sem** enviar dados de rede (`role`, `peer_id`, `room_code`, etc.).

O `ArenaSession.java` (linha 151) valida que `role` seja `"host"` ou `"guest"`, o que bloqueia o modo solo.

**Solução:** Aceitar `role=null` como **sessão solo** (sem multiplayer). O multiplayer continua a exigir todos os campos.

## Ficheiro afetado
- `~/ppsspp/android/src/org/ppsspp/ppsspp/ArenaSession.java`

---

## PATCH (6 linhas alteradas)

No ficheiro `~/ppsspp/android/src/org/ppsspp/ppsspp/ArenaSession.java`:

### LOCALIZA A LINHA ~97 (método `fromIntent`, onde chama `validateNet`):

<!-- must(find_exact) -->
```java
                String boot = pickBootTarget(intent, isoUri, isoPath);
                String err = validateNet(role, peerId, remotePeerId, roomCode, startToken, serverUrl, ns, protocol);
                if (!fp.isEmpty() && !FP_RE.matcher(fp).matches()) {
                        fp = "";
                }

                ArenaSession s = new ArenaSession(boot, isoName, fp, gameId, role, peerId, remotePeerId, roomCode,
                        err.isEmpty() ? startToken : "", serverUrl, ns, protocol, err);
```
<!-- must(end) -->

### SUBSTITUI POR (aceita sessão solo):

<!-- must(replace_with) -->
```java
                String boot = pickBootTarget(intent, isoUri, isoPath);
                
                // GA20_SOLO: modo Treino (sem dados de rede) é válido. Multiplayer continua a exigir tudo.
                final boolean solo = role == null || role.trim().isEmpty();
                String err = solo ? "" : validateNet(role, peerId, remotePeerId, roomCode, startToken, serverUrl, ns, protocol);
                if (!fp.isEmpty() && !FP_RE.matcher(fp).matches()) {
                        fp = "";
                }

                ArenaSession s = new ArenaSession(boot, isoName, fp, gameId, role, peerId, remotePeerId, roomCode,
                        err.isEmpty() ? startToken : "", serverUrl, ns, protocol, err);
```
<!-- must(end) -->

---

### LOCALIZA A LINHA ~151 (método `validateNet`, 1.ª validação):

<!-- must(find_exact) -->
```java
        private static String validateNet(String role, String peerId, String remotePeerId, String roomCode, String startToken,
                                          String serverUrl, String ns, int protocol) {
                if (protocol != SUPPORTED_PROTOCOL) return "protocol_version " + protocol + " (suportado: " + SUPPORTED_PROTOCOL + ")";
                if (!"host".equals(role) && !"guest".equals(role)) return "role inválido";
```
<!-- must(end) -->

### SUBSTITUI A LINHA DO `role` POR (permite null no solo):

<!-- must(replace_with) -->
```java
        private static String validateNet(String role, String peerId, String remotePeerId, String roomCode, String startToken,
                                          String serverUrl, String ns, int protocol) {
                if (protocol != SUPPORTED_PROTOCOL) return "protocol_version " + protocol + " (suportado: " + SUPPORTED_PROTOCOL + ")";
                if (role != null && !"host".equals(role) && !"guest".equals(role)) return "role inválido";
```
<!-- must(end) -->

---

## Resultado
✅ **Treino funciona:** O Launcher envia só a ISO (sem `role`, `peer_id`, etc.), e o PPSSPP aceita.  
✅ **Multiplayer NÃO muda:** Se `role` vier preenchido, continua a exigir `host|guest`, `peer_id`, `room_code`, `start_token`, `server_url`.  
✅ **ArenaGuard intacto:** A verificação do certificado SHA-256 + `getCreatorPackage()` não é tocada.

---

## Como testar
1. Aplica este patch no fork `~/ppsspp`.
2. Compila o Arena Console (`./gradlew assembleNormalRelease`).
3. Na Game Arena, clica em **JOGAR → TREINO** (sem criar sala).
4. O jogo deve abrir direto (sem erro "role inválido").

---

## NOTA: Fim de Treino (auto-close)
O PPSSPP pode chamar `finish()` (comando nativo) para fechar sozinho no fim da partida solo.
Isso já funciona (linha 244 do `ArenaUi.java`: `act.processCommand("finish", "")`).

Quando o utilizador voltar ao Launcher, o Launcher mostra "Como correu o treino?" (patch 04).
