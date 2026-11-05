package com.gamearena.ui

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.gamearena.R
import com.gamearena.data.UserSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * GA20_CONSOLE (Fase 20.1): sala de matchmaking do Arena Console.
 *
 * O lobby é uma página HTML (backend/public/games/console/lobby.html) com Socket.IO no namespace /console,
 * igual aos outros jogos multijogador. Esta Activity só:
 *   1. entrega à página a ISO escolhida (nome, tamanho, impressão digital) e o token da sessão;
 *   2. quando o servidor manda console_start, abre o emulador externo com o Intent
 *      "com.gamearena.console.START_GAME" (contrato em CONTRATO-ARENA-CONSOLE.md).
 */
class ConsoleLobbyActivity : BaseActivity() {
    companion object {
        const val EXTRA_ROM = "rom_path"
        private const val CONSOLE_PACKAGE = "com.gamearena.console" // GA20_ARENA: só o Arena Console oficial recebe a partida
        private const val LOBBY_URL = Ga20Console.SERVER_URL + "/games/console/lobby.html"
        private val ALLOWED_HOSTS = setOf("gamer-fortune.onrender.com")
        private val CODE_RE = Regex("^[A-Z0-9]{4,8}$")
        private val PID_RE = Regex("^[a-f0-9]{8,64}$")
        private val TOKEN_RE = Regex("^[A-Za-z0-9_-]{8,128}$")
    }

