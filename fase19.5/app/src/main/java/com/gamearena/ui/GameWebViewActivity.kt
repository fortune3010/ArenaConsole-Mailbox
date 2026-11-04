package com.gamearena.ui

import android.os.Build
import android.app.GameManager
import android.app.GameState
import com.gamearena.launcher.GameWebViewPool
import com.gamearena.launcher.Html5RoomLauncher
import com.gamearena.launcher.applyGameWebViewSettings
import kotlin.math.abs
import android.view.WindowManager
import android.content.Context

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.os.PowerManager
import androidx.lifecycle.lifecycleScope
import com.gamearena.R
import com.gamearena.data.ApiClient
import com.gamearena.data.RoomApiClient
import com.gamearena.data.UserSession
import com.gamearena.launcher.GameProfile
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * WebView para jogos HTML5 (Bomberman, DAMA, etc).
 *
 * Fluxo original preservado:
 * 1. Carrega o jogo via URL (gameUrl do GameProfile)
 * 2. Se vier com room + role + start=1 + start_token, entra em sala livre autorizada
 * 3. Jogo reporta resultado via AndroidInterface.reportarResultado()
 * 4. Activity envia para POST /api/tournaments/:id/matches/:matchId/report
 * 5. Backend avança o bracket automaticamente
 * 6. Jogo pode pedir notificação nativa de sala via AndroidInterface.requestNotifyRoom(code)
 *
 * Adições da Fase P1 (salas casuais 1x1):
 * - AndroidInterface.openRoomLobby(create) abre o lobby nativo RoomLobbyActivity.
 * - AndroidInterface.shareRoomInvite(code) partilha link canónico /r/{code}.
 * - AndroidInterface.reportPresence(state, roomCode, gameId) reporta presença usando apenas estados válidos.
 * - Presença automática IN_GAME/IDLE/OFFLINE quando a Activity está numa sala livre autorizada.
 * - shouldOverrideUrlLoading intercepta gamearena://r/{code} e https .../r/{code} para abrir o lobby nativo.
 * - Não altera o fluxo de torneios existente.
 *
 * GA16_UNIFY (Fase 16):
 * - O fim de partida chega por reportMatchResult('ga16_<win|loss|draw|closed|end>', json) vindo do
 *   ga16-post.js v3, DEPOIS do popup premium (3,5 s). Só aí o WebView fecha.
 * - reportMatchResult('host'|'guest'|'win'|'loss'|'draw') já NÃO grava nem fecha: só guarda o resultado
 *   e arma um fallback (7 s) para jogos que ainda não usam o ga16-post.js v3.
 * - O histórico é gravado UMA vez, em ga16PostGame. Em sala, só o host grava (o backend grava os 2 lados).
 */
class GameWebViewActivity : BaseActivity() {
    companion object {
        const val EXTRA_GAME = "game"
        const val EXTRA_TOURNAMENT_ID = "tournament_id"
        const val EXTRA_MATCH_ID = "match_id"
        const val EXTRA_ROOM_CODE = "room_code"
        const val EXTRA_ROLE = "role"
        const val EXTRA_START = "start"
        const val EXTRA_START_TOKEN = "start_token"
        const val EXTRA_ROOM_MODE = "room_mode"

        // Fase 1 — Menu nativo da plataforma
        const val EXTRA_MODE = "mode"                  // "training" | "free" | "tournament"
        const val EXTRA_PLAYERS = "players"
        const val EXTRA_DIFFICULTY = "difficulty"
        const val EXTRA_SCENARIO = "scenario"
        const val EXTRA_CHARACTER = "character"

        private const val INVITE_BASE_URL = "https://gamer-fortune.onrender.com/r/"
        private const val PRESENCE_INTERVAL_MS = 30_000L
        private const val GA16_FALLBACK_MS = 7_000L // GA16_UNIFY: jogos sem ga16-post.js v3

        private val ALLOWED_PRESENCE_STATES = setOf(
            "OFFLINE",
            "IDLE",
            "IN_LOBBY",
            "IN_GAME"
        )

        private val GA16_OUTCOMES = setOf("win", "loss", "draw", "closed", "end") // GA16_UNIFY

        private val ROOM_HTTPS_HOSTS = setOf(
            "gamearena-backend.vercel.app",
            "gamer-fortune.onrender.com"
        )
    }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var game: GameProfile
    private lateinit var session: UserSession

    private var tournamentId: String? = null
    private var matchId: String? = null
    private var ga15v5ElimReceiver: android.content.BroadcastReceiver? = null // GA15V5_ELIM
    private var ga16EndedReceiver: android.content.BroadcastReceiver? = null // GA16_POSTGAME
    private val ga16Closing = AtomicBoolean(false) // GA16_POSTGAME: fecha uma única vez (socket ou push)
    private val ga16Recorded = AtomicBoolean(false) // GA16_UNIFY: grava o histórico uma única vez
    @Volatile private var ga16PendingRole: String? = null   // GA16_UNIFY: 'host'|'guest' recebido do jogo
    @Volatile private var ga16PendingSingle: String? = null // GA16_UNIFY: 'win'|'loss'|'draw' (treino/CPU)
    private val ga16CreatedAt = android.os.SystemClock.elapsedRealtime() // GA16_POSTGAME
    @Volatile private var ga16LinkedTid: String? = null // GA16_FRUIT: torneio da sala (via /api/ga16)
    private val GA16_LINK_BASE = "https://gamer-fortune.onrender.com/api/ga16/rooms/" // GA16_FRUIT
    private var roomCode: String? = null
    private var role: String? = null
    private var start: String? = null
    private var startToken: String? = null
    private var roomMode: String? = null
    private var mode: String? = null
    private var players: Int = 0
    private var difficulty: String? = null
    private var scenarioIdx: Int = 0
    private var characterIdx: Int = 0
    private var resultReported = false

    private var webViewReady = false
    private var inRoomSession = false
    private var presenceJob: Job? = null
    private var warm: GameWebViewPool.Warm? = null

