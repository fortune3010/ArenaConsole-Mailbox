# GA20_ARENA · PATCH 6: Registar TrailerPlayerActivity no Manifest

## Contexto
A `TrailerPlayerActivity` (criada no patch 01) precisa de ser declarada no `AndroidManifest.xml`.

## Ficheiro afetado
- `app/src/main/AndroidManifest.xml`

---

## PATCH

No ficheiro `app/src/main/AndroidManifest.xml`, localiza a tag `<application>` e adiciona a declaração da Activity:

Procura por outras declarações de Activity (como `ConsoleMenuActivity`, `GamesActivity`, etc.) e adiciona **antes da tag de fecho `</application>`**:

<!-- must(find_context) -->
```xml
        <activity
            android:name=".ui.ConsoleMenuActivity"
            android:exported="false"
            android:theme="@style/AppTheme" />
```
<!-- must(end) -->

Logo **DEPOIS** do bloco acima (ou antes de `</application>` se não encontrares), adiciona:

<!-- must(insert_after) -->
```xml

        <!-- GA20_ARENA: player de trailer nativo (landscape, auto-close) -->
        <activity
            android:name=".ui.TrailerPlayerActivity"
            android:exported="false"
            android:screenOrientation="sensorLandscape"
            android:theme="@style/Theme.AppCompat.NoActionBar"
            android:configChanges="orientation|screenSize|keyboardHidden" />
```
<!-- must(end) -->

---

## Resultado
✅ A `TrailerPlayerActivity` está registada no Manifest.  
✅ `screenOrientation="sensorLandscape"` força landscape (mesmo que o telemóvel esteja em portrait).  
✅ `theme="@style/Theme.AppCompat.NoActionBar"` remove a barra de título (fullscreen).  
✅ `configChanges` evita que a Activity seja recriada ao rodar o ecrã.

---

## Como testar
1. Aplica todos os patches (01 a 06).
2. Compila o app (`./gradlew assembleNormalRelease`).
3. Abre um jogo PSP e clica em "VER TRAILER".
4. O vídeo deve abrir em landscape, com botão X funcional e auto-close no fim.

---

## NOTA FINAL: Ordem de Aplicação
Aplica os patches **nesta ordem:**

1. ✅ **01-trailer-player.patch.md** → Cria `TrailerPlayerActivity.kt` + layout
2. ✅ **02-solo-mode.patch.md** → Patch no PPSSPP (`ArenaSession.java`)
3. ✅ **03-backend-psp-rules.patch.md** → Backend reconhece jogos PSP (`gameRules.js`)
4. ✅ **04-lobby-ga16-listener.patch.md** → Lobby escuta `console_over` e mostra diálogo
5. ✅ **05-backend-ga16-history.patch.md** → Backend grava histórico PSP (`server.js`)
6. ✅ **06-manifest-trailer.patch.md** → Regista `TrailerPlayerActivity` no Manifest

Depois:
- Compila o Arena Console: `cd ~/ppsspp && ./gradlew assembleNormalRelease`
- Compila a Game Arena: `cd ~/GameArena && ./gradlew assembleNormalRelease`
- Deploy do backend: `git add backend && git commit -m "GA20: PSP integração GA16" && git push render main`

---

## LIMITAÇÕES ACEITES (Recap)
❌ **Multiplayer não fecha sozinho** → Android não permite (app separada).  
👉 Solução: Diálogo "Como correu?" no `onResume` do Lobby (patch 04).

✅ **Treino fecha sozinho** → PPSSPP chama `finish()` (já funciona).  
👉 Solução: Launcher detecta o regresso e mostra "Como correu o treino?" (patch 04).

✅ **Torneios PSP funcionam** → Backend aceita `gameKey: "psp_*"` (patch 03).  
✅ **Histórico funciona** → Backend grava via `ga16History` (patch 05).  
✅ **Home mostra PSP** → `MainActivity` já filtra por `recentIds` (nenhum patch necessário).

---

## 🎉 FIM DA INTEGRAÇÃO GA16 PARA PSP

Com estes 6 patches, os jogos de PSP seguem **o mesmo fluxo dos HTML5**:
- ✅ Torneios (T15)
- ✅ Histórico + XP
- ✅ "Mais Jogados" (Home)
- ✅ Treino (modo solo)
- ✅ Trailer interno (UX nativa)