    private lateinit var session: UserSession
    private var web: WebView? = null
    private var status: TextView? = null
    private var romFile: File? = null
    private var rom: Ga20Roms.Rom? = null
    @Volatile private var launched = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session = UserSession(this)
        if (!session.isLoggedIn()) {
            Toast.makeText(this, "Login necessário", Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        val path = intent.getStringExtra(EXTRA_ROM)
        val f = if (path.isNullOrBlank()) null else File(path)
        if (f == null || !f.isFile) {
            Toast.makeText(this, "Jogo não encontrado. Volta a carregá-lo.", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        romFile = f

        val root = FrameLayout(this)
        root.setBackgroundColor(ContextCompat.getColor(this, R.color.bg_deep))
        val st = TextView(this)
        st.text = "A preparar o jogo…"
        st.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
        st.textSize = 14f
        st.gravity = Gravity.CENTER
        root.addView(st, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        status = st
        setContentView(root)

        lifecycleScope.launch {
            val r0 = Ga20Roms.meta(f)
            val r = if (r0.fp.isNotBlank()) r0 else withContext(Dispatchers.IO) {
                val withFp = r0.copy(fp = Ga20Roms.fingerprint(f))
                Ga20Roms.saveMeta(withFp)
                withFp
            }
            if (isFinishing || isDestroyed) return@launch
            rom = r
            openLobby(root)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openLobby(root: FrameLayout) {
        if (!GaNet.isOnline(this)) {
            status?.text = "😿  Sem ligação à internet.\nLiga-te e volta a abrir o jogo."
            return
        }
        val w = WebView(this)
        w.setBackgroundColor(ContextCompat.getColor(this, R.color.bg_deep))
        w.visibility = View.INVISIBLE
        w.settings.javaScriptEnabled = true
        w.settings.domStorageEnabled = true
        w.settings.mediaPlaybackRequiresUserGesture = true
        w.settings.allowFileAccess = false
        w.settings.allowContentAccess = false
        w.addJavascriptInterface(Bridge(), "AndroidInterface")
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val host = request?.url?.host?.lowercase()
                return host == null || host !in ALLOWED_HOSTS // só o nosso domínio dentro do lobby
            }
            @android.annotation.TargetApi(23)
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: android.webkit.WebResourceError?) {
                if (request == null || request.isForMainFrame) {
                    view?.visibility = View.INVISIBLE
                    status?.text = "😿  Não foi possível abrir a sala.\nVerifica a ligação e tenta outra vez."
                }
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url != null && url.startsWith(LOBBY_URL)) view?.visibility = View.VISIBLE
            }
        }
        root.addView(w, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        web = w
        w.loadUrl(LOBBY_URL)
    }

    /** Ponte JS. Só responde a páginas do nosso domínio (a navegação para fora é bloqueada acima). */
    inner class Bridge {
        @JavascriptInterface
        fun getLaunch(): String {
            val r = rom ?: return "{}"
            return JSONObject()
                .put("token", session.getToken() ?: "")
                .put("protocol", Ga20Console.PROTOCOL_VERSION)
                .put("rom", JSONObject().put("name", r.name).put("size", r.size).put("fp", r.fp).put("gid", r.gid))
                .toString()
        }

        @JavascriptInterface
        fun startConsole(json: String) {
            runOnUiThread { launchConsole(json) }
        }

        @JavascriptInterface
        fun shareCode(code: String) {
            val c = code.trim().uppercase()
            if (!CODE_RE.matches(c)) return
            runOnUiThread {
                try {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, "Joga comigo no Arena Console da GameArena! Código da sala: " + c)
                    }
                    startActivity(Intent.createChooser(send, "Partilhar sala"))
                } catch (e: Exception) {
                    Toast.makeText(this@ConsoleLobbyActivity, "Não foi possível partilhar.", Toast.LENGTH_SHORT).show()
                }
            }
        }

        @JavascriptInterface
        fun close() {
            runOnUiThread { finish() }
        }
    }

    private fun jsStatus(ok: Boolean, msg: String) {
        val q = JSONObject.quote(msg)
        web?.evaluateJavascript("window.gaConsoleLaunched&&window.gaConsoleLaunched(" + ok + "," + q + ")", null)
    }

    private fun launchConsole(json: String) {
        if (isFinishing || isDestroyed) return
        val f = romFile ?: return
        val r = rom ?: return
        val m = try { JSONObject(json) } catch (e: Exception) { return }
        val role = m.optString("role")
        val code = m.optString("code").trim().uppercase()
        val pid = m.optString("pid")
        val peer = m.optString("peerPid")
        val startToken = m.optString("startToken")
        if ((role != "host" && role != "guest") || !CODE_RE.matches(code) || !PID_RE.matches(pid) || !PID_RE.matches(peer) || !TOKEN_RE.matches(startToken)) {
            android.util.Log.w("GA20", "console_start inválido: " + json.take(200))
            jsStatus(false, "Dados da partida inválidos.")
            return
        }
        val uri: Uri? = Ga20Console.romUri(this, f)
        val b = Bundle().apply {
            putString(Ga20Console.EXTRA_ISO_PATH, f.absolutePath)
            putString(Ga20Console.EXTRA_ISO_URI, uri?.toString() ?: "")
            putString(Ga20Console.EXTRA_ISO_NAME, r.name)
            putString(Ga20Console.EXTRA_ISO_FINGERPRINT, r.fp)
            putString(Ga20Console.EXTRA_GAME_ID, r.gid)
            putString(Ga20Console.EXTRA_ROLE, role)
            putString(Ga20Console.EXTRA_PEER_ID, pid)
            putString(Ga20Console.EXTRA_REMOTE_PEER_ID, peer)
            putString(Ga20Console.EXTRA_ROOM_CODE, code)
            putString(Ga20Console.EXTRA_START_TOKEN, startToken)
            putString(Ga20Console.EXTRA_SERVER_URL, Ga20Console.SERVER_URL)
            putString(Ga20Console.EXTRA_SIGNAL_NAMESPACE, Ga20Console.SIGNAL_NAMESPACE)
            putInt(Ga20Console.EXTRA_PROTOCOL, Ga20Console.PROTOCOL_VERSION)
        }
        val i = Intent(Ga20Console.ACTION_START_GAME).apply {
            addCategory(Intent.CATEGORY_DEFAULT)
            setPackage(CONSOLE_PACKAGE)               // GA20_ARENA: nenhuma outra app recebe o token nem a ISO
            putExtra("arena_auth", ga20Auth())        // GA20_ARENA: prova de que vem da Game Arena (getCreatorPackage)
            putExtras(b)                          // chaves soltas (iso_path, role, peer_id, server_url, …)
            putExtra(Ga20Console.EXTRA_BUNDLE, b) // e o mesmo Bundle agrupado
            if (uri != null) {
                clipData = ClipData.newRawUri("rom", uri) // a permissão de leitura vai pelo ClipData (sem setData → o filtro do emulador só precisa da action)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        if (i.resolveActivity(packageManager) == null) {
            jsStatus(false, "Arena Console não instalado.")
            android.app.AlertDialog.Builder(this)
                .setTitle("Arena Console não instalado")
                .setMessage("Para jogar jogos de PSP precisas da app Arena Console. Ela vai estar disponível em breve. A tua sala continua aberta.")
                .setPositiveButton("OK", null)
                .show()
            return
        }
        try {
            launched = true
            startActivity(i)
            jsStatus(true, "Arena Console aberto.")
        } catch (e: Exception) {
            launched = false
            android.util.Log.e("GA20", "startActivity: ${e.message}", e)
            jsStatus(false, "Não foi possível abrir o Arena Console.")
            Toast.makeText(this, "Não foi possível abrir o Arena Console.", Toast.LENGTH_LONG).show()
        }
    }

    /** GA20_ARENA: PendingIntent nunca enviado; o Arena Console lê getCreatorPackage() e verifica a assinatura desta app. */
    private fun ga20Auth(): android.app.PendingIntent {
        val flags = if (android.os.Build.VERSION.SDK_INT >= 23) android.app.PendingIntent.FLAG_IMMUTABLE else 0
        return android.app.PendingIntent.getActivity(this, 2020, Intent(this, ConsoleLobbyActivity::class.java), flags)
    }

    override fun onDestroy() {
        web?.let {
            try {
                it.stopLoading()
                (it.parent as? android.view.ViewGroup)?.removeView(it)
                it.destroy()
            } catch (e: Exception) { }
        }
        web = null
        super.onDestroy()
    }
}