    private val notifyInFlight = AtomicBoolean(false)
    private val presenceInFlight = AtomicBoolean(false)
    private val roomCreateInFlight = AtomicBoolean(false)

    private var ga3Overlay: android.view.View? = null
    private var ga3Pct: android.widget.TextView? = null
    private var ga3OfflineScreen: GaOfflineScreen? = null
    private var ga3PageError = false
    private var ga3FailedUrl: String? = null
    private var ga3PendingLoad = false
    private val ga3Main = android.os.Handler(android.os.Looper.getMainLooper())
    // GA_FASE6: estado do ecra de erro
    private var ga6LastMainUrl: String? = null
    private var ga6ClearHistory = false
    private var ga6CheckSeq = 0
    private val ga6NetErrorJs = "(function(){var b=document.body;return !!(b&&(b.classList.contains('neterror')||document.getElementById('main-frame-error')))})()"

    // GA17_VOICE: pedido de microfone do WebView à espera da permissão RECORD_AUDIO do Android
    @Volatile private var ga17PendingMic: PermissionRequest? = null
    private val ga17MicPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val req = ga17PendingMic
        ga17PendingMic = null
        if (req == null) return@registerForActivityResult
        try {
            if (granted) req.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else req.deny()
        } catch (e: Exception) {
            android.util.Log.w("GameWebViewActivity", "GA17: grant falhou: ${e.message}")
        }
        if (!granted) Toast.makeText(this, getString(R.string.ga195_voice_mic_denied), Toast.LENGTH_LONG).show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // GA15V5_ELIM: eliminado neste torneio → fecha o jogo e abre o detalhe (overlay 5 s + Histórico)
        ga16EndedReceiver = Ga15EliminationBus.registerEnded(this) { tid, kind -> ga16OnPushEnded(tid, kind) } // GA16_POSTGAME
        ga15v5ElimReceiver = Ga15EliminationBus.register(this) { tid, phrase ->
            val mine = tournamentId?.takeIf { it.isNotBlank() } ?: ga16LinkedTid // GA16_FRUIT
            if (!mine.isNullOrBlank() && mine == tid && !isFinishing) {
                startActivity(
                    Intent(this, TournamentDetailActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        .putExtra("tournamentId", tid)
                        .putExtra(Ga15EliminationBus.EXTRA_ELIMINATED, phrase.ifBlank { "no torneio" })
                        .putExtra(Ga15EliminationBus.EXTRA_TAB, "history")
                )
                finish()
            }
        }
        
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setBackgroundDrawable(null)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).run {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        
        pinRefreshRate(60f)
        
        if (android.os.Build.VERSION.SDK_INT >= 24 &&
            getSystemService(PowerManager::class.java).isSustainedPerformanceModeSupported) {
            window.setSustainedPerformanceMode(true)
        }
        
        // ═══════════════════════════════════════════════════════════
        // MOTOR DE PERFORMANCE MÁXIMA (KOTLIN GAME MODE)
        // ═══════════════════════════════════════════════════════════
        
        // 1. Aceleração de Hardware (GPU obrigatória)
        window.setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        )
        
        // 2. Desempenho Sustentado (impede throttling térmico)
        
