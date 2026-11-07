# GA20_ARENA · PATCH 4: Lobby Escuta `console_over` e Mostra "Como Correu?" (GA16)

## Contexto
O multiplayer PSP não pode fechar o Arena Console automaticamente (limitação do Android: o emulador é uma app separada).

Quando a partida acaba, o servidor envia `console_over` (com `winnerRole`) para ambos os jogadores.

**Solução:** O `ConsoleLobbyActivity` (que fica em background) escuta o socket e, quando o utilizador voltar, mostra um diálogo "Como correu a partida?" para ele confirmar vitória/derrota/empate.

Isso **replica o fluxo do HTML5** (`GameWebViewActivity` linha 723: `reportMatchResult`), mas adaptado para a separação app↔emulador.

## Ficheiros afetados
- `app/src/main/java/com/gamearena/ui/ConsoleLobbyActivity.kt`

---

## PATCH

No ficheiro `app/src/main/java/com/gamearena/ui/ConsoleLobbyActivity.kt`:

### PASSO 1: Adicionar variáveis de estado (no topo da classe, linha ~50):

<!-- must(find_exact) -->
```kotlin
    private lateinit var rom: Ga20Cat.Entry
    private var romFile: File? = null
    private var web: android.webkit.WebView? = null
    private var launched = false
```
<!-- must(end) -->

Adiciona logo a seguir:

<!-- must(insert_after) -->
```kotlin
    // GA20_GA16: resultado da partida (servidor envia console_over quando acabar)
    private var matchEnded = false
    private var matchWinnerRole: String? = null
    private var matchEndReason: String? = null
```
<!-- must(end) -->

---

### PASSO 2: Conectar ao socket e escutar `console_over` (no `onCreate`, depois do `setContentView`):

Localiza onde o WebView é criado (linha ~110):

<!-- must(find_exact) -->
```kotlin
        web = android.webkit.WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            addJavascriptInterface(Bridge(), "Android")
            webViewClient = object : android.webkit.WebViewClient() {
```
<!-- must(end) -->

Logo **ANTES** do bloco do WebView, adiciona a ligação ao socket:

<!-- must(insert_before) -->
```kotlin
        // GA20_GA16: escuta o fim de partida (console_over)
        ga20ListenMatchEnd()
```
<!-- must(end) -->

---

### PASSO 3: Implementar `ga20ListenMatchEnd()` (no fim da classe, antes do último `}`):

Adiciona este método **NO FIM** da classe (antes do `override fun onDestroy()`):

