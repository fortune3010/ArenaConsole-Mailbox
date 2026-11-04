package com.gamearena.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import com.gamearena.R
import com.gamearena.data.ApiClient
import com.gamearena.data.TournamentDto
import com.gamearena.data.TournamentMatchDto
import com.gamearena.data.TournamentPlayerDto
import com.gamearena.data.UserSession
import kotlinx.coroutines.launch

/**
 * Ecrã de detalhes de um torneio.
 *
 * Mostra:
 *   - Info principal (nome, categoria, prémio, entrada)
 *   - Regras
 *   - Aba 1: Participantes
 *   - Aba 2: Chaves (bracket)
 *   - Botão de ação dinâmico (Inscrever-se / Sair / Ver partida)
 */
class TournamentDetailActivity : BaseActivity() {

    private lateinit var session: UserSession

    private var tournamentId: String = ""
    private var tournament: TournamentDto? = null
    private var myActiveMatch: TournamentMatchDto? = null
    private var isPlayerInTournament: Boolean = false
    private var currentTab: String = "players"
    private var justCreated: Boolean = false

    private lateinit var title: TextView
    private lateinit var category: TextView
    private lateinit var players: TextView
    private lateinit var fee: TextView
    private lateinit var prize: TextView
    private lateinit var statusBanner: LinearLayout
    private lateinit var statusText: TextView
    private lateinit var rulesText: TextView
    private lateinit var tabPlayers: TextView
    private lateinit var tabBracket: TextView
    private lateinit var tabContent: LinearLayout
    private lateinit var actionButton: Button
    private lateinit var loadingBar: ProgressBar
    private lateinit var errorMessage: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_tournament_detail)

        session = UserSession(this)

        if (!session.isLoggedIn()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        // Tenta pegar o ID de 3 formas: extra direto, deep link gamearena://, deep link https
        tournamentId = intent.getStringExtra("tournamentId") ?: extractIdFromDeepLink(intent) ?: ""
        justCreated = intent.getBooleanExtra("justCreated", false)

        if (tournamentId.isEmpty()) {
            Toast.makeText(this, "Erro: torneio não especificado", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        bindViews()
        setupListeners()
        loadTournament()
        Ga15TournamentBar.attach(this, tournamentId, actionButton, justCreated) { shareTournament() } // GA_FASE15B
        Ga15DetailSkin.install(this, title, rulesText, tabBracket, actionButton, tournamentId) // GA_FASE15V3_PREMIUM
        ga15v5Install() // GA15V5_HISTORY
    }

    /**
     * GA16_POSTGAME: a Activity é singleTask. Quando o jogo fecha e reabre o detalhe (CLEAR_TOP),
     * a instância que já está na pilha recebe o Intent AQUI (não em onCreate). Sem isto a aba
     * "Histórico" e o overlay de eliminação nunca apareciam depois de uma partida.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!::session.isInitialized) return
        val newId = intent.getStringExtra("tournamentId") ?: extractIdFromDeepLink(intent)
        if (!newId.isNullOrBlank() && newId != tournamentId) {
            recreate() // outro torneio: reconstrói o ecrã com o novo Intent
            return
        }
        if (intent.getStringExtra(Ga15EliminationBus.EXTRA_TAB) == "history" && ga15v5TabHistory != null) {
            currentTab = "history"
        }
        loadTournament() // volta a desenhar a aba actual (renderCurrentTab) com os dados novos
        val phrase = intent.getStringExtra(Ga15EliminationBus.EXTRA_ELIMINATED)
        if (!phrase.isNullOrBlank()) ga15v5ShowEliminated(phrase)
    }

    private fun bindViews() {
        title = findViewById(R.id.tournamentTitle)
        category = findViewById(R.id.tournamentCategory)
        players = findViewById(R.id.tournamentPlayers)
        fee = findViewById(R.id.tournamentFee)
        prize = findViewById(R.id.tournamentPrize)
        statusBanner = findViewById(R.id.statusBanner)
        statusText = findViewById(R.id.statusText)
        rulesText = findViewById(R.id.rulesText)
        tabPlayers = findViewById(R.id.tabPlayers)
        tabBracket = findViewById(R.id.tabBracket)
        tabContent = findViewById(R.id.tabContent)
        actionButton = findViewById(R.id.actionButton)
        loadingBar = findViewById(R.id.loadingBar)
        errorMessage = findViewById(R.id.errorMessage)
    }

    private fun setupListeners() {
        findViewById<ImageView>(R.id.btnBack).setOnClickListener { finish() }

        tabPlayers.setOnClickListener { switchTab("players") }
        tabBracket.setOnClickListener { switchTab("bracket") }

        actionButton.setOnClickListener { v ->
            v.playSoundEffect(android.view.SoundEffectConstants.CLICK)
            handleAction()
        }
    }

    private fun loadTournament() {
        loadingBar.visibility = View.VISIBLE
        actionButton.isEnabled = false

        lifecycleScope.launch {
            tournament = ApiClient.getTournamentDetail(tournamentId)

            loadingBar.visibility = View.GONE
            actionButton.isEnabled = true

            if (tournament == null) {
                Toast.makeText(this@TournamentDetailActivity, "Torneio não encontrado", Toast.LENGTH_SHORT).show()
                finish()
                return@launch
            }

            renderTournament(tournament!!)
            renderCurrentTab()

            // Verifica se estou inscrito no torneio
            checkIfImPlayer()

            // Se torneio está LIVE, procura a minha partida ativa
            if (tournament!!.status == "LIVE") {
                loadMyActiveMatch()
            } else {
                updateActionButton()
            }

            // Se veio de "criar torneio" → mostra mensagem de sucesso
            if (justCreated) {
                Toast.makeText(this@TournamentDetailActivity, "✅ Torneio criado! Partilha o link.", Toast.LENGTH_LONG).show()
                justCreated = false
            }
        }
    }

    private fun renderTournament(t: TournamentDto) {
        title.text = t.title
        category.text = "${t.mode} · ${typeLabel(t.type)} · ${timeModeLabel(t.timeMode)}"
        players.text = "${t.currentPlayers}/${t.maxPlayers}"
        fee.text = "R$ %.2f".format(t.entryFee ?: 0.0)
        prize.text = "R$ %.2f".format(t.prizeTotal ?: 0.0)
        rulesText.text = t.rules ?: "Sem regras definidas."

        // Banner de estado
        when (t.status) {
            "OPEN" -> {
                statusBanner.visibility = View.VISIBLE
                statusText.text = "Inscrições abertas"
                statusBanner.setBackgroundResource(R.drawable.bg_lock_green)
            }
            "FULL" -> {
                statusBanner.visibility = View.VISIBLE
                statusText.text = "Torneio cheio — a aguardar início"
                statusBanner.setBackgroundResource(R.drawable.bg_lock_red)
            }
            "LIVE" -> {
                statusBanner.visibility = View.VISIBLE
                statusText.text = "🔴 A DECORRER AGORA"
                statusBanner.setBackgroundResource(R.drawable.bg_live_badge)
            }
            "FINISHED" -> {
                statusBanner.visibility = View.VISIBLE
                statusText.text = "Concluído"
                statusBanner.setBackgroundResource(R.drawable.bg_panel_card)
            }
            "CANCELLED" -> {
                statusBanner.visibility = View.VISIBLE
                statusText.text = "Cancelado"
                statusBanner.setBackgroundResource(R.drawable.bg_panel_card)
            }
            else -> statusBanner.visibility = View.GONE
        }
        Ga15DetailSkin.refresh(this) // GA_FASE15V3_PREMIUM
    }

    private fun typeLabel(t: String) = when (t) {
        "FAST" -> "Rápido"
        "MEDIUM" -> "Médio"
        "LONG" -> "Longo"
        else -> t
    }

    private fun timeModeLabel(t: String) = when (t) {
        "TIMED" -> "Tempo Fixo"
        "SURVIVAL" -> "Sobrevivência"
        "INFINITE" -> "Infinito"
        else -> t
    }

    private fun switchTab(tab: String) {
        currentTab = tab
        paintTabs()
        renderCurrentTab()
    }

    private fun paintTabs() {
        if (currentTab == "players") {
            tabPlayers.setBackgroundResource(R.drawable.bg_subtab_active)
            tabPlayers.setTextColor(getColor(R.color.bg_deep))
            tabBracket.setBackgroundResource(R.drawable.bg_subtab_idle)
            tabBracket.setTextColor(getColor(R.color.text_primary))
        } else {
            tabPlayers.setBackgroundResource(R.drawable.bg_subtab_idle)
            tabPlayers.setTextColor(getColor(R.color.text_primary))
            tabBracket.setBackgroundResource(R.drawable.bg_subtab_active)
            tabBracket.setTextColor(getColor(R.color.bg_deep))
        }
    }

    private fun renderCurrentTab() {
        Ga15DetailSkin.tabs(this, tabPlayers, tabBracket, currentTab == "players") // GA_FASE15V3_PREMIUM
        when (currentTab) {
            "players" -> renderPlayers()
            "bracket" -> renderBracket()
            "history" -> ga15v5RenderHistory() // GA15V5_HISTORY
        }
        Ga15DetailSkin.refresh(this)
        ga15v5PaintTabs() // GA15V5_HISTORY
    }

    private fun renderPlayers() {
        tabContent.removeAllViews()
        loadingBar.visibility = View.VISIBLE

        lifecycleScope.launch {
            val playersList = ApiClient.getTournamentPlayers(tournamentId)
            loadingBar.visibility = View.GONE

            if (playersList.isEmpty()) {
                tabContent.addView(emptyText("Sem participantes ainda"))
                return@launch
            }

            playersList.forEachIndexed { idx, p ->
                tabContent.addView(buildPlayerRow(idx + 1, p))
            }
        }
    }

    private fun buildPlayerRow(pos: Int, p: TournamentPlayerDto): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.bg_panel_card)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) }
        }

        val posTv = TextView(this).apply {
            text = "#$pos"
            setTextColor(getColor(R.color.text_muted))
            textSize = 11f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            width = dp(32)
        }

        val avatar = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(32), dp(32)).apply { marginStart = dp(6) }
            setBackgroundResource(R.drawable.bg_avatar_ring)
            setPadding(dp(6), dp(6), dp(6), dp(6))
            setImageResource(R.drawable.ic_person_filled)
            setColorFilter(getColor(R.color.icon_vivid_blue))
        }

        val nameCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(10) }
        }
        nameCol.addView(TextView(this).apply {
            text = p.username ?: "Jogador"
            setTextColor(getColor(R.color.text_primary))
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })
        nameCol.addView(TextView(this).apply {
            text = "Nível ${p.level ?: 1}"
            setTextColor(getColor(R.color.text_muted))
            textSize = 10f
        })

        row.addView(posTv)
        row.addView(avatar)
        row.addView(nameCol)

        // Se eliminado, marca a vermelho
        if (p.eliminated == true) {
            row.addView(TextView(this).apply {
                text = "ELIMINADO"
                setTextColor(getColor(R.color.live_red))
                textSize = 9f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                letterSpacing = 0.1f
            })
        }

        return row
    }

    private fun renderBracket() {
        tabContent.removeAllViews()
        loadingBar.visibility = View.VISIBLE

        lifecycleScope.launch {
            val matches = ApiClient.getTournamentMatches(tournamentId)
            loadingBar.visibility = View.GONE

            if (matches.isEmpty()) {
                tabContent.addView(emptyText("Chaves ainda não geradas"))
                return@launch
            }

            // Agrupa por ronda
            val byRound = matches.groupBy { it.round }.toSortedMap()

            byRound.forEach { (round, list) ->
                // Header da ronda
                tabContent.addView(TextView(this@TournamentDetailActivity).apply {
                    text = roundLabel(round)
                    setTextColor(getColor(R.color.neon_green))
                    textSize = 12f
                    setTypeface(typeface, android.graphics.Typeface.BOLD)
                    letterSpacing = 0.15f
                    setPadding(0, dp(14), 0, dp(8))
                })

                list.forEach { m -> tabContent.addView(buildMatchRow(m)) }
            }
        }
    }

    private fun roundLabel(r: Int): String {
        // Heurística simples
        val totalRounds = tournament?.let { t ->
            // 8 jogadores → 3 rondas
            var rounds = 1
            var size = t.maxPlayers
            while (size > 2) { size /= 2; rounds++ }
            rounds
        } ?: 3

        return when (totalRounds - r) {
            0 -> "🏆 FINAL"
            1 -> "SEMIFINAIS"
            2 -> "QUARTOS DE FINAL"
            3 -> "OITAVOS DE FINAL"
            else -> "RONDA $r"
        }
    }

    private fun buildMatchRow(m: TournamentMatchDto): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.bg_panel_card)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) }
        }

        // Linha 1: Jogadores
        val playersRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val p1 = playerNameOrPlaceholder(m.player1Id, m, true)
        val p2 = playerNameOrPlaceholder(m.player2Id, m, false)

        val p1Tv = TextView(this).apply {
            text = p1
            setTextColor(if (m.winnerId == m.player1Id) getColor(R.color.neon_green) else getColor(R.color.text_primary))
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            gravity = Gravity.START
        }

        val scoreTv = TextView(this).apply {
            text = "${m.scoreP1 ?: "-"} : ${m.scoreP2 ?: "-"}"
            setTextColor(getColor(R.color.premium_gold))
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(dp(8), 0, dp(8), 0)
        }

        val p2Tv = TextView(this).apply {
            text = p2
            setTextColor(if (m.winnerId == m.player2Id) getColor(R.color.neon_green) else getColor(R.color.text_primary))
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            gravity = Gravity.END
        }

        playersRow.addView(p1Tv)
        playersRow.addView(scoreTv)
        playersRow.addView(p2Tv)

        row.addView(playersRow)

        // Linha 2: Estado + sala
        val statusRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(6), 0, 0)
        }

        val statusLabel = when (m.status) {
            "WAITING" -> "Aguardando"
            "READY" -> "Pronto"
            "LIVE" -> "🔴 A decorrer"
            "FINISHED" -> "Concluído"
            "WO" -> "W.O."
            "DISPUTED" -> "Em disputa"
            else -> m.status
        }

        statusRow.addView(TextView(this).apply {
            text = statusLabel
            setTextColor(getColor(R.color.text_muted))
            textSize = 10f
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        })

        if (!m.roomId.isNullOrBlank()) {
            statusRow.addView(TextView(this).apply {
                text = m.roomId
                setTextColor(getColor(R.color.icon_vivid_blue))
                textSize = 10f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                letterSpacing = 0.1f
            })
        }

        row.addView(statusRow)

        return row
    }

    private fun playerNameOrPlaceholder(userId: String?, m: TournamentMatchDto, isP1: Boolean): String {
        return if (userId == null) {
            "A definir"
        } else {
            // Tenta buscar o nome do mapa de participantes se tivermos
            "Jogador"
        }
    }

    private fun emptyText(msg: String): TextView = TextView(this).apply {
        text = msg
        setTextColor(getColor(R.color.text_muted))
        textSize = 13f
        gravity = Gravity.CENTER
        setPadding(0, dp(40), 0, dp(40))
    }

    private fun updateActionButton() {
        val t = tournament ?: return
        val myId = session.getUserId() ?: ""

        when (t.status) {
            "OPEN" -> {
                // Verifica se estou inscrito
                // Simplificação: se for o criador, mostro "Partilhar"
                // Senão mostro "Inscrever-me" ou "Sair"
                if (t.creatorId == myId) {
                    actionButton.text = "PARTILHAR TORNEIO"
                    actionButton.isEnabled = true
                } else {
                    actionButton.text = "INSCREVER-ME"
                    actionButton.isEnabled = true
                }
            }
            "FULL" -> {
                if (isPlayerInTournament) {
                    // Estou inscrito — botão para entrar na sala de espera
                    actionButton.text = "🚀  IR PARA SALA DE ESPERA"
                    actionButton.isEnabled = true
                } else if (t.creatorId == myId) {
                    actionButton.text = "PARTILHAR TORNEIO"
                    actionButton.isEnabled = true
                } else {
                    actionButton.text = "TORNEIO CHEIO"
                    actionButton.isEnabled = false
                }
            }
            "LIVE" -> {
                if (myActiveMatch != null) {
                    actionButton.text = "▶  ENTRAR NA PARTIDA"
                    actionButton.isEnabled = true
                } else {
                    actionButton.text = "A AGUARDAR OPONENTE"
                    actionButton.isEnabled = false
                }
            }
            "FINISHED" -> {
                actionButton.text = "CONCLUÍDO"
                actionButton.isEnabled = false
            }
            "CANCELLED" -> {
                actionButton.text = "CANCELADO"
                actionButton.isEnabled = false
            }
        }
    }

    private fun handleAction() {
        val t = tournament ?: return
        val myId = session.getUserId() ?: ""

        when {
            t.status == "OPEN" && t.creatorId == myId -> shareTournament()
            t.status == "OPEN" -> joinTournament()
            t.status == "FULL" && isPlayerInTournament -> openWaitingRoom()
            t.status == "FULL" && t.creatorId == myId -> shareTournament()
            t.status == "LIVE" -> enterActiveMatch()
            else -> Toast.makeText(this, "Aguarda pelo início.", Toast.LENGTH_SHORT).show()
        }
    }


    /**
     * Verifica se o utilizador está inscrito no torneio.
     */
    private fun checkIfImPlayer() {
        val myId = session.getUserId() ?: return

        lifecycleScope.launch {
            try {
                val players = ApiClient.getTournamentPlayers(tournamentId)
                isPlayerInTournament = players.any { it.userId == myId }
                updateActionButton()
            } catch (e: Exception) {
                isPlayerInTournament = false
                updateActionButton()
            }
        }
    }

    /**
     * Abre a sala de espera.
     */
    private fun openWaitingRoom() {
        val intent = Intent(this, WaitingRoomActivity::class.java)
        intent.putExtra("tournamentId", tournamentId)
        startActivity(intent)
    }

    private fun joinTournament() {
        val token = session.getToken() ?: return
        loadingBar.visibility = View.VISIBLE
        actionButton.isEnabled = false

        lifecycleScope.launch {
            val result = ApiClient.joinTournament(token, tournamentId)
            loadingBar.visibility = View.GONE
            actionButton.isEnabled = true

            if (result.success) {
                Toast.makeText(this@TournamentDetailActivity, "✅ Inscrito!", Toast.LENGTH_SHORT).show()
                loadTournament()
            } else {
                Toast.makeText(this@TournamentDetailActivity, result.error ?: "Erro", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun shareTournament() {
        val t = tournament ?: return
        val link = "https://gamearena-backend.vercel.app/t/${t.id}"
        val text = "Entra no meu torneio '${t.title}' na Game Arena!\n$link"

        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        startActivity(Intent.createChooser(intent, "Partilhar torneio"))
    }


    /**
     * Procura a partida ativa do utilizador neste torneio.
     */
    private fun loadMyActiveMatch() {
        val myId = session.getUserId() ?: return

        loadingBar.visibility = View.VISIBLE

        lifecycleScope.launch {
            try {
                val matches = ApiClient.getTournamentMatches(tournamentId)

                val active = matches.firstOrNull { m ->
                    (m.player1Id == myId || m.player2Id == myId) &&
                    (m.status == "WAITING" || m.status == "READY" || m.status == "LIVE") &&
                    m.player1Id != null && m.player2Id != null
                }

                myActiveMatch = active
                loadingBar.visibility = View.GONE
                updateActionButton()
            } catch (e: Exception) {
                loadingBar.visibility = View.GONE
                updateActionButton()
            }
        }
    }

    /**
     * Abre o MatchCaptureActivity para preparar a monitorização.
     */
    private fun enterActiveMatch() {
        val match = myActiveMatch
        val t = tournament

        if (match == null || t == null) {
            Toast.makeText(this, "Sem partida ativa. Aguarda.", Toast.LENGTH_SHORT).show()
            return
        }

        loadingBar.visibility = View.VISIBLE
        actionButton.isEnabled = false

        lifecycleScope.launch {
            try {
                val games = ApiClient.fetchGames()
                val game = games.find { it.id == t.gameId }

                loadingBar.visibility = View.GONE
                actionButton.isEnabled = true

                if (game == null) {
                    Toast.makeText(
                        this@TournamentDetailActivity,
                        "Jogo não encontrado no catálogo",
                        Toast.LENGTH_LONG
                    ).show()
                    return@launch
                }

                val myId = session.getUserId() ?: ""
                val role = if (match.player1Id == myId) "host" else "guest"
                if (!com.gamearena.launcher.Html5MatchLauncher.tryLaunch(
                        this@TournamentDetailActivity, game, t.id, match.id, role
                    )) {
                    val intent = Intent(this@TournamentDetailActivity, MatchCaptureActivity::class.java)
                    intent.putExtra("tournamentId", t.id)
                    intent.putExtra("matchId", match.id)
                    intent.putExtra("game", com.google.gson.Gson().toJson(game))
                    startActivity(intent)
                }
            } catch (e: Exception) {
                loadingBar.visibility = View.GONE
                actionButton.isEnabled = true
                Toast.makeText(
                    this@TournamentDetailActivity,
                    "Erro: ${e.message}",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    // ================= GA15V5_HISTORY: aba "Histórico" + overlay de eliminação (5 s) =================
    private var ga15v5TabHistory: TextView? = null

    private fun ga15v5Install() {
        try {
            val parent = tabBracket.parent as? android.view.ViewGroup
            if (parent != null && ga15v5TabHistory == null) {
                val tab = TextView(this).apply {
                    text = "Histórico"
                    gravity = tabBracket.gravity
                    setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, tabBracket.textSize)
                    typeface = tabBracket.typeface
                    setPadding(tabBracket.paddingLeft, tabBracket.paddingTop, tabBracket.paddingRight, tabBracket.paddingBottom)
                    maxLines = 1
                    isClickable = true
                    isFocusable = true
                    setOnClickListener { v ->
                        v.playSoundEffect(android.view.SoundEffectConstants.CLICK)
                        switchTab("history")
                    }
                }
                val lp = tabBracket.layoutParams
                val copy: android.view.ViewGroup.LayoutParams =
                    if (lp is LinearLayout.LayoutParams) LinearLayout.LayoutParams(lp)
                    else android.view.ViewGroup.LayoutParams(lp)
                parent.addView(tab, parent.indexOfChild(tabBracket) + 1, copy)
                ga15v5TabHistory = tab
            }
        } catch (e: Exception) {
            android.util.Log.w("Ga15V5", "tab Histórico: " + e.message)
        }
        if (intent.getStringExtra(Ga15EliminationBus.EXTRA_TAB) == "history" && ga15v5TabHistory != null) currentTab = "history"
        val phrase = intent.getStringExtra(Ga15EliminationBus.EXTRA_ELIMINATED)
        if (!phrase.isNullOrBlank()) ga15v5ShowEliminated(phrase)
    }

    /** Pinta a 3ª aba copiando o estilo das abas existentes (funciona com qualquer skin). */
    private fun ga15v5PaintTabs() {
        val h = ga15v5TabHistory ?: return
        fun copyStyle(from: TextView, to: TextView) {
            to.background = from.background?.constantState?.newDrawable()?.mutate()
            to.setTextColor(from.textColors)
            to.typeface = from.typeface
        }
        when (currentTab) {
            "history" -> {
                copyStyle(tabBracket, h)          // "Chaves" foi pintada como activa (isPlayers = false)
                copyStyle(tabPlayers, tabBracket) // "Jogadores" está inactiva
            }
            "players" -> copyStyle(tabBracket, h)
            else -> copyStyle(tabPlayers, h)
        }
    }

    private fun ga15v5Card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(14), dp(12), dp(14), dp(12))
        background = android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = dp(14).toFloat()
            setColor(0x149AA0B4)
            setStroke(dp(1), 0x229AA0B4)
        }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            .apply { bottomMargin = dp(10) }
    }

    private fun ga15v5Text(s: String, size: Float, bold: Boolean, color: Int? = null): TextView = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(color ?: getColor(R.color.text_primary))
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun ga15v5Clock(msValue: Long): String {
        val s = (msValue / 1000).coerceAtLeast(0)
        return String.format(java.util.Locale.US, "%02d:%02d", s / 60, s % 60)
    }

    private fun ga15v5Hour(msValue: Long): String =
        java.text.SimpleDateFormat("dd/MM HH:mm", java.util.Locale.getDefault()).format(java.util.Date(msValue))

    private fun ga15v5RenderHistory() {
        tabContent.removeAllViews()
        val token = session.getToken()
        if (token.isNullOrBlank()) {
            tabContent.addView(ga15v5Text("Inicia sessão para ver o teu histórico.", 14f, false))
            return
        }
        loadingBar.visibility = View.VISIBLE
        lifecycleScope.launch {
            val json = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                try {
                    val conn = java.net.URL("https://gamer-fortune.onrender.com/api/tournaments/$tournamentId/t15/my-history")
                        .openConnection() as java.net.HttpURLConnection
                    conn.connectTimeout = 15_000
                    conn.readTimeout = 20_000
                    conn.setRequestProperty("Authorization", "Bearer $token")
                    val code = conn.responseCode
                    val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                        ?.bufferedReader()?.use { it.readText() }.orEmpty()
                    conn.disconnect()
                    if (code in 200..299) org.json.JSONObject(body) else null
                } catch (e: Exception) {
                    null
                }
            }
            loadingBar.visibility = View.GONE
            if (isFinishing || currentTab != "history") return@launch
            tabContent.removeAllViews()
            if (json == null) {
                tabContent.addView(ga15v5Text("Não foi possível carregar o histórico. Toca na aba para tentar de novo.", 14f, false))
                return@launch
            }
            val green = 0xFF22C55E.toInt()
            val red = 0xFFEF4444.toInt()
            val grey = 0xFF9AA0B4.toInt()
            val gold = 0xFFF5B301.toInt()

            if (json.optBoolean("champion", false)) {
                tabContent.addView(ga15v5Card().apply {
                    addView(ga15v5Text("🏆 Campeão do torneio!", 17f, true, gold))
                })
            }
            json.optJSONObject("eliminated")?.let { el ->
                tabContent.addView(ga15v5Card().apply {
                    addView(ga15v5Text("❌ Eliminado " + el.optString("phrase", "no torneio"), 16f, true, red))
                    addView(ga15v5Text("O teu percurso fica guardado aqui.", 13f, false, grey))
                })
            }
            val upcoming = json.optJSONArray("upcoming") ?: org.json.JSONArray()
            for (i in 0 until upcoming.length()) {
                val u = upcoming.optJSONObject(i) ?: continue
                val opps = u.optJSONArray("opponents")
                val vs = if (opps != null && opps.length() > 0) (0 until opps.length()).joinToString(", ") { opps.optString(it) } else "a definir"
                val at = u.optLong("scheduledAtMs", 0L)
                tabContent.addView(ga15v5Card().apply {
                    addView(ga15v5Text("⏱ Próxima · " + u.optString("label"), 15f, true, green))
                    addView(ga15v5Text("vs $vs" + (if (at > 0) "  ·  " + ga15v5Hour(at) else ""), 13f, false))
                })
            }
            val history = json.optJSONArray("history") ?: org.json.JSONArray()
            if (history.length() == 0 && upcoming.length() == 0) {
                tabContent.addView(ga15v5Text("Ainda não tens partidas terminadas neste torneio.", 14f, false, grey))
                return@launch
            }
            for (i in 0 until history.length()) {
                val h = history.optJSONObject(i) ?: continue
                val result = h.optString("result")
                val (badge, color) = when (result) {
                    "WIN" -> "✅ VITÓRIA" to green
                    "LOSS" -> "❌ DERROTA" to red
                    "DRAW" -> "🤝 EMPATE" to grey
                    else -> "➡️ AVANÇO DIRECTO" to grey
                }
                val opps = h.optJSONArray("opponents")
                val vs = if (opps != null && opps.length() > 0) (0 until opps.length()).joinToString(", ") { opps.optString(it) } else "—"
                val parts = ArrayList<String>()
                if (!h.isNull("myPoints")) {
                    val mine = h.optDouble("myPoints", 0.0).toLong()
                    val theirs = if (h.isNull("opponentPoints")) "—" else h.optDouble("opponentPoints", 0.0).toLong().toString()
                    parts.add("Pontos $mine – $theirs")
                }
                val myTime = if (h.isNull("myTimeMs")) 0L else h.optLong("myTimeMs", 0L)
                val dur = if (h.isNull("durationMs")) 0L else h.optLong("durationMs", 0L)
                if (myTime > 0) parts.add("Tempo " + ga15v5Clock(myTime)) else if (dur > 0) parts.add("Duração " + ga15v5Clock(dur))
                val ended = if (h.isNull("endedAtMs")) 0L else h.optLong("endedAtMs", 0L)
                if (ended > 0) parts.add(ga15v5Hour(ended))
                tabContent.addView(ga15v5Card().apply {
                    val head = LinearLayout(this@TournamentDetailActivity).apply { orientation = LinearLayout.HORIZONTAL }
                    head.addView(ga15v5Text(badge, 14f, true, color),
                        LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                    head.addView(ga15v5Text(h.optString("label"), 12f, false, grey))
                    addView(head)
                    if (result != "BYE") addView(ga15v5Text("vs $vs", 15f, true))
                    if (parts.isNotEmpty()) addView(ga15v5Text(parts.joinToString("  ·  "), 13f, false, grey))
                })
            }
        }
    }

    private fun ga15v5ShowEliminated(phrase: String) {
        val root = findViewById<android.view.ViewGroup>(android.R.id.content) ?: return
        val white = 0xFFFFFFFF.toInt()
        val overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xEE0B0B12.toInt())
            setPadding(dp(32), dp(32), dp(32), dp(32))
            isClickable = true
            elevation = dp(24).toFloat()
        }
        overlay.addView(ga15v5Text("❌", 64f, false, white).apply { gravity = Gravity.CENTER })
        overlay.addView(ga15v5Text("Eliminado $phrase", 24f, true, white).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(6))
        })
        overlay.addView(ga15v5Text("Obrigado por jogares. O teu percurso fica no Histórico.", 14f, false, 0xB3FFFFFF.toInt()).apply {
            gravity = Gravity.CENTER
        })
        val count = ga15v5Text("A abrir o Histórico em 5 s", 13f, false, 0x80FFFFFF.toInt()).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(24), 0, 0)
        }
        overlay.addView(count)
        root.addView(overlay, android.widget.FrameLayout.LayoutParams(
            android.widget.FrameLayout.LayoutParams.MATCH_PARENT, android.widget.FrameLayout.LayoutParams.MATCH_PARENT))
        overlay.alpha = 0f
        overlay.animate().alpha(1f).setDuration(250).start()
        var left = 5
        val tick = object : Runnable {
            override fun run() {
                if (isFinishing || isDestroyed) return
                left--
                if (left <= 0) {
                    overlay.animate().alpha(0f).setDuration(250).withEndAction { root.removeView(overlay) }.start()
                    if (ga15v5TabHistory != null) switchTab("history")
                    return
                }
                count.text = "A abrir o Histórico em $left s"
                overlay.postDelayed(this, 1000)
            }
        }
        overlay.postDelayed(tick, 1000)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    /**
     * Extrai o ID do torneio de um deep link.
     * Suporta:
     *   gamearena://t/{id}
     *   https://gamearena-backend.vercel.app/t/{id}
     */
    private fun extractIdFromDeepLink(intent: Intent?): String? {
        val data = intent?.data ?: return null
        val path = data.path ?: return null
        // path será "/{id}" ou "/t/{id}"
        val segments = path.split("/").filter { it.isNotBlank() }
        // Se último segmento for o ID, devolve-o
        return segments.lastOrNull()
    }

}