        // 3. Manter o ecrã ligado (GPU ativa)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        
        // 4. Refresh rate máximo (120Hz, 90Hz, etc)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val display = windowManager.defaultDisplay
            val modes = display.supportedModes
            if (modes.isNotEmpty()) {
                val maxRefreshRate = modes.maxOf { it.refreshRate }
                val maxMode = modes.find { it.refreshRate == maxRefreshRate }
                if (maxMode != null) {
                    val attrs = window.attributes
                    attrs.preferredDisplayModeId = maxMode.modeId
                    window.attributes = attrs
                }
            }
        }
        
        // 5. Game Mode API (Android 12+)
        // ═══════════════════════════════════════════════════════════
        
        setContentView(R.layout.activity_game_webview)

        // ═══ MODO IMERSIVO (esconder status bar + nav bar durante o jogo) ═══
        window.decorView.systemUiVisibility = (
            android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
            or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        )

        session = UserSession(this)
        if (!session.isLoggedIn()) {
            Toast.makeText(this, "Login necessário", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        // Extrair parâmetros
        val gameJson = intent.getStringExtra(EXTRA_GAME)
        if (gameJson == null) {
            Toast.makeText(this, "Jogo inválido", Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        game = Gson().fromJson(gameJson, GameProfile::class.java)
        
        // Lógica de Rotação Dinâmica: O catálogo ou o URL decide
        val isLandscape = (game.orientation == "landscape") || (game.gameUrl?.contains("landscape", ignoreCase = true) == true)
        if (isLandscape) {
            requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else if (game.orientation == "auto") {
            requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_USER
        } else {
            requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }

        tournamentId = intent.getStringExtra(EXTRA_TOURNAMENT_ID)
        matchId = intent.getStringExtra(EXTRA_MATCH_ID)
        roomCode = intent.getStringExtra(EXTRA_ROOM_CODE)
        ga16ResolveTournament() // GA16_FRUIT
        role = intent.getStringExtra(EXTRA_ROLE)
        start = intent.getStringExtra(EXTRA_START)
        startToken = intent.getStringExtra(EXTRA_START_TOKEN)
        roomMode = intent.getStringExtra(EXTRA_ROOM_MODE)
        mode = intent.getStringExtra(EXTRA_MODE)
        players = intent.getIntExtra(EXTRA_PLAYERS, 0)
        difficulty = intent.getStringExtra(EXTRA_DIFFICULTY)
        scenarioIdx = intent.getIntExtra(EXTRA_SCENARIO, 0)
        characterIdx = intent.getIntExtra(EXTRA_CHARACTER, 0)

        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        ga3InitOverlays()

        warm = freeRoomPath(null)?.let { GameWebViewPool.claim(this, buildGameUrl(it)) }?.also { swapInWarmWebView(it.web) }
        webViewReady = true

        setupWebView()
        
        // Plano Superior da IA: Prioridade da WebView e 60Hz fixos
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT, false)
        }
        try {
            val display = windowManager.defaultDisplay
            val modes = display.supportedModes
            val mode60 = modes.minByOrNull { Math.abs(it.refreshRate - 60f) }
            if (mode60 != null) {
                val attrs = window.attributes
                attrs.preferredDisplayModeId = mode60.modeId
                window.attributes = attrs
            }
        } catch (e: Exception) {}

        loadGame()
        reportGameState(true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val w = warm
        if (w == null) applyGameWebViewSettings(webView)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString()
                if (handleRoomUrl(url)) return true
                return super.shouldOverrideUrlLoading(view, request)
            }
            @Suppress("DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                if (handleRoomUrl(url)) return true
                return super.shouldOverrideUrlLoading(view, url)
            }
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                ga3OnPageStarted(url) // GA_FASE6
            }
            @android.annotation.TargetApi(23)
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: android.webkit.WebResourceError?) {
                if (request == null || request.isForMainFrame) ga3OnMainFrameError(request?.url?.toString(), error?.errorCode ?: 0)
            }
            @Suppress("DEPRECATION")
            override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
                ga3OnMainFrameError(failingUrl, errorCode)
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                view?.evaluateJavascript(GameWebViewPool.JS_LAUNCH, null)
                ga3OnPageFinished()
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress < 100) { progressBar.visibility = android.view.View.VISIBLE; progressBar.progress = newProgress } else { progressBar.visibility = android.view.View.GONE }
                ga3SetProgress(newProgress)
            }

            // GA17_VOICE: getUserMedia({audio}) do voice.js → só microfone, só para os nossos domínios
            override fun onPermissionRequest(request: PermissionRequest?) {
                runOnUiThread { ga17OnPermissionRequest(request) }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                if (ga17PendingMic === request) ga17PendingMic = null
            }
        }
        val bridge = AndroidBridge()
        if (w != null) w.proxy.target = bridge else webView.addJavascriptInterface(bridge, "AndroidInterface")
    }

    // GA16_FRUIT: sala de torneio aberta pelo Html5RoomLauncher não traz tournamentId no intent.
    // Pergunta ao servidor (rooms.config.ga15_*) para o push de eliminação fechar o jogo e abrir o Histórico.
    // Fica numa variável própria: loadGame()/reportarResultado continuam exactamente como estavam.
    private fun ga16ResolveTournament() {
        val rc = roomCode?.trim().orEmpty()
        if (rc.isEmpty() || !tournamentId.isNullOrBlank()) return
        val token = session.getToken()
        if (token.isNullOrBlank()) return
        lifecycleScope.launch {
            for (attempt in 0 until 3) {
                val tid = withContext(Dispatchers.IO) {
                    var c: java.net.HttpURLConnection? = null
                    try {
                        c = (java.net.URL(GA16_LINK_BASE + Uri.encode(rc) + "/link").openConnection() as java.net.HttpURLConnection).apply {
                            connectTimeout = 15000
                            readTimeout = 15000
                            setRequestProperty("Authorization", "Bearer " + token)
                        }
                        val code = c.responseCode
                        if (code == 404 || code == 403) ""
                        else if (code != 200) null
                        else JSONObject(c.inputStream.bufferedReader().use { it.readText() }).optString("tournamentId", "")
                    } catch (e: Exception) {
                        null
                    } finally {
                        c?.disconnect()
                    }
                }
                if (tid != null) {
                    if (tid.isNotBlank()) {
                        ga16LinkedTid = tid
                        android.util.Log.i("GameWebViewActivity", "GA16: sala " + rc + " pertence ao torneio " + tid)
                    }
                    return@launch
                }
                delay(3000L)
            }
        }
    }

    private fun loadGame() {
        if (ga3BlockIfOffline()) return
        reportGameState(true)
        val baseUrl = game.gameUrl
        if (baseUrl.isNullOrBlank()) { Toast.makeText(this, "URL do jogo não configurada", Toast.LENGTH_LONG).show(); finish(); return }
        val hasRoom = !roomCode.isNullOrBlank() && !role.isNullOrBlank()
        val isFreeRoomStart = hasRoom && start == "1" && !startToken.isNullOrBlank()
        val isTournamentRoom = hasRoom && (!tournamentId.isNullOrBlank() || !matchId.isNullOrBlank())
        val isTraining = mode == "training"
        val safePlayers = if (players > 0) players else game.maxPlayers.coerceAtLeast(2)
        inRoomSession = isFreeRoomStart
        val url = when {
            isTraining -> { val sep = if (baseUrl.contains("?")) "&" else "?"; val safeDifficulty = Uri.encode(difficulty ?: "normal"); "${baseUrl}${sep}mode=training&players=$safePlayers&difficulty=$safeDifficulty&start=1" }
            isFreeRoomStart -> freeRoomPath(startToken) ?: baseUrl
            isTournamentRoom -> { val sep = if (baseUrl.contains("?")) "&" else "?"; val safeRoom = Uri.encode(roomCode ?: ""); val safeRole = Uri.encode(role ?: ""); "${baseUrl}${sep}room=$safeRoom&role=$safeRole&tournament=1" }
            else -> baseUrl
        }
        val fullUrl = buildGameUrl(url)
        val w = warm
        if (w != null) { GameWebViewPool.deliver(w, fullUrl); if (w.loaded) progressBar.visibility = android.view.View.GONE; ga15HealWarm(fullUrl) } else { webView.loadUrl(fullUrl) } // GA_FASE15V3_GAMEFIX
        if (warm?.loaded == true) ga3OnPageFinished()
    }

    /**
     * Ponte exposta ao JavaScript do jogo.
     *
     * O jogo chama:
     * - window.AndroidInterface.reportarResultado(json)
     * - window.AndroidInterface.requestNotifyRoom(code)
     * - window.AndroidInterface.openRoomLobby(create)
     * - window.AndroidInterface.shareRoomInvite(code)
     * - window.AndroidInterface.reportPresence(state, roomCode, gameId)
     */
    inner class AndroidBridge {
        @JavascriptInterface
        fun reportarResultado(jsonStr: String) {
            if (resultReported) return  // Evita duplo reporte
            resultReported = true

            lifecycleScope.launch {
                try {
                    val json = JSONObject(jsonStr)
                    val scores = json.optJSONArray("scores")
                    val winnerIdx = json.optInt("winner", -1)

                    if (scores == null || scores.length() < 2 || winnerIdx < 0) {
                        android.util.Log.e("WebView", "Resultado inválido: $jsonStr")
                        return@launch
                    }

                    val scoreP1 = scores.optInt(0, 0)
                    val scoreP2 = scores.optInt(1, 0)

                    reportToBackend(scoreP1, scoreP2)
                } catch (e: Exception) {
                    android.util.Log.e("WebView", "Erro ao parsear resultado: ${e.message}", e)
                }
            }
        }

        /**
         * Chamado pelo jogo HTML5 quando o utilizador pede convites/notificação para a sala.
         *
         * O jogo chama:
         *   window.AndroidInterface.requestNotifyRoom(code)
         *
         * Segurança:
         * - normaliza o code;
         * - rejeita code vazio;
         * - se a Activity já estiver numa sala com roomCode definido, exige que o code pedido seja o mesmo;
         * - usa o token JWT da sessão local;
         * - delega para RoomApiClient.notifyRoomPlayers();
         * - evita chamadas simultâneas repetidas com AtomicBoolean.
         */
        @JavascriptInterface
        fun requestNotifyRoom(code: String) {
            val safeCode = code.trim().uppercase()

            if (safeCode.isEmpty()) {
                lifecycleScope.launch(Dispatchers.Main) {
                    Toast.makeText(
                        this@GameWebViewActivity,
                        "Código da sala inválido",
                        Toast.LENGTH_SHORT
                    ).show()
                }
                return
            }

            val expectedRoomCode = roomCode?.trim()?.uppercase().orEmpty()
            if (expectedRoomCode.isNotEmpty() && expectedRoomCode != safeCode) {
                android.util.Log.w(
                    "WebView",
                    "requestNotifyRoom rejeitado: code=$safeCode esperado=$expectedRoomCode"
                )
                lifecycleScope.launch(Dispatchers.Main) {
                    Toast.makeText(
                        this@GameWebViewActivity,
                        "Código da sala não corresponde à sessão",
                        Toast.LENGTH_SHORT
                    ).show()
                }
                return
            }

            if (!notifyInFlight.compareAndSet(false, true)) {
                return
            }

            lifecycleScope.launch {
                try {
                    val token = session.getToken()
                    if (token.isNullOrBlank()) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(
                                this@GameWebViewActivity,
                                "Login necessário para notificar jogadores",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                        return@launch
                    }

                    val result = RoomApiClient.notifyRoomPlayers(token, safeCode)

                    withContext(Dispatchers.Main) {
                        if (result.success) {
                            Toast.makeText(
                                this@GameWebViewActivity,
                                "Convites enviados",
                                Toast.LENGTH_SHORT
                            ).show()
                        } else {
                            Toast.makeText(
                                this@GameWebViewActivity,
                                result.error ?: "Falha ao notificar jogadores",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.e("WebView", "Erro requestNotifyRoom: ${e.message}", e)
                    withContext(Dispatchers.Main) {
                        Toast.makeText(
                            this@GameWebViewActivity,
                            "Erro ao notificar jogadores",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                } finally {
                    notifyInFlight.set(false)
                }
            }
        }

        /**
         * Chamado pelo jogo HTML5 quando o utilizador toca em Multiplayer 1x1 dentro do APK.
         *
         * O jogo chama:
         *   window.AndroidInterface.openRoomLobby(true)
         *
         * Comportamento seguro:
         * - não entra directo no jogo;
         * - cria sala no backend REST /api/rooms/create;
         * - abre o lobby nativo RoomLobbyActivity com o code retornado;
         * - o lobby nativo mostra Participar/Recusar e só abre o jogo quando canStart=true.
         */
        @JavascriptInterface
        fun openRoomLobby(create: Boolean) {
            if (!create) {
                lifecycleScope.launch(Dispatchers.Main) {
                    Toast.makeText(
                        this@GameWebViewActivity,
                        "Use criar sala para abrir o lobby nativo.",
                        Toast.LENGTH_SHORT
                    ).show()
                }
                return
            }

            if (!roomCreateInFlight.compareAndSet(false, true)) {
                return
            }

            lifecycleScope.launch {
                try {
                    val token = session.getToken()
                    if (token.isNullOrBlank()) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(
                                this@GameWebViewActivity,
                                "Login necessário para criar sala.",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                        return@launch
                    }

                    val result = RoomApiClient.createRoom(
                        token = token,
                        gameId = game.id
                    )

                    withContext(Dispatchers.Main) {
                        val code = result.state?.room?.code?.trim()?.uppercase()

                        if (result.success && !code.isNullOrBlank()) {
                            startActivity(
                                Intent(
                                    this@GameWebViewActivity,
                                    RoomLobbyActivity::class.java
                                ).apply {
                                    putExtra(RoomLobbyActivity.EXTRA_ROOM_CODE, code)
                                }
                            )
                        } else {
                            Toast.makeText(
                                this@GameWebViewActivity,
                                result.error ?: "Não foi possível criar a sala.",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.e("WebView", "Erro openRoomLobby: ${e.message}", e)
                    withContext(Dispatchers.Main) {
                        Toast.makeText(
                            this@GameWebViewActivity,
                            "Erro ao abrir lobby nativo.",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                } finally {
                    roomCreateInFlight.set(false)
                }
            }
        }

        /**
         * Chamado pelo jogo HTML5 para partilhar convite de sala usando o link canónico nativo.
         *
         * O jogo chama:
         *   window.AndroidInterface.shareRoomInvite(code)
         */
        @JavascriptInterface
        fun shareRoomInvite(code: String) {
            val safeCode = code.trim().uppercase()
            if (safeCode.isEmpty()) return

            lifecycleScope.launch(Dispatchers.Main) {
                try {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, "$INVITE_BASE_URL$safeCode")
                    }

                    startActivity(Intent.createChooser(send, "Partilhar sala"))
                } catch (e: Exception) {
                    android.util.Log.e("WebView", "Erro shareRoomInvite: ${e.message}", e)
                    Toast.makeText(
                        this@GameWebViewActivity,
                        "Não foi possível partilhar o convite.",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }

        /**
         * Chamado pelo jogo HTML5 para reportar presença.
         *
         * O jogo chama:
         *   window.AndroidInterface.reportPresence(state, roomCode, gameId)
         *
         * Estados aceites pelo backend:
         *   OFFLINE, IDLE, IN_LOBBY, IN_GAME
         */
        @JavascriptInterface
        fun reportPresence(state: String, roomCode: String?, gameId: String?) {
            val safeState = state.trim().uppercase()
            if (safeState !in ALLOWED_PRESENCE_STATES) return

            lifecycleScope.launch {
                sendPresenceNow(safeState, roomCode, gameId)
            }
        }

        /**
         * Chamado pelos jogos HTML5 quando uma partida termina.
         *
         * GA16_UNIFY:
         *   'ga16_<win|loss|draw|closed|end>' → fim de partida vindo do ga16-post.js v3 (depois do popup):
         *                                       grava o histórico 1× e fecha o WebView.
         *   'host'|'guest'                    → só guarda quem venceu (sala). NÃO grava nem fecha.
         *   'win'|'loss'|'draw'               → só guarda o resultado (treino/CPU). NÃO grava nem fecha.
         *   Para jogos ainda sem ga16-post.js v3, um fallback de 7 s fecha e grava na mesma.
         */
        @JavascriptInterface
        fun reportMatchResult(winnerRole: String, scoresJson: String) {
            val winner = winnerRole.trim().lowercase()
            if (winner.startsWith("ga16_")) {
                val o = winner.removePrefix("ga16_")
                if (o in GA16_OUTCOMES) runOnUiThread { ga16PostGame(o, scoresJson) }
                return
            }
            when (winner) {
                "host", "guest" -> {
                    ga16PendingRole = winner
                    val myRole = role?.trim()?.lowercase()
                    val o = if (myRole == "host" || myRole == "guest") (if (myRole == winner) "win" else "loss") else "end"
                    ga16ArmFallback(o)
                }
                "win", "loss", "draw" -> {
                    ga16PendingSingle = winner
                    ga16ArmFallback(winner)
                }
                else -> android.util.Log.w("WebView", "reportMatchResult: winner desconhecido=$winner")
            }
        }
    }

    private suspend fun reportToBackend(scoreP1: Int, scoreP2: Int) {
        val token = session.getToken() ?: return
        val tId = tournamentId ?: return
        val mId = matchId ?: return

        withContext(Dispatchers.Main) {
            Toast.makeText(this@GameWebViewActivity, "A reportar resultado...", Toast.LENGTH_SHORT).show()
        }

        withContext(Dispatchers.IO) {
            try {
                val result = ApiClient.reportHtml5MatchResult(token, tId, mId, scoreP1, scoreP2)
                withContext(Dispatchers.Main) {
                    when (result) {
                        "FINISHED" -> {
                            Toast.makeText(this@GameWebViewActivity, "✅ Vitória registada!", Toast.LENGTH_LONG).show()
                            // Volta ao torneio após 2s
                            android.os.Handler(mainLooper).postDelayed({ finish() }, 2000)
                        }
                        "WAITING_OTHER" -> {
                            Toast.makeText(this@GameWebViewActivity, "⏳ A aguardar o adversário...", Toast.LENGTH_LONG).show()
                            android.os.Handler(mainLooper).postDelayed({ finish() }, 3000)
                        }
                        "DISPUTED" -> {
                            Toast.makeText(this@GameWebViewActivity, "⚠️ Resultado em disputa", Toast.LENGTH_LONG).show()
                            android.os.Handler(mainLooper).postDelayed({ finish() }, 3000)
                        }
                        else -> {
                            Toast.makeText(this@GameWebViewActivity, "Erro ao reportar", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("WebView", "Erro ao reportar: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@GameWebViewActivity, "Falha de rede", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun handleRoomUrl(rawUrl: String?): Boolean {
        if (rawUrl.isNullOrBlank()) return false

        return try {
            val uri = Uri.parse(rawUrl)
            val scheme = uri.scheme?.lowercase()
            val host = uri.host?.lowercase()

            if (scheme == "gamearena" && host == "r") {
                val code = uri.lastPathSegment?.trim()?.uppercase()
                if (!code.isNullOrBlank()) {
                    openRoomLobbyByCode(code)
                    return true
                }
            }

            if (scheme == "https" && host != null && host in ROOM_HTTPS_HOSTS) {
                val segments = uri.pathSegments
                if (segments.size >= 2 && segments[0].equals("r", ignoreCase = true)) {
                    val code = segments[1].trim().uppercase()
                    if (code.isNotEmpty()) {
                        openRoomLobbyByCode(code)
                        return true
                    }
                }
            }

            false
        } catch (e: Exception) {
            android.util.Log.e("WebView", "Erro handleRoomUrl: ${e.message}", e)
            false
        }
    }

    private fun openRoomLobbyByCode(code: String) {
        val safeCode = code.trim().uppercase()
        if (safeCode.isEmpty()) return

        startActivity(
            Intent(this, RoomLobbyActivity::class.java).apply {
                putExtra(RoomLobbyActivity.EXTRA_ROOM_CODE, safeCode)
            }
        )
    }

    private suspend fun sendPresenceNow(
        state: String,
        overrideRoomCode: String? = null,
        overrideGameId: String? = null
    ) {
        if (!presenceInFlight.compareAndSet(false, true)) return

        try {
            val token = session.getToken()
            if (token.isNullOrBlank()) return

            val rc = overrideRoomCode ?: roomCode
            val gid = overrideGameId ?: if (::game.isInitialized) game.id else null

            RoomApiClient.heartbeatPresence(
                token = token,
                state = state,
                currentRoomCode = rc,
                currentGameId = gid
            )
        } catch (e: Exception) {
            android.util.Log.e("WebViewPresence", "Erro heartbeat: ${e.message}", e)
        } finally {
            presenceInFlight.set(false)
        }
    }

    private fun startPresenceHeartbeat() {
        if (presenceJob != null) return

        presenceJob = lifecycleScope.launch {
            while (isActive) {
                sendPresenceNow("IN_GAME")
                delay(PRESENCE_INTERVAL_MS)
            }
        }
    }

    private fun stopPresenceHeartbeat() {
        presenceJob?.cancel()
        presenceJob = null
    }

    private fun sendPresenceFireAndForget(state: String) {
        CoroutineScope(Dispatchers.IO).launch {
            sendPresenceNow(state)
        }
    }

    override fun onResume() {
        super.onResume()
        if (session.isLoggedIn() && inRoomSession && webViewReady) {
            startPresenceHeartbeat()
        }
    }

    override fun onPause() {
        stopPresenceHeartbeat()
        if (session.isLoggedIn() && inRoomSession) {
            lifecycleScope.launch {
                sendPresenceNow("IDLE")
            }
        }
        super.onPause()
    }

    // ═══ GA16_POSTGAME: fim de partida → fecha o WebView (ambos) → Histórico (torneio) | Histórico global (sala/treino) ═══
    private fun ga16Tid(): String? =
        tournamentId?.takeIf { it.isNotBlank() } ?: ga16LinkedTid?.takeIf { it.isNotBlank() }

    /** Reserva por push (ADVANCED / RESULT / FINISHED) — o caminho principal é o game_over do socket. */
    private fun ga16OnPushEnded(tid: String, kind: String) {
        val mine = ga16Tid()
        if (mine.isNullOrBlank() || mine != tid || isFinishing) return
        // um push atrasado da partida anterior nunca fecha uma partida acabada de abrir
        if (android.os.SystemClock.elapsedRealtime() - ga16CreatedAt < 20_000L) return
        val won = kind == Ga15EliminationBus.TYPE_ADVANCED || kind == Ga15EliminationBus.TYPE_GA16_RESULT
        ga16PostGame(if (won) "win" else "end", "")
    }

    /** GA16_UNIFY: jogo que reportou host/guest/win/loss/draw mas não mandou 'ga16_*' → fecha na mesma. */
    private fun ga16ArmFallback(outcome: String) {
        ga3Main.postDelayed({
            if (!ga16Closing.get() && !isFinishing && !isDestroyed) {
                android.util.Log.w("GameWebViewActivity", "GA16: sem ga16Post do jogo → fallback ($outcome)")
                ga16PostGame(outcome, "")
            }
        }, GA16_FALLBACK_MS)
    }

    private fun ga16PostGame(outcome: String, payloadJson: String) {
        if (isFinishing || isDestroyed) return
        if (!ga16Closing.compareAndSet(false, true)) return
        ga16RecordOnce(outcome, payloadJson)
        val tid = ga16Tid()
        if (!tid.isNullOrBlank()) {
            val i = Intent(this, TournamentDetailActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("tournamentId", tid)
                .putExtra(Ga15EliminationBus.EXTRA_TAB, "history")
            if (outcome == "loss") i.putExtra(Ga15EliminationBus.EXTRA_ELIMINATED, "no torneio")
            startActivity(i)
            finish()
            return
        }
        // GA16_REDIRECT: sala livre / treino → aba Histórico (o popup do jogo já esteve 3,5 s no ecrã)
        openHistoryTab()
        finish()
    }

    /**
     * GA16_UNIFY: grava o histórico UMA vez por partida.
     *  - treino / CPU (sem sala): grava só para mim (singleplayer).
     *  - sala 1x1: só o HOST grava (POST /record com roomCode grava os 2 lados) → sem duplicados.
     *  - sala com 3+ jogadores: não grava aqui (o /record só conhece host+guest; fica para a Fase 18 no servidor).
     * Corre num scope próprio: o lifecycleScope é cancelado pelo finish() logo a seguir.
     */
    private fun ga16RecordOnce(outcome: String, payloadJson: String) {
        if (outcome == "closed") return
        if (!ga16Recorded.compareAndSet(false, true)) return
        val token = session.getToken()
        if (token.isNullOrBlank() || !::game.isInitialized) return
        val gid = game.id
        val rc = roomCode?.trim()?.takeIf { it.isNotEmpty() }
        val p = try { if (payloadJson.isBlank()) JSONObject() else JSONObject(payloadJson) } catch (e: Exception) { JSONObject() }
        val single = mode == "training" || rc == null

        if (single) {
            val res = ga16PendingSingle ?: outcome.takeIf { it == "win" || it == "loss" || it == "draw" } ?: return
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    ApiClient.recordMatchResult(token = token, gameId = gid, result = res, mode = "singleplayer", opponents = 1)
                } catch (e: Exception) {
                    android.util.Log.e("WebView", "GA16 record (treino) erro: ${e.message}", e)
                }
            }
            return
        }

        if (!role.equals("host", ignoreCase = true)) return
        val np = p.optInt("players", 0).takeIf { it > 0 } ?: players
        if (np > 2) return
        val ws = if (p.has("winnerSeat")) p.optInt("winnerSeat", -1) else -1
        val winnerRole = when {
            outcome == "draw" -> "draw"
            ga16PendingRole != null -> ga16PendingRole
            ws == 0 -> "host"
            ws == 1 -> "guest"
            outcome == "win" -> "host"   // eu sou o host
            outcome == "loss" -> "guest"
            else -> null                 // backend grava "jogado" para os 2
        }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                ApiClient.recordMatchResult(
                    token = token,
                    gameId = gid,
                    mode = "multiplayer",
                    opponents = 1,
                    roomCode = rc,
                    winnerRole = winnerRole
                )
            } catch (e: Exception) {
                android.util.Log.e("WebView", "GA16 record (sala) erro: ${e.message}", e)
            }
        }
    }

    private fun openHistoryTab() {
        try {
            val i = Intent(this, TournamentsActivity::class.java)
                .putExtra("initial_tab", "history")
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            startActivity(i)
        } catch (e: Exception) {
            ga16GoHome()
        }
    }

    private fun ga16GoHome() {
        var home: Intent? = null
        for (cn in arrayOf("com.gamearena.ui.MainActivity", "com.gamearena.MainActivity")) {
            try { home = Intent(this, Class.forName(cn)); break } catch (e: ClassNotFoundException) { }
        }
        if (home == null) home = packageManager.getLaunchIntentForPackage(packageName)
        if (home != null) {
            home.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            try { startActivity(home) } catch (e: Exception) { }
        }
        finish()
    }

    override fun onDestroy() {
        ga17PendingMic?.let { try { it.deny() } catch (_: Exception) { } } // GA17_VOICE
        ga17PendingMic = null
        ga3Main.removeCallbacksAndMessages(null)
        ga3OfflineScreen?.release()
        stopPresenceHeartbeat()
        if (session.isLoggedIn() && inRoomSession) {
            sendPresenceFireAndForget("OFFLINE")
        }
        if (webViewReady) {
            webView.destroy()
            webViewReady = false
        }
        Ga15EliminationBus.unregister(this, ga15v5ElimReceiver) // GA15V5_ELIM
        Ga15EliminationBus.unregister(this, ga16EndedReceiver) // GA16_POSTGAME
        ga16EndedReceiver = null
        ga15v5ElimReceiver = null
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (webViewReady && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    private fun ga3InitOverlays() {
        ga3Overlay = findViewById(R.id.gameLoadingOverlay)
        ga3Pct = findViewById(R.id.gameLoadingPct)
        val off = findViewById<android.view.View>(R.id.offlineView)
        if (off != null) ga3OfflineScreen = GaOfflineScreen(this) { ga3Retry() }.bind(off)
        ga3ShowLoading()
    }

    private fun ga3ShowLoading() {
        val o = ga3Overlay ?: return
        o.animate().cancel()
        o.alpha = 1f
        o.visibility = android.view.View.VISIBLE
        ga3Pct?.text = "0%"
        ga3Main.postDelayed({ ga3SafetyReveal() }, 15_000L)
    }

    private fun ga3HideLoading() {
        val o = ga3Overlay ?: return
        if (o.visibility != android.view.View.VISIBLE) return
        o.animate().cancel()
        o.animate().alpha(0f).setDuration(200).withEndAction {
            if (o.alpha < 0.05f) {
                o.visibility = android.view.View.GONE
                o.alpha = 1f
            }
        }.start()
    }

    private fun ga3SetProgress(p: Int) {
        ga3Pct?.text = p.coerceIn(0, 100).toString() + "%"
    }

    private fun ga3OnPageStarted(url: String? = null) {
        // GA_FASE6: NAO limpar o erro aqui. O WebView arranca a pagina de erro nativa
        // DEPOIS de onReceivedError; limpar aqui fazia o onPageFinished revela-la.
        if (!url.isNullOrBlank() && (url.startsWith("http://") || url.startsWith("https://"))) ga6LastMainUrl = url
    }

    private fun ga3OnPageFinished() {
        if (ga3PageError || !webViewReady) return
        if (webView.url.orEmpty().startsWith("about:")) return
        // GA_FASE6: so revela depois de confirmar que NAO e a pagina de erro nativa
        val seq = ++ga6CheckSeq
        ga3Main.postDelayed({ if (seq == ga6CheckSeq) ga6Reveal() }, 2500L)
        try {
            webView.evaluateJavascript(ga6NetErrorJs) { r ->
                if (seq != ga6CheckSeq) return@evaluateJavascript
                ga6CheckSeq++
                if (ga3PageError || !webViewReady) return@evaluateJavascript
                if (r == "true") ga3OnMainFrameError(null, WebViewClient.ERROR_UNKNOWN) else ga6Reveal()
            }
        } catch (e: Exception) {
            ga6CheckSeq++
            ga6Reveal()
        }
    }

    private fun ga6Reveal() {
        if (ga3PageError || !webViewReady) return
        if (ga6ClearHistory) { ga6ClearHistory = false; webView.clearHistory() }
        webView.visibility = android.view.View.VISIBLE
        ga3OfflineScreen?.hide()
        ga3HideLoading()
    }

    private fun ga6HandleExternalScheme(rawUrl: String?): Boolean {
        if (rawUrl.isNullOrBlank()) return false
        val scheme = rawUrl.substringBefore(":", "").lowercase()
        if (scheme in setOf("", "http", "https", "about", "data", "javascript", "blob", "file")) return false
        try {
            val target = if (scheme == "intent") Intent.parseUri(rawUrl, Intent.URI_INTENT_SCHEME).apply { addCategory(Intent.CATEGORY_BROWSABLE); component = null; selector = null }
            else Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl))
            startActivity(target)
        } catch (e: Exception) {
            Toast.makeText(this, "Não foi possível abrir este link.", Toast.LENGTH_SHORT).show()
        }
        return true
    }

    private fun ga3SafetyReveal() {
        if (ga3PageError || ga3PendingLoad || ga3OfflineScreen?.isShowing == true) return
        ga3OnPageFinished()
    }

    private fun ga3OnMainFrameError(url: String?, code: Int) {
        val failing = if (!url.isNullOrBlank()) url else if (webViewReady) webView.url else null
        ga3PageError = true
        ga6CheckSeq++
        if (!failing.isNullOrBlank() && (failing.startsWith("http://") || failing.startsWith("https://"))) ga3FailedUrl = failing
        android.util.Log.w("GA_WEBVIEW", "Falha ao carregar o jogo (codigo " + code + ", online=" + GaNet.isOnline(this) + ")")
        if (webViewReady) {
            webView.visibility = android.view.View.INVISIBLE
            try { webView.stopLoading(); webView.loadUrl("about:blank") } catch (e: Exception) {}
        }
        ga3ShowOffline()
    }

    private fun ga3ShowOffline() {
        if (webViewReady) webView.visibility = android.view.View.INVISIBLE
        ga3Overlay?.let {
            it.animate().cancel()
            it.visibility = android.view.View.GONE
        }
        val scr = ga3OfflineScreen
        if (scr != null) scr.show() else Toast.makeText(this, "Sem conexão com a internet", Toast.LENGTH_LONG).show()
    }

    private fun ga3BlockIfOffline(): Boolean {
        if (GaNet.isOnline(this)) return false
        ga3PendingLoad = true
        ga3ShowOffline()
        return true
    }

    private fun ga3Retry() {
        if (!GaNet.isOnline(this)) {
            ga3OfflineScreen?.nudge()
            return
        }
        ga3OfflineScreen?.hide()
        ga3PageError = false
        ga3ShowLoading()
        if (ga3PendingLoad) {
            ga3PendingLoad = false
            loadGame()
            return
        }
        if (!webViewReady) return
        val u = ga3FailedUrl
        ga3FailedUrl = null
        if (!u.isNullOrBlank()) webView.loadUrl(u) else webView.reload()
    }

    // GA_FASE15V3_GAMEFIX: o WebView pré-aquecido foi carregado SEM token. Se o jogo não consumir o
    // __gaLaunch e mostrar "Parâmetros inválidos", recarrega uma vez o URL completo (com token).
    private var ga15Healed = false
    private fun ga15HealWarm(fullUrl: String) {
        val js = "(function(){try{var t=(document.body&&document.body.innerText)||'';return t.indexOf('metros inv')>=0}catch(e){return false}})()"
        for (d in longArrayOf(900L, 2500L)) {
            webView.postDelayed(Runnable {
                if (ga15Healed || isFinishing || isDestroyed) return@Runnable
                try {
                    webView.evaluateJavascript(js) { r ->
                        if (r == "true" && !ga15Healed && !isFinishing) {
                            ga15Healed = true
                            android.util.Log.w("GameWebViewActivity", "GA15: página aquecida sem token → recarregar URL completo")
                            webView.loadUrl(fullUrl)
                        }
                    }
                } catch (_: Exception) { }
            }, d)
        }
    }

    /**
     * GA17_VOICE: concede SÓ o microfone (nunca câmara) e SÓ a páginas dos nossos domínios.
     * Se o Android ainda não deu RECORD_AUDIO, pede-a e responde ao WebView depois.
     */
    private fun ga17OnPermissionRequest(request: PermissionRequest?) {
        if (request == null) return
        if (isFinishing || isDestroyed) { request.deny(); return }
        val host = try { request.origin?.host?.lowercase() } catch (e: Exception) { null }
        val wantsMic = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
        if (!wantsMic || host == null || host !in ROOM_HTTPS_HOSTS) {
            android.util.Log.w("GameWebViewActivity", "GA17: pedido recusado host=$host recursos=${request.resources.joinToString()}")
            request.deny()
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            return
        }
        ga17PendingMic?.let { try { it.deny() } catch (_: Exception) { } }
        ga17PendingMic = request
        ga17MicPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    private fun buildGameUrl(url: String): String = Html5RoomLauncher.withQuality(this, url)

    private fun reportGameState(loading: Boolean) {
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getSystemService(GameManager::class.java)
                ?.setGameState(GameState(loading, GameState.MODE_GAMEPLAY_INTERRUPTIBLE))
        }
    }

    private fun pinRefreshRate(target: Float) {
        if (android.os.Build.VERSION.SDK_INT < 23) return
        val d = (if (android.os.Build.VERSION.SDK_INT >= 30) display
                 else @Suppress("DEPRECATION") windowManager.defaultDisplay) ?: return
        val cur = d.mode
        val mode = d.supportedModes
            .filter { it.physicalWidth == cur.physicalWidth && it.physicalHeight == cur.physicalHeight }
            .minByOrNull { abs(it.refreshRate - target) } ?: return
        window.attributes = window.attributes.also { it.preferredDisplayModeId = mode.modeId }
    }


    private fun freeRoomPath(token: String?): String? {
        val baseUrl = game.gameUrl
        if (baseUrl.isNullOrBlank() || mode == "training") return null
        val rc = roomCode
        val r = role
        if (rc.isNullOrBlank() || r.isNullOrBlank() || start != "1" || startToken.isNullOrBlank()) return null
        val safePlayers = if (players > 0) players else game.maxPlayers.coerceAtLeast(2)
        return Html5RoomLauncher.freeRoomPath(baseUrl, rc, r, token, roomMode ?: Html5RoomLauncher.ROOM_MODE_FREE, safePlayers, scenarioIdx, characterIdx)
    }
    private fun swapInWarmWebView(warmWeb: WebView) {
        val placeholder = webView
        val parent = placeholder.parent as android.view.ViewGroup
        val index = parent.indexOfChild(placeholder)
        val lp = placeholder.layoutParams
        parent.removeView(placeholder)
        placeholder.destroy()
        warmWeb.id = R.id.webView
        parent.addView(warmWeb, index, lp)
        webView = warmWeb
    }
    
}
