package com.gamearena.ui

// GA15V5_CREATE — Criar Torneio segue o MESMO fluxo da Sala:
//   (A) abre o jogo HTML em modo setup (role=host, ga15_mode=tournament) → o jogo devolve configJson
//   (B) formulário claro: Jogo · Cenário · Jogadores por partida 🔒 (vêm do jogo)
//       + Total de jogadores, Pausa, Inscrições, Lembretes, Regras + calculadora automática
//   POST /api/tournaments (t15=true) → o servidor fixa as regras e gera as chaves sozinho
//   (logo que o torneio enche ou quando as inscrições fecham). Sem ecrã escuro, sem botão "Gerar chave".

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import com.gamearena.R
import com.gamearena.data.ApiClient
import com.gamearena.data.UserSession
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class CreateTournamentActivity : BaseActivity() {

    companion object {
        const val EXTRA_GAME = "game"
        const val EXTRA_GAME_ID = "gameId"
        private const val API_URL = "https://gamer-fortune.onrender.com/api/tournaments"
        private const val MATCH_MINUTES = 6 // = default do t15Engine (a duração saiu da UI no v4)
        private const val STATE_PHASE_B = "ga15v5PhaseB"
        private const val STATE_GAME = "ga15v5Game"
        private const val STATE_CONFIG = "ga15v5Config"

        // Espelho de backend/services/gameRules.js → [default, min, max]. O servidor volta a validar.
        // GA19_RULES: neonrush 2–8 por partida (flappy fica 2–4 em torneio).
        private val GAME_RULES: Map<String, IntArray> = mapOf(
            "dama" to intArrayOf(2, 2, 2),
            "airhockey" to intArrayOf(2, 2, 2),
            "ludo" to intArrayOf(4, 2, 4),
            "pool" to intArrayOf(2, 2, 2),
            "fruit" to intArrayOf(2, 2, 4),
            "flappy" to intArrayOf(2, 2, 4),
            "galinhas" to intArrayOf(2, 2, 4),
            "bubble" to intArrayOf(4, 2, 4),
            "impostor" to intArrayOf(8, 4, 10),
            "neonrush" to intArrayOf(2, 2, 8),
            "hockey" to intArrayOf(2, 2, 2)
        )
        // (sem constantes legadas)
    }

    private lateinit var session: UserSession
    private lateinit var gameIcon: ImageView
    private lateinit var gameNameTv: TextView
    private lateinit var gameInfoTv: TextView
    private lateinit var titleInput: EditText
    private lateinit var modesGroup: LinearLayout
    private lateinit var playersGroup: LinearLayout
    private lateinit var entryFeeInput: EditText
    private lateinit var prizePreview: TextView
    private lateinit var breakGroup: LinearLayout
    private lateinit var expiryGroup: LinearLayout
    private lateinit var remindersGroup: LinearLayout
    private lateinit var rulesInput: EditText
    private lateinit var rulesCounter: TextView
    private lateinit var errorMessage: TextView
    private lateinit var btnCreate: Button
    private lateinit var loadingBar: ProgressBar
    private var calcView: TextView? = null

    private var gameJson = ""
    private var gameObj = JSONObject()
    private var gameId = ""
    private var gameName = "Jogo"
    private var configJson = "{}"
    private var scenarioLabel = "Padrão"
    private var playersPerMatch = 2
    private var totalPlayers = 8
    private var breakMinutes = 1
    private var expiryMinutes = 60
    private val reminders = linkedSetOf(10, 3)
    private var phaseB = false
    private var creating = false
    private var titleTouched = false
    private var settingTitle = false
    private var listenersInstalled = false

    private val setupLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cfg = res.data?.getStringExtra("configJson")
        if (res.resultCode == RESULT_OK && !cfg.isNullOrBlank()) {
            applyGameConfig(cfg)
            showForm()
        } else if (phaseB) {
            showForm() // "Reconfigurar" cancelado → mantém o que já havia
        } else {
            Toast.makeText(this, "Configuração do jogo cancelada", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_create_tournament)
        session = UserSession(this)
        if (!session.isLoggedIn()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }
        bindViews()
        findViewById<ImageView>(R.id.btnBack).setOnClickListener { finish() }
        btnCreate.setOnClickListener { v ->
            v.playSoundEffect(android.view.SoundEffectConstants.CLICK)
            createTournament()
        }

        if (savedInstanceState != null && savedInstanceState.getBoolean(STATE_PHASE_B, false)) {
            val saved = savedInstanceState.getString(STATE_GAME).orEmpty()
            if (saved.isNotEmpty() && parseGame(saved)) {
                applyGameConfig(savedInstanceState.getString(STATE_CONFIG) ?: "{}")
                showForm()
                return
            }
        }

        setFormVisible(false)
        val (json, id) = resolveGameFromIntent()
        if (json != null && parseGame(json)) {
            startSetup()
        } else if (!id.isNullOrBlank()) {
            loadingBar.visibility = View.VISIBLE
            lifecycleScope.launch {
                val found = try {
                    val games = ApiClient.fetchGames()
                    val g = games.firstOrNull { it.id == id }
                    if (g != null) Gson().toJson(g) else null
                } catch (e: Exception) {
                    null
                }
                loadingBar.visibility = View.GONE
                if (found != null && parseGame(found)) startSetup() else failNoGame()
            }
        } else {
            failNoGame()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (phaseB && gameJson.isNotEmpty()) {
            outState.putBoolean(STATE_PHASE_B, true)
            outState.putString(STATE_GAME, gameJson)
            outState.putString(STATE_CONFIG, configJson)
        }
    }

    private fun bindViews() {
        gameIcon = findViewById(R.id.gameIcon)
        gameNameTv = findViewById(R.id.gameName)
        gameInfoTv = findViewById(R.id.gameInfo)
        titleInput = findViewById(R.id.titleInput)
        modesGroup = findViewById(R.id.modesGroup)
        playersGroup = findViewById(R.id.playersGroup)
        entryFeeInput = findViewById(R.id.entryFeeInput)
        prizePreview = findViewById(R.id.prizePreview)
        breakGroup = findViewById(R.id.breakGroup)
        expiryGroup = findViewById(R.id.expiryGroup)
        remindersGroup = findViewById(R.id.remindersGroup)
        rulesInput = findViewById(R.id.rulesInput)
        rulesCounter = findViewById(R.id.rulesCounter)
        errorMessage = findViewById(R.id.errorMessage)
        btnCreate = findViewById(R.id.btnCreate)
        loadingBar = findViewById(R.id.loadingBar)
    }

    private fun failNoGame() {
        Toast.makeText(this, "Escolhe um jogo para criar o torneio", Toast.LENGTH_SHORT).show()
        finish()
    }

    private fun setFormVisible(visible: Boolean) {
        val content = findViewById<View>(android.R.id.content)
        content.alpha = if (visible) 1f else 0f
    }

    // ------------------------------------------------------------------ jogo escolhido
    /** Aceita o jogo vindo da grelha em qualquer formato (JSON do GameProfile, objeto ou só o id). */
    private fun resolveGameFromIntent(): Pair<String?, String?> {
        val extras = intent.extras ?: return Pair(null, null)
        var json: String? = null
        var id: String? = null
        for (key in extras.keySet()) {
            @Suppress("DEPRECATION")
            val v = extras.get(key)
            if (v is com.gamearena.launcher.GameProfile) {
                if (json == null) json = Gson().toJson(v)
            } else if (v is String) {
                val s = v.trim()
                if (json == null && s.startsWith("{")) {
                    val o = try { JSONObject(s) } catch (e: Exception) { null }
                    if (o != null && (o.has("id") || o.has("gameUrl"))) json = s
                } else if (id == null && s.isNotEmpty() &&
                    key.lowercase(Locale.ROOT).replace("_", "").contains("gameid")) {
                    id = s
                }
            }
        }
        return Pair(json, id)
    }

    private fun parseGame(json: String): Boolean {
        val o = try { JSONObject(json) } catch (e: Exception) { return false }
        val id = o.optString("id", "")
        if (id.isBlank()) return false
        gameJson = json
        gameObj = o
        gameId = id
        gameName = listOf("displayName", "name", "title", "gameName")
            .map { o.optString(it, "").trim() }
            .firstOrNull { it.isNotEmpty() && it != "null" } ?: "Jogo"
        return true
    }

    private fun startSetup() {
        val url = gameObj.optString("gameUrl", "").trim()
        if (url.isEmpty() || url == "null") {
            // jogo sem HTML de setup → usa as regras do jogo
            applyGameConfig("{}")
            showForm()
            return
        }
        setupLauncher.launch(
            Intent(this, GameSetupActivity::class.java)
                .putExtra(GameSetupActivity.EXTRA_GAME, gameJson)
                .putExtra(GameSetupActivity.EXTRA_ROLE, "host")
                .putExtra(GameSetupActivity.EXTRA_MODE, GameSetupActivity.MODE_TOURNAMENT)
        )
    }

    private fun rulesFor(): IntArray {
        val cands = listOf(gameId, gameObj.optString("slug", ""), gameObj.optString("key", ""),
            gameObj.optString("code", ""), gameName, gameObj.optString("name", ""))
            .map { it.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]"), "") }
            .filter { it.isNotEmpty() }
        for (c in cands) GAME_RULES[c]?.let { return it }
        val keys = GAME_RULES.keys.sortedByDescending { it.length }
        for (c in cands) {
            val k = keys.firstOrNull { c.contains(it) }
            if (k != null) return GAME_RULES.getValue(k)
        }
        return intArrayOf(2, 2, 16)
    }

    private fun applyGameConfig(cfg: String) {
        configJson = cfg.ifBlank { "{}" }
        val o = try { JSONObject(configJson) } catch (e: Exception) { JSONObject() }
        val r = rulesFor()
        val asked = firstInt(o, "playersPerMatch", "players", "maxPlayers", "playerCount", "numPlayers", "playersCount") ?: 0
        playersPerMatch = if (asked >= r[1] && asked <= r[2]) asked else r[0]
        scenarioLabel = scenarioOf(o)
        if (!phaseB || totalPlayers < playersPerMatch) {
            totalPlayers = (playersPerMatch * 4).coerceIn(maxOf(2, playersPerMatch), 100)
        }
    }

    private fun firstInt(o: JSONObject, vararg keys: String): Int? {
        for (k in keys) {
            if (!o.has(k) || o.isNull(k)) continue
            val v = o.opt(k)
            if (v is Number) return v.toInt()
            if (v is String) v.trim().toIntOrNull()?.let { return it }
        }
        return null
    }

    private fun scenarioOf(o: JSONObject): String {
        val keys = listOf("scenarioName", "scenarioLabel", "scenarioTitle", "mapName", "arenaName", "themeName",
            "scenario", "cenario", "map", "arena", "theme", "stage", "level")
        for (k in keys) {
            if (!o.has(k) || o.isNull(k)) continue
            val v = o.opt(k)
            if (v is String && v.isNotBlank()) return prettify(v)
            if (v is Number) return "Cenário " + (v.toInt() + 1)
            if (v is JSONObject) {
                val n = listOf("name", "label", "title").map { v.optString(it, "") }.firstOrNull { it.isNotBlank() }
                if (n != null) return prettify(n)
            }
        }
        return "Padrão"
    }

    private fun prettify(s: String): String {
        val t = s.trim().replace('_', ' ').replace('-', ' ')
        if (t != t.lowercase(Locale.ROOT)) return t
        return t.split(' ').filter { it.isNotEmpty() }
            .joinToString(" ") { w -> w.replaceFirstChar { it.titlecase(Locale.getDefault()) } }
    }

    /** MISSÃO 2: "FRUIT ARENA · Premium · 31/10 22:30" — sem segmentos repetidos. */
    private fun defaultTitle(): String {
        val seen = HashSet<String>()
        val segs = gameName.split("·").map { it.trim() }.filter { it.isNotEmpty() && seen.add(it.lowercase(Locale.ROOT)) }
        val base = if (segs.isEmpty()) "Torneio" else segs.joinToString(" · ")
        return base + " · " + SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date())
    }

    // ------------------------------------------------------------------ formulário (fase B)
    private fun showForm() {
        phaseB = true
        setFormVisible(true)
        loadingBar.visibility = View.GONE
        errorMessage.visibility = View.GONE

        gameNameTv.text = gameName
        gameInfoTv.text = "🔒  $scenarioLabel  ·  $playersPerMatch jogadores/partida"
        loadIcon()

        if (!titleTouched || titleInput.text.isNullOrBlank()) {
            settingTitle = true
            titleInput.setText(defaultTitle())
            settingTitle = false
        }

        labelBefore(modesGroup)?.text = "DEFINIDO NO JOGO  🔒"
        modesGroup.removeAllViews()
        modesGroup.addView(chip("🎮  $gameName", true, locked = true))
        modesGroup.addView(chip("🗺  $scenarioLabel", true, locked = true))
        modesGroup.addView(chip("👥  $playersPerMatch por partida", true, locked = true))
        modesGroup.addView(chip("↺  Reconfigurar no jogo", false) { startSetup() })

        labelBefore(playersGroup)?.text = "TOTAL DE JOGADORES (${maxOf(2, playersPerMatch)}–100)"
        ensureCalcView()

        rulesInput.filters = arrayOf(InputFilter.LengthFilter(2000))
        rulesCounter.text = "${rulesInput.text?.length ?: 0}/2000"
        if (!listenersInstalled) {
            listenersInstalled = true
            titleInput.addTextChangedListener(simpleWatcher { if (!settingTitle) titleTouched = true })
            rulesInput.addTextChangedListener(simpleWatcher { rulesCounter.text = "${rulesInput.text?.length ?: 0}/2000" })
            entryFeeInput.addTextChangedListener(simpleWatcher { updatePrize() })
        }

        btnCreate.text = "🏆  Criar Torneio"
        renderAll()
    }

    private fun renderAll() {
        renderPlayers()
        renderBreak()
        renderExpiry()
        renderReminders()
        updatePrize()
        updateCalc()
    }

    private fun loadIcon() {
        val url = listOf("iconUrl", "coverUrl", "imageUrl", "logoUrl", "icon", "cover")
            .map { gameObj.optString(it, "").trim() }
            .firstOrNull { it.startsWith("http") } ?: return
        try {
            val req = coil.request.ImageRequest.Builder(this).data(url).target(gameIcon).build()
            coil.ImageLoader(this).enqueue(req)
        } catch (e: Throwable) {
        }
    }

    private fun labelBefore(group: View): TextView? {
        val holder = group.parent as? View ?: return null
        val col = holder.parent as? ViewGroup ?: return null
        val idx = col.indexOfChild(holder)
        return if (idx > 0) col.getChildAt(idx - 1) as? TextView else null
    }

    private fun ensureCalcView() {
        if (calcView != null) return
        val holder = playersGroup.parent as? View ?: return
        val col = holder.parent as? LinearLayout ?: return
        val tv = TextView(this).apply {
            setBackgroundResource(R.drawable.bg_panel_card)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setTextColor(getColor(R.color.text_primary))
            textSize = 12f
            setLineSpacing(0f, 1.25f)
        }
        col.addView(tv, col.indexOfChild(holder) + 1,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(18) })
        calcView = tv
    }

    private fun chip(label: String, selected: Boolean, locked: Boolean = false, onClick: (() -> Unit)? = null): TextView =
        TextView(this).apply {
            text = label
            textSize = 13f
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
            maxLines = 1
            setPadding(dp(16), dp(9), dp(16), dp(9))
            setBackgroundResource(if (selected) R.drawable.bg_subtab_active else R.drawable.bg_subtab_idle)
            setTextColor(getColor(if (selected) R.color.bg_deep else R.color.text_primary))
            if (locked) alpha = 0.9f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { marginEnd = dp(8) }
            if (onClick != null) {
                isClickable = true
                setOnClickListener { v ->
                    v.playSoundEffect(android.view.SoundEffectConstants.CLICK)
                    onClick()
                }
            }
        }

    private fun renderPlayers() {
        playersGroup.removeAllViews()
        val min = maxOf(2, playersPerMatch)
        val presets = listOf(2, 4, 8, 16, 32, 64, 100).filter { it >= min }
        presets.forEach { n ->
            playersGroup.addView(chip("$n", totalPlayers == n) { totalPlayers = n; renderPlayers(); updatePrize(); updateCalc() })
        }
        val custom = totalPlayers !in presets
        playersGroup.addView(chip(if (custom) "✎  $totalPlayers" else "✎  Custom", custom) {
            askNumber("Total de jogadores", "$min a 100", min, 100) { v ->
                totalPlayers = v; renderPlayers(); updatePrize(); updateCalc()
            }
        })
    }

    private fun renderBreak() {
        breakGroup.removeAllViews()
        val presets = listOf(1, 2, 3, 5, 10)
        presets.forEach { m -> breakGroup.addView(chip("$m min", breakMinutes == m) { breakMinutes = m; renderBreak(); updateCalc() }) }
        val custom = breakMinutes !in presets
        breakGroup.addView(chip(if (custom) "✎  $breakMinutes min" else "✎  Custom", custom) {
            askNumber("Pausa entre rondas (minutos)", "1 a 60", 1, 60) { v -> breakMinutes = v; renderBreak(); updateCalc() }
        })
    }

    private fun renderExpiry() {
        expiryGroup.removeAllViews()
        val presets = listOf(30 to "30 min", 60 to "1 h", 360 to "6 h", 1440 to "1 dia", 10080 to "1 semana")
        presets.forEach { (m, label) -> expiryGroup.addView(chip(label, expiryMinutes == m) { expiryMinutes = m; renderExpiry(); updateCalc() }) }
        val custom = presets.none { it.first == expiryMinutes }
        expiryGroup.addView(chip(if (custom) "✎  " + fmtDur(expiryMinutes) else "✎  Custom", custom) {
            askNumber("Inscrições fecham em (minutos)", "5 a 10080 (7 dias)", 5, 10080) { v -> expiryMinutes = v; renderExpiry(); updateCalc() }
        })
    }

    private fun renderReminders() {
        remindersGroup.removeAllViews()
        val presets = listOf(1, 3, 5, 10, 15, 30)
        val all = (presets + reminders).toSortedSet()
        all.forEach { m ->
            remindersGroup.addView(chip("$m min", m in reminders) {
                if (m in reminders) reminders.remove(m)
                else if (reminders.size >= 5) Toast.makeText(this, "Máximo 5 lembretes", Toast.LENGTH_SHORT).show()
                else reminders.add(m)
                renderReminders(); updateCalc()
            })
        }
        remindersGroup.addView(chip("✎  Custom", false) {
            askNumber("Lembrete (minutos antes)", "1 a 60", 1, 60) { v ->
                if (reminders.size >= 5 && v !in reminders) Toast.makeText(this, "Máximo 5 lembretes", Toast.LENGTH_SHORT).show()
                else reminders.add(v)
                renderReminders(); updateCalc()
            }
        })
    }

    private fun askNumber(title: String, hint: String, min: Int, max: Int, onOk: (Int) -> Unit) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER
            this.hint = hint
            setPadding(dp(20), dp(14), dp(20), dp(14))
        }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setView(input)
            .setPositiveButton("OK") { _, _ ->
                val v = input.text.toString().trim().toIntOrNull()
                if (v == null || v < min || v > max) {
                    Toast.makeText(this, "Valor entre $min e $max", Toast.LENGTH_SHORT).show()
                } else onOk(v)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun entryFee(): Double = entryFeeInput.text.toString().trim().replace(',', '.').toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0

    private fun updatePrize() {
        prizePreview.text = String.format(Locale.getDefault(), "R$ %.2f", entryFee() * totalPlayers)
    }

    // ------------------------------------------------------------------ calculadora (espelho do t15Engine)
    private fun partition(n: Int, k: Int): List<Int> {
        val m = (n + k - 1) / k
        val base = n / m
        val extra = n % m
        return List(m) { i -> base + if (i < extra) 1 else 0 }
    }

    private fun planRounds(n: Int, k: Int): List<List<Int>> {
        val rounds = mutableListOf(partition(n, k))
        var prev = rounds[0].size
        while (prev > 1) {
            val s = partition(prev, k)
            rounds.add(s)
            prev = s.size
        }
        return rounds
    }

    private fun fmtDur(min: Int): String {
        val d = min / 1440
        val h = (min % 1440) / 60
        val m = min % 60
        return when {
            d > 0 -> "${d}d" + (if (h > 0) " ${h}h" else "")
            h > 0 -> "${h}h" + (if (m > 0) " ${m}m" else "")
            else -> "${m}m"
        }
    }

    private fun fmtWhen(ms: Long): String {
        val a = Calendar.getInstance()
        val b = Calendar.getInstance().apply { timeInMillis = ms }
        val sameDay = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
        return if (sameDay) "às " + SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
        else "a " + SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date(ms))
    }

    private fun updateCalc() {
        val tv = calcView ?: return
        val k = maxOf(2, playersPerMatch)
        val n = maxOf(2, totalPlayers)
        val plan = planRounds(n, k)
        val matches = plan.sumOf { r -> r.count { it >= 2 } }
        val rounds = plan.size
        val etaMin = rounds * (MATCH_MINUTES + breakMinutes)
        val closes = System.currentTimeMillis() + expiryMinutes * 60_000L
        val start = closes + ((reminders.maxOrNull() ?: 0) + 1) * 60_000L
        val end = start + etaMin * 60_000L
        tv.text = "🧮  $matches partidas de $k jogadores em $rounds rondas · ETA: ${fmtDur(etaMin)}\n" +
            "⏳  Inscrições fecham ${fmtWhen(closes)}  ·  🏁 fim previsto ${fmtWhen(end)}\n" +
            "⚡  Se encher antes, as chaves são geradas logo (automático)."
    }

    private fun simpleWatcher(onChanged: () -> Unit): TextWatcher = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) { onChanged() }
    }

    private fun showError(msg: String) {
        errorMessage.text = msg
        errorMessage.visibility = View.VISIBLE
    }

    // ------------------------------------------------------------------ criar
    private fun createTournament() {
        if (creating || !phaseB) return
        val token = session.getToken()
        if (token.isNullOrEmpty()) { showError("Sessão expirada — entra de novo."); return }
        if (totalPlayers < 2 || totalPlayers > 100) { showError("Escolhe entre 2 e 100 jogadores."); return }
        errorMessage.visibility = View.GONE

        val title = titleInput.text.toString().trim().ifEmpty { defaultTitle() }
        val rules = rulesInput.text.toString().trim()
        val fee = entryFee()
        val body = JSONObject().apply {
            put("gameId", gameId)
            put("mode", "1v" + (playersPerMatch - 1))
            put("type", "LONG")
            put("timeMode", "INFINITE")
            put("title", title)
            put("description", "")
            if (rules.isNotEmpty()) put("rules", rules)
            put("maxPlayers", totalPlayers)
            if (fee > 0) put("entryFee", fee)
            put("t15", true)
            put("playersPerMatch", playersPerMatch)
            put("scenario", try { JSONObject(configJson) } catch (e: Exception) { JSONObject() })
            put("scenarioLabel", scenarioLabel)
            put("breakMinutes", breakMinutes)
            put("matchMinutes", MATCH_MINUTES)
            put("registrationMinutes", expiryMinutes)
            put("expiry", "${expiryMinutes}m")
            put("reminderMinutes", JSONArray(reminders.sortedDescending()))
            put("timezone", TimeZone.getDefault().id)
        }

        creating = true
        btnCreate.isEnabled = false
        loadingBar.visibility = View.VISIBLE
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { post(API_URL, token, body) }
            creating = false
            btnCreate.isEnabled = true
            loadingBar.visibility = View.GONE
            val json = result.second
            val id = json?.optJSONObject("tournament")?.optString("id", "").orEmpty()
            if (result.first in 200..299 && id.isNotEmpty()) {
                startActivity(Intent(this@CreateTournamentActivity, TournamentDetailActivity::class.java)
                    .putExtra("tournamentId", id)
                    .putExtra("justCreated", true))
                finish()
            } else {
                showError(json?.optString("error", "")?.takeIf { it.isNotBlank() }
                    ?: if (result.first == 0) "Sem ligação ao servidor. Tenta de novo." else "Erro ao criar torneio (${result.first}).")
            }
        }
    }

    private fun post(url: String, token: String, body: JSONObject): Pair<Int, JSONObject?> {
        return try {
            val conn = URL(url).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = 20_000
                conn.readTimeout = 60_000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.setRequestProperty("Accept", "application/json")
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                Pair(code, try { JSONObject(text) } catch (e: Exception) { null })
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            Pair(0, null)
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