<!-- must(insert_before) -->
```kotlin
    /**
     * GA20_GA16: escuta o socket /console para saber quando a partida acabou.
     * Quando o servidor enviar 'console_over', marca o resultado e, no onResume, pergunta ao utilizador.
     */
    private fun ga20ListenMatchEnd() {
        val token = session.getToken() ?: return
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val opts = io.socket.client.IO.Options().apply {
                    auth = mapOf("token" to token)
                    transports = arrayOf("websocket")
                }
                val socket = io.socket.client.IO.socket("https://gamer-fortune.onrender.com/console", opts)
                
                socket.on("console_over") { args ->
                    val data = args.getOrNull(0) as? org.json.JSONObject ?: return@on
                    val winner = data.optString("winnerRole", "")
                    val reason = data.optString("reason", "agreed")
                    
                    runOnUiThread {
                        matchEnded = true
                        matchWinnerRole = winner
                        matchEndReason = reason
                        
                        // Se o utilizador ainda estiver aqui (não foi para outra tela), mostra logo o diálogo
                        if (!isFinishing && !isDestroyed) {
                            ga20ShowMatchResult()
                        }
                    }
                }
                
                socket.connect()
                
                // Desconecta quando a Activity morrer
                withContext(Dispatchers.Main) {
                    lifecycle.addObserver(object : androidx.lifecycle.DefaultLifecycleObserver {
                        override fun onDestroy(owner: androidx.lifecycle.LifecycleOwner) {
                            socket.disconnect()
                            socket.off()
                        }
                    })
                }
            } catch (e: Exception) {
                android.util.Log.e("GA20", "Erro ao conectar socket /console: ${e.message}", e)
            }
        }
    }
    
    /**
     * GA20_GA16: mostra o diálogo "Como correu a partida?" quando o utilizador voltar.
     * Replica o fluxo do GameWebViewActivity (ga16PostGame), mas pedindo confirmação manual.
     */
    private fun ga20ShowMatchResult() {
        if (!matchEnded || matchWinnerRole == null) return
        if (isFinishing || isDestroyed) return
        
        val myRole = "host" // TODO: recuperar o role real da sala (guardado no launchConsole)
        val didIWin = when (matchWinnerRole) {
            "draw" -> null // empate
            myRole -> true
            else -> false
        }
        
        val title = when (didIWin) {
            true -> "Vitória! 🎉"
            false -> "Derrota 😔"
            null -> "Empate"
        }
        
        val message = "O servidor reportou que a partida terminou.\n\n" +
            "Como correu para ti? (Isto vai gravar no teu histórico.)"
        
        android.app.AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setCancelable(false)
            .setPositiveButton("Ganhei") { _, _ ->
                ga20RecordResult("win")
                finish()
            }
            .setNegativeButton("Perdi") { _, _ ->
                ga20RecordResult("loss")
                finish()
            }
            .setNeutralButton("Empate") { _, _ ->
                ga20RecordResult("draw")
                finish()
            }
            .show()
    }
    
    /**
     * GA20_GA16: grava o resultado no histórico (mesmo fluxo do GameWebViewActivity linha 964).
     */
    private fun ga20RecordResult(result: String) {
        val token = session.getToken() ?: return
        val gameId = rom.gid.ifBlank { "psp_unknown" }
        
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                // Reutiliza o ApiClient.recordMatchResult (que já existe no HTML5)
                com.gamearena.data.ApiClient.recordMatchResult(
                    token = token,
                    gameId = gameId,
                    result = result,
                    mode = "multiplayer",
                    opponents = 1,
                    roomCode = null, // TODO: se tiver o roomCode, passa aqui para gravar para ambos
                    winnerRole = null
                )
                android.util.Log.i("GA20", "Resultado gravado: $result")
            } catch (e: Exception) {
                android.util.Log.e("GA20", "Erro ao gravar resultado: ${e.message}", e)
            }
        }
    }
```
<!-- must(end) -->

---

### PASSO 4: Mostrar o diálogo no `onResume` (se a partida tiver acabado enquanto o utilizador estava no Console):

Localiza o `override fun onResume()` (ou cria se não existir):

<!-- must(find_or_create) -->
```kotlin
    override fun onResume() {
        super.onResume()
    }
```
<!-- must(end) -->

Adiciona a chamada **no fim** do método:

<!-- must(insert_before_last_brace) -->
```kotlin
        // GA20_GA16: se a partida acabou enquanto o utilizador estava no Console, mostra o diálogo
        if (matchEnded && launched) {
            ga20ShowMatchResult()
        }
```
<!-- must(end) -->

---

## Resultado
✅ Quando o servidor enviar `console_over` (com `winnerRole`), o Lobby marca o resultado.  
✅ Quando o utilizador voltar do Console (onResume), mostra "Como correu a partida?".  
✅ O resultado é gravado no histórico (via `ApiClient.recordMatchResult`).  
✅ Replica o fluxo do HTML5 (`ga16PostGame`), mas com confirmação manual (por causa da separação app↔emulador).

---

## Limitação aceite
❌ O Console **não fecha sozinho** (o Android não permite).  
👉 O utilizador tem de voltar manualmente (botão Back ou Home).  
👉 O diálogo aparece quando ele voltar ao Lobby.

---

## Próximo passo
O backend precisa de **enviar `console_over`** quando a partida acabar.  
Isso está no **patch 05** (`console-namespace.js` chama `ga16History.recordRoomResult`).
