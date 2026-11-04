package com.gamearena.ui

import android.content.Intent
import android.os.Bundle
import android.animation.ArgbEvaluator
import android.animation.ValueAnimator
import android.os.Build
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.gamearena.R
import com.gamearena.data.ApiClient
import com.gamearena.data.MatchHistoryDto
import com.gamearena.data.RankingRowDto
import com.gamearena.data.TournamentDto
import com.gamearena.data.UserSession
import com.gamearena.ui.social.SocialAvatar
import kotlinx.coroutines.launch

/**
 * Ecrã de Torneios — 4 abas.
 *
 *   Tab 1: Torneios (reais do backend, filtrados por jogo se aplicável)
 *   Tab 2: Histórico (torneios que participei)
 *   Tab 3: Ranking (top jogadores)
 *   Tab 4: Comunicação (menus)
 */
class TournamentsActivity : BaseActivity() {

    enum class Tab { TOURNAMENTS, HISTORY, RANK, COMM }

    enum class TimeFilter { ALL, LIVE, HOUR, TODAY, WEEK, OLD }

    data class History(val title: String, val date: String, val placement: String, val prize: String)
    data class RankRow(val name: String, val level: Int, val coins: Int)
    data class CommItem(val iconRes: Int, val title: String, val description: String)

    private lateinit var session: UserSession
    private lateinit var tabContent: LinearLayout
    private lateinit var listHeader: TextView
    private lateinit var searchField: android.widget.EditText
    private lateinit var searchBar: View
    private lateinit var createCard: View
    private var currentTab: Tab = Tab.TOURNAMENTS
    private var filterQuery: String = ""
    private var currentTimeFilter: TimeFilter = TimeFilter.ALL
    private var ga15Seg = 1 // GA_FASE15V3_PREMIUM: 0 = 🏟 SALAS, 1 = 🏆 TORNEIOS
    private var ga15Sub = 0 // 0 = todos; 1..3 = sub-filtro do segmento
    private var ga15Counts = intArrayOf(0, 0)
    private var filterGameId: String? = null

    private var tournamentsCache: List<TournamentDto> = emptyList()

    // GA_FASE3_P4B: estado das animações das sub-abas
    private var tabsReady = false
    private var indicatorPlaced = false
    private var animateNextList = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_tournaments)

        // Pré-aquece o Render (feed está lá, cold start ~25s)
        lifecycleScope.launch { ApiClient.prewarmRender() }

        session = UserSession(this)

        if (!session.isLoggedIn()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        // GA16_REDIRECT: honor 'initial_tab' extra
        val _initTab = intent?.getStringExtra("initial_tab")
        if (!_initTab.isNullOrBlank()) {
            when (_initTab.lowercase()) {
                "history" -> currentTab = Tab.HISTORY
                "rank", "ranking" -> currentTab = Tab.RANK
                "comm", "comunicacao" -> currentTab = Tab.COMM
                "tournaments", "torneios" -> currentTab = Tab.TOURNAMENTS
            }
        }

        // Filtro por jogo (vindo do modal)
        filterGameId = intent.getStringExtra("filterGameId")

        tabContent = findViewById(R.id.tabContent)
        createCard = findViewById(R.id.createTourneyCard)
        searchBar = findViewById(R.id.searchFilterBar)
        listHeader = findViewById(R.id.listHeader)
        searchField = findViewById(R.id.searchField)

        // Tab clicks
        findViewById<View>(R.id.tTab1).setOnClickListener { selectTab(Tab.TOURNAMENTS) }
        findViewById<View>(R.id.tTab2).setOnClickListener { selectTab(Tab.HISTORY) }
        findViewById<View>(R.id.tTab3).setOnClickListener { selectTab(Tab.RANK) }
        findViewById<View>(R.id.tTab4).setOnClickListener { selectTab(Tab.COMM) }

        // GA_FASE15V4_CLEAN: chips de tempo (Todos / AO VIVO / 1h / Hoje / Semana / Antiga) removidos —
        // o seletor 🏟 SALAS / 🏆 TORNEIOS + sub-chips Todas/Aberto/Ao vivo/Encerradas já filtra.
        currentTimeFilter = TimeFilter.ALL
        findViewById<View>(R.id.chipAll)?.let { chip ->
            // reforço: esconde a raiz do <include partial_feed_chips> (irmã do listHeader)
            val host = listHeader.parent
            var row: View = chip
            while (row.parent is View && row.parent !== host) row = row.parent as View
            if (row.parent === host) row.visibility = View.GONE
        }

        // Botão Criar Torneio
        // GA_FASE14_4AB: picker de jogo para criar torneio
        createCard.setOnClickListener { v ->
            v.playSoundEffect(android.view.SoundEffectConstants.CLICK)
            ga14ShowGamePicker()
        }

        // Search
        searchField.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                filterQuery = s?.toString()?.trim()?.lowercase() ?: ""
                if (currentTab == Tab.TOURNAMENTS) renderTournamentsList()
            }
        })

        // Bottom nav
        findViewById<View>(R.id.tabHome)?.setOnClickListener {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.tabGames)?.setOnClickListener {
            startActivity(Intent(this, GamesActivity::class.java))
            finish()
        }
        findViewById<View>(R.id.tabProfile)?.setOnClickListener {
            startActivity(Intent(this, ProfileActivity::class.java))
            finish()
        }
        // GA_FASE9B_P2: 5ª aba Chat -> Social Hub
        findViewById<View>(R.id.tabChat)?.setOnClickListener {
            startActivity(Intent(this, com.gamearena.ui.social.SocialActivity::class.java))
            finish()
        }

        setupPremiumTabs() // GA_FASE3_P4B
        // GA16_REDIRECT: abre a aba pedida em 'initial_tab' (antes era sempre TORNEIOS e o Histórico nunca abria)
        selectTab(currentTab)
    }

    private fun selectTab(tab: Tab) {
        val dir = tab.ordinal.compareTo(currentTab.ordinal) // GA_FASE3_P4B
        currentTab = tab
        animateNextList = true
        paintTabs(animate = tabsReady)
        animateTabContent(dir)
        tabsReady = true
        when (tab) {
            Tab.TOURNAMENTS -> {
                createCard.visibility = View.VISIBLE
                searchBar.visibility = View.VISIBLE
                listHeader.text = getString(R.string.tn_rooms_tournaments)
                paintChips()
                renderTournamentsList()
            }
            Tab.HISTORY -> {
                createCard.visibility = View.GONE
                searchBar.visibility = View.GONE
                listHeader.text = getString(R.string.tn_history_header)
                renderHistory()
            }
            Tab.RANK -> {
                createCard.visibility = View.GONE
                searchBar.visibility = View.GONE
                listHeader.text = getString(R.string.tn_best_players)
                renderRank()
            }
            Tab.COMM -> {
                createCard.visibility = View.GONE
                searchBar.visibility = View.GONE
                listHeader.text = getString(R.string.tn_comm_header)
                renderComm()
            }
        }
    }

    // GA_FASE3_P4B: sub-abas premium — indicador neon deslizante, cores animadas, ícone com "pop"
    private fun setupPremiumTabs() {
        val indicator = findViewById<View>(R.id.tTabIndicator) ?: return
        findViewById<View>(R.id.tTabsRow)?.translationZ = dp(8).toFloat()
        indicator.elevation = dp(6).toFloat()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val glow = getColor(R.color.premium_cyan)
            indicator.outlineAmbientShadowColor = glow
            indicator.outlineSpotShadowColor = glow
        }
    }

    private fun paintTabs(animate: Boolean = true) {
        val defs = listOf(
            Triple(Tab.TOURNAMENTS, R.id.tTab1, R.drawable.ic_trophy),
            Triple(Tab.HISTORY, R.id.tTab2, R.drawable.ic_calendar),
            Triple(Tab.RANK, R.id.tTab3, R.drawable.ic_crown),
            Triple(Tab.COMM, R.id.tTab4, R.drawable.ic_chat)
        )
        var selectedRoot: View? = null
        for ((tabDef, id, iconRes) in defs) {
            val root = findViewById<LinearLayout>(id)
            val icon = root.getChildAt(0) as ImageView
            val title = root.getChildAt(1) as TextView
            val active = tabDef == currentTab
            if (active) selectedRoot = root
            root.isSelected = active
            icon.setImageResource(iconRes)
            tintTab(
                icon, title,
                getColor(if (active) R.color.bg_deep else R.color.premium_cyan),
                getColor(if (active) R.color.bg_deep else R.color.text_secondary),
                animate
            )
            val s = if (active) 1.15f else 1f
            if (animate) {
                icon.animate().scaleX(s).scaleY(s).setDuration(260)
                    .setInterpolator(OvershootInterpolator(2f)).start()
            } else {
                icon.scaleX = s
                icon.scaleY = s
            }
        }
        val target = selectedRoot ?: return
        val indicator = findViewById<View>(R.id.tTabIndicator) ?: return
        val place = {
            val lp = indicator.layoutParams
            // GA_FASE3_P4D: largura e altura exatas da aba (antes a altura era match_parent e esticava)
            if (lp.width != target.width || lp.height != target.height) {
                lp.width = target.width
                lp.height = target.height
                indicator.layoutParams = lp
            }
            indicator.translationY = target.top.toFloat()
            val x = target.left.toFloat()
            if (animate && indicatorPlaced) {
                indicator.animate().translationX(x).setDuration(300)
                    .setInterpolator(DecelerateInterpolator(1.8f)).start()
            } else {
                indicator.translationX = x
            }
            indicatorPlaced = true
        }
        if (target.width > 0) {
            place()
        } else {
            target.addOnLayoutChangeListener(object : View.OnLayoutChangeListener {
                override fun onLayoutChange(
                    v: View, p1: Int, p2: Int, p3: Int, p4: Int,
                    p5: Int, p6: Int, p7: Int, p8: Int
                ) {
                    v.removeOnLayoutChangeListener(this)
                    v.post { place() }
                }
            })
        }
    }

    private fun tintTab(icon: ImageView, title: TextView, iconTo: Int, textTo: Int, animate: Boolean) {
        val iconFrom = (icon.getTag(R.id.tTabIndicator) as? Int) ?: iconTo
        val textFrom = title.currentTextColor
        icon.setTag(R.id.tTabIndicator, iconTo)
        if (!animate || (iconFrom == iconTo && textFrom == textTo)) {
            icon.setColorFilter(iconTo)
            title.setTextColor(textTo)
            return
        }
        val ev = ArgbEvaluator()
        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 260
            addUpdateListener { a ->
                val f = a.animatedFraction
                icon.setColorFilter(ev.evaluate(f, iconFrom, iconTo) as Int)
                title.setTextColor(ev.evaluate(f, textFrom, textTo) as Int)
            }
            start()
        }
    }

    /** Desliza + fade do conteúdo na direção da aba escolhida. */
    private fun animateTabContent(dir: Int) {
        if (dir == 0) return
        val dx = dp(28).toFloat() * dir
        for (v in listOf<View>(tabContent, listHeader)) {
            v.animate().cancel()
            v.alpha = 0f
            v.translationX = dx
            v.animate().alpha(1f).translationX(0f).setDuration(260)
                .setInterpolator(DecelerateInterpolator()).start()
        }
    }

    /** Entrada em cascata dos cartões (só após trocar de aba/filtro, não ao escrever na pesquisa). */
    private fun staggerIn() {
        if (!animateNextList) return
        animateNextList = false
        for (i in 0 until tabContent.childCount) {
            val c = tabContent.getChildAt(i)
            c.alpha = 0f
            c.translationY = dp(14).toFloat()
            c.animate().alpha(1f).translationY(0f)
                .setStartDelay((i.coerceAtMost(10) * 40).toLong())
                .setDuration(260).setInterpolator(DecelerateInterpolator()).start()
        }
    }

    // ============================================================
    // TAB 1: TORNEIOS REAIS
    // ============================================================
    // GA_FASE14_4AB + FIXV3: picker de jogos para criar torneio
    private fun ga14ShowGamePicker() {
        lifecycleScope.launch {
            val games = runCatching { com.gamearena.data.ApiClient.fetchGames() }.getOrDefault(emptyList())
            if (games.isEmpty()) {
                android.widget.Toast.makeText(this@TournamentsActivity, "Sem jogos disponíveis", android.widget.Toast.LENGTH_SHORT).show()
                return@launch
            }
            val rv = androidx.recyclerview.widget.RecyclerView(this@TournamentsActivity)
            rv.layoutManager = androidx.recyclerview.widget.GridLayoutManager(this@TournamentsActivity, 3)
            val pad = (12 * resources.displayMetrics.density).toInt()
            rv.setPadding(pad, pad, pad, pad)
            rv.setBackgroundColor(getColor(com.gamearena.R.color.bg_deep))
            var dlg: androidx.appcompat.app.AlertDialog? = null
            rv.adapter = com.gamearena.ui.CatalogAdapter(this@TournamentsActivity, games) { game ->
                dlg?.dismiss()
                startActivity(Intent(this@TournamentsActivity, com.gamearena.ui.CreateTournamentActivity::class.java).apply {
                    putExtra("gameId", game.id)
                })
            }
            dlg = androidx.appcompat.app.AlertDialog.Builder(this@TournamentsActivity)
                .setTitle("Escolhe o jogo do torneio")
                .setView(rv)
                .setNegativeButton("Cancelar", null)
                .show()
        }
    }

    private fun renderTournamentsList() {
        tabContent.removeAllViews()
        tabContent.addView(loadingText())

        lifecycleScope.launch {
            val list = ApiClient.fetchFeed(game = filterGameId, kind = null)

            val byTime = ga15SegFilter(applyTimeFilter(list))

            val filtered = if (filterQuery.isEmpty()) byTime
            else byTime.filter {
                it.title.lowercase().contains(filterQuery) ||
                it.gameId.lowercase().contains(filterQuery) ||
                (it.code ?: "").lowercase().contains(filterQuery)
            }

            tabContent.removeAllViews()
            tabContent.addView(ga15SegmentBar())

            listHeader.text = when (currentTimeFilter) {
                TimeFilter.ALL -> getString(R.string.tn_rooms_tournaments)
                TimeFilter.LIVE -> getString(R.string.tn_live_now)
                TimeFilter.HOUR -> getString(R.string.tn_last_hour)
                TimeFilter.TODAY -> getString(R.string.tn_today)
                TimeFilter.WEEK -> getString(R.string.tn_last_7_days)
                TimeFilter.OLD -> getString(R.string.tn_older)
            }

            if (filtered.isEmpty()) {
                val msgTitle = if (filterGameId != null)
                    getString(R.string.tn_empty_game)
                else getString(R.string.tn_empty_filter)
                tabContent.addView(emptyState(
                    msgTitle,
                    getString(R.string.tn_empty_filter_sub)
                ))
                return@launch
            }

            filtered.forEach { t ->
                tabContent.addView(ga15Decorate(buildFeedCard(t), t))
            }
            staggerIn() // GA_FASE3_P4B
        }
    }

    private fun buildFeedCard(t: com.gamearena.data.FeedItemDto): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundResource(R.drawable.ga5_card_glass)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) }
            isClickable = true
            isFocusable = true
            setOnClickListener { v ->
                v.playSoundEffect(android.view.SoundEffectConstants.CLICK)
                if (t.isRoom) {
                    startActivity(Intent(this@TournamentsActivity, RoomLobbyActivity::class.java).apply {
                        putExtra(RoomLobbyActivity.EXTRA_ROOM_CODE, t.code ?: "")
                    })
                } else {
                    startActivity(Intent(this@TournamentsActivity, TournamentDetailActivity::class.java).apply {
                        putExtra("tournamentId", t.id)
                    })
                }
            }
        }

        val cover = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(80), dp(80))
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundResource(R.drawable.bg_cover_placeholder)
        }
        if (!t.gameCover.isNullOrBlank()) {
            cover.load(t.gameCover) {
                crossfade(true)
                placeholder(R.drawable.bg_cover_placeholder)
                error(R.drawable.bg_cover_placeholder)
            }
        }
        card.addView(cover)

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(12) }
        }

        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val effLc = effectiveLifecycle(t)
        val badgeColor = when {
            t.isRoom && effLc == "waiting" -> getColor(R.color.warn_yellow)
            t.isRoom && effLc == "live" -> getColor(R.color.live_red)
            t.isRoom && effLc == "expired" -> getColor(R.color.text_muted)
            else -> getColor(R.color.neon_green)
        }
        val badge = TextView(this).apply {
            text = if (t.isRoom) getString(R.string.tn_badge_room_fmt, t.code ?: "") else getString(R.string.tn_badge_tournament)
            setTextColor(badgeColor)
            textSize = 9f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            letterSpacing = 0.1f
            setBackgroundResource(R.drawable.bg_category_badge)
            setPadding(dp(8), dp(3), dp(8), dp(3))
        }
        val spacer1 = View(this).apply { layoutParams = LinearLayout.LayoutParams(0, 0, 1f) }

        row1.addView(badge)
        row1.addView(spacer1)

        val expired = effectiveLifecycle(t) == "expired" || isExpired(t)

        if (t.isFinished && !t.isRoom) {
            val finished = TextView(this).apply {
                text = getString(R.string.tn_finished_caps)
                setTextColor(getColor(R.color.text_muted))
                textSize = 8f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                letterSpacing = 0.1f
            }
            row1.addView(finished)
        } else if (expired) {
            val expiredTv = TextView(this).apply {
                text = getString(R.string.tn_expired_caps)
                setTextColor(getColor(R.color.text_muted))
                textSize = 8f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                letterSpacing = 0.1f
            }
            row1.addView(expiredTv)
        } else {
            val lockIcon = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp(16), dp(16))
                setImageResource(if (t.isFull) R.drawable.ic_lock else R.drawable.ic_unlock)
                setColorFilter(getColor(if (t.isFull) R.color.live_red else R.color.neon_green))
            }
            row1.addView(lockIcon)
        }
        col.addView(row1)

        col.addView(TextView(this).apply {
            text = t.title
            setTextColor(getColor(R.color.text_primary))
            textSize = 14f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, dp(6), 0, 0)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        })

        col.addView(TextView(this).apply {
            text = t.gameName ?: t.gameId
            setTextColor(getColor(R.color.text_secondary))
            textSize = 10f
            setPadding(0, dp(2), 0, 0)
        })

        val infoRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(6), 0, 0)
        }
        infoRow.addView(infoCell(getString(R.string.tn_state_caps), statusLabel(t)))
        infoRow.addView(infoCell(getString(R.string.tn_players_caps), "${t.currentPlayers}/${t.maxPlayers}"))
        if (t.isTournament && (t.prizeTotal ?: 0.0) > 0.0) {
            infoRow.addView(infoCell(getString(R.string.tn_prize_caps), "R$ %.0f".format(t.prizeTotal ?: 0.0)))
        }
        col.addView(infoRow)

        card.addView(col)
        return card
    }

    private fun effectiveLifecycle(item: com.gamearena.data.FeedItemDto): String? {
        if (!item.isRoom) return null
        // Backend já calculou → usar
        if (item.lifecycle != null) return item.lifecycle
        // Fallback cliente (idêntico à lógica do backend)
        if (item.isFinished || isExpired(item)) return "expired"
        if (item.currentPlayers >= 2 || item.startedAt != null) return "live"
        return "waiting"
    }

    private fun statusLabel(item: com.gamearena.data.FeedItemDto): String {
        val lc = effectiveLifecycle(item)
        if (lc != null) {
            return when (lc) {
                "waiting" -> getString(R.string.tn_st_waiting)
                "live" -> getString(R.string.tn_st_live)
                "expired" -> getString(R.string.tn_st_expired)
                else -> item.status
            }
        }
        return when (item.status) {
            "WAITING_PLAYERS" -> getString(R.string.tn_st_await)
            "OPEN" -> getString(R.string.tn_st_open)
            "READY" -> getString(R.string.tn_st_ready)
            "STARTED" -> getString(R.string.tn_st_playing)
            "FINISHED", "COMPLETED" -> getString(R.string.tour_finished)
            "CANCELLED" -> getString(R.string.tn_st_cancelled)
            "EXPIRED" -> getString(R.string.tn_st_expired)
            else -> item.status
        }
    }

    private fun infoCell(label: String, value: String): LinearLayout {
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        c.addView(TextView(this).apply {
            text = label
            setTextColor(getColor(R.color.text_muted))
            textSize = 9f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            letterSpacing = 0.1f
        })
        c.addView(TextView(this).apply {
            text = value
            setTextColor(getColor(R.color.text_primary))
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, dp(3), 0, 0)
        })
        return c
    }

    private fun typeLabel(t: String) = when (t) {
        "FAST" -> getString(R.string.tn_type_fast)
        "MEDIUM" -> getString(R.string.tn_type_medium)
        "LONG" -> getString(R.string.tn_type_long)
        else -> t
    }

    // ─── Chips de filtro ────────────────────────────────────────
    private fun bindChip(chipId: Int, filter: TimeFilter) {
        findViewById<View>(chipId).setOnClickListener { v ->
            v.playSoundEffect(android.view.SoundEffectConstants.CLICK)
            currentTimeFilter = filter
            animateNextList = true // GA_FASE3_P4B
            paintChips()
            if (currentTab == Tab.TOURNAMENTS) renderTournamentsList()
        }
    }

    private fun paintChips() {
        val map = listOf(
            TimeFilter.ALL to R.id.chipAll,
            TimeFilter.LIVE to R.id.chipLive,
            TimeFilter.HOUR to R.id.chip1h,
            TimeFilter.TODAY to R.id.chipToday,
            TimeFilter.WEEK to R.id.chipWeek,
            TimeFilter.OLD to R.id.chipOld
        )
        for ((f, id) in map) {
            val active = (f == currentTimeFilter)
            val tv = findViewById<TextView>(id) ?: continue
            tv.setBackgroundResource(
                if (active) R.drawable.bg_chip_active else R.drawable.bg_chip_idle
            )
            tv.setTextColor(
                if (active) getColor(R.color.bg_deep) else getColor(R.color.neon_green)
            )
        }
    }

    private fun isExpired(item: com.gamearena.data.FeedItemDto): Boolean {
        // Se backend já calculou lifecycle, confiar nele
        if (item.isRoom && item.lifecycle != null) return item.isExpiredLifecycle
        // Fallback cliente (backend ainda sem lifecycle):
        //  - não expirar salas com jogadores suficientes nem partidas iniciadas
        if (item.currentPlayers >= 2 || item.startedAt != null) return false
        if (item.isFinished) return true
        val exp = parseIsoTime(item.expiresAt)
        return exp in 1..System.currentTimeMillis()
    }

    // ---------------- GA_FASE15V3_PREMIUM: SALAS vs TORNEIOS ----------------
    private fun ga15Round(fill: Int, stroke: Int, radius: Int) = android.graphics.drawable.GradientDrawable().apply {
        cornerRadius = dp(radius).toFloat()
        setColor(fill)
        setStroke(dp(1), stroke)
    }

    private fun ga15SegFilter(items: List<com.gamearena.data.FeedItemDto>): List<com.gamearena.data.FeedItemDto> {
        ga15Counts = intArrayOf(items.count { it.isRoom }, items.count { !it.isRoom })
        val seg = items.filter { if (ga15Seg == 0) it.isRoom else !it.isRoom }
        if (ga15Sub == 0) return seg
        return seg.filter { t ->
            if (ga15Seg == 0) {
                val lc = effectiveLifecycle(t)
                when (ga15Sub) {
                    1 -> lc == "waiting"
                    2 -> lc == "live"
                    else -> lc == "expired"
                }
            } else {
                val st = "${t.status}".uppercase()
                val done = t.isFinished || st in setOf("FINISHED", "COMPLETED", "CANCELLED", "EXPIRED")
                val running = !done && (t.isLive || st in setOf("LIVE", "STARTED", "READY", "RUNNING"))
                when (ga15Sub) {
                    1 -> !done && !running
                    2 -> running
                    else -> done
                }
            }
        }
    }

    private fun ga15SegmentBar(): View {
        val blue = getColor(R.color.neon_blue)
        val green = getColor(R.color.neon_green)
        val ink = android.graphics.Color.parseColor("#0B0F1A")
        val idleFill = android.graphics.Color.argb(26, 255, 255, 255)
        val idleStroke = android.graphics.Color.argb(51, 255, 255, 255)
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) }
        }
        val seg = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(4), dp(4), dp(4), dp(4))
            background = ga15Round(idleFill, idleStroke, 24)
        }
        listOf("🏟  SALAS" to blue, "🏆  TORNEIOS" to green).forEachIndexed { i, pair ->
            val on = ga15Seg == i
            seg.addView(TextView(this).apply {
                text = pair.first + " · " + ga15Counts[i]
                gravity = Gravity.CENTER
                textSize = 13f
                letterSpacing = 0.05f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setTextColor(if (on) ink else pair.second)
                background = if (on) ga15Round(pair.second, pair.second, 20) else null
                setPadding(0, dp(10), 0, dp(10))
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                setOnClickListener {
                    if (ga15Seg != i) {
                        ga15Seg = i
                        ga15Sub = 0
                        renderTournamentsList()
                    }
                }
            })
        }
        wrap.addView(seg)

        val accent = if (ga15Seg == 0) blue else green
        val labels = if (ga15Seg == 0) listOf("Todas", "🟡 Aberto", "🔴 Ao vivo", "⚫ Encerradas")
        else listOf("Todos", "📝 Inscrições", "⚔ Em curso", "🏁 Finalizados")
        val subs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, 0)
        }
        labels.forEachIndexed { i, label ->
            val on = ga15Sub == i
            subs.addView(TextView(this).apply {
                text = label
                textSize = 12f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setTextColor(if (on) accent else android.graphics.Color.parseColor("#C9D1E0"))
                background = if (on) ga15Round((accent and 0x00FFFFFF) or 0x33000000, accent, 16) else ga15Round(idleFill, idleStroke, 16)
                setPadding(dp(14), dp(7), dp(14), dp(7))
                layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(8) }
                setOnClickListener {
                    if (ga15Sub != i) {
                        ga15Sub = i
                        renderTournamentsList()
                    }
                }
            })
        }
        wrap.addView(android.widget.HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(subs)
        })
        return wrap
    }

    private fun ga15Decorate(card: View, t: com.gamearena.data.FeedItemDto): View {
        val color = getColor(if (t.isRoom) R.color.neon_blue else R.color.neon_green)
        val original = if (t.isRoom) getString(R.string.tn_badge_room_fmt, t.code ?: "") else getString(R.string.tn_badge_tournament)
        val label = if (t.isRoom) "🏟 SALA · " + (t.code ?: "").uppercase()
        else "🏆 TORNEIO · #" + (t.id ?: "").take(6).uppercase()
        ga15FindText(card, original)?.let {
            it.text = label
            it.setTextColor(color)
        }
        if (card is LinearLayout) {
            card.addView(View(this).apply {
                background = ga15Round(color, color, 3)
                layoutParams = LinearLayout.LayoutParams(dp(4), -1).apply { marginEnd = dp(10) }
            }, 0)
        }
        return card
    }

    private fun ga15FindText(v: View, text: String): TextView? {
        if (v is TextView && v.text.toString() == text) return v
        if (v is android.view.ViewGroup) for (i in 0 until v.childCount) ga15FindText(v.getChildAt(i), text)?.let { return it }
        return null
    }

    private fun applyTimeFilter(items: List<com.gamearena.data.FeedItemDto>): List<com.gamearena.data.FeedItemDto> {
        if (currentTimeFilter == TimeFilter.ALL) return items
        val now = System.currentTimeMillis()
        return items.filter { it ->
            val created = parseIsoTime(it.createdAt)
            when (currentTimeFilter) {
                TimeFilter.LIVE -> it.isLive || (it.isTournament && !it.isFinished)
                TimeFilter.HOUR -> created > 0 && (now - created) <= 60L * 60_000L
                TimeFilter.TODAY -> created > 0 && (now - created) <= 24L * 60L * 60_000L
                TimeFilter.WEEK -> created > 0 && (now - created) <= 7L * 24L * 60L * 60_000L
                TimeFilter.OLD -> created > 0 && (now - created) > 7L * 24L * 60L * 60_000L
                else -> true
            }
        }
    }

    private fun parseIsoTime(iso: String?): Long {
        if (iso.isNullOrBlank()) return 0L
        return try {
            // Supabase devolve sempre UTC. Normalizamos e forçamos UTC,
            // senão é interpretado como local (Moçambique = UTC+2).
            val normalized = iso.replace(" ", "T")
            val body = if (normalized.length >= 19) normalized.substring(0, 19) else normalized
            val fmt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US)
            fmt.timeZone = java.util.TimeZone.getTimeZone("UTC")
            fmt.parse(body)?.time ?: 0L
        } catch (e: Exception) { 0L }
    }

    // ============================================================
    // TAB 2: HISTÓRICO
    // ============================================================
    private fun renderHistory() {
        tabContent.removeAllViews()
        tabContent.addView(loadingText())

        lifecycleScope.launch {
            val token = session.getToken()
            if (token.isNullOrBlank()) {
                tabContent.removeAllViews()
                tabContent.addView(emptyState(
                    getString(R.string.tn_session_expired),
                    getString(R.string.tn_login_for_history)
                ))
                return@launch
            }

            val list = ApiClient.fetchMyHistory(token)

            tabContent.removeAllViews()
            if (list.isEmpty()) {
                tabContent.addView(emptyState(
                    getString(R.string.tn_history_empty),
                    getString(R.string.tn_history_empty_sub)
                ))
                return@launch
            }

            list.forEach { item ->
                tabContent.addView(buildHistoryCard(item))
            }
            staggerIn() // GA_FASE3_P4B
        }
    }

    /**
     * GA16_HISTORY_CARD — card estilo "futebol":
     *
     *   FRUIT ARENA                              [ Sala ]
     *   (avatar eu) 🏆        2 – 1 | VS        (avatar adv) ❌
     *      Tu                  VITÓRIA            Adversário
     *                       04/11 21:30
     *
     * O placar só aparece quando o backend enviar myScore/opponentScore (Fase 18); senão mostra "VS".
     */
    private fun buildHistoryCard(item: MatchHistoryDto): View {
        val accent = when {
            item.isWin -> getColor(R.color.neon_green)
            item.isLoss -> getColor(R.color.live_red)
            item.isDraw -> getColor(R.color.text_muted)
            else -> getColor(R.color.text_secondary)
        }
        val label = when {
            item.isWin -> getString(R.string.tn_win)
            item.isLoss -> getString(R.string.tn_loss)
            item.isDraw -> getString(R.string.tn_draw)
            else -> getString(R.string.tn_played)
        }
        val single = item.mode == "singleplayer"
        val modeLabel = when (item.mode) {
            "tournament" -> getString(R.string.tn_mode_tournament)
            "multiplayer" -> getString(R.string.ga195_hist_room)
            "singleplayer" -> getString(R.string.tn_mode_training)
            else -> null
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.ga5_card_glass)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) }
        }

        // Linha 1: jogo + modo
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        head.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(4), dp(16)).apply { marginEnd = dp(8) }
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(2).toFloat(); setColor(accent)
            }
        })
        head.addView(TextView(this).apply {
            text = (item.gameName ?: item.gameId).uppercase()
            setTextColor(getColor(R.color.text_primary))
            textSize = 12f
            letterSpacing = 0.06f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        })
        if (modeLabel != null) {
            head.addView(TextView(this).apply {
                text = modeLabel
                textSize = 9f
                letterSpacing = 0.1f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setTextColor(getColor(R.color.text_secondary))
                background = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(10).toFloat()
                    setColor(android.graphics.Color.argb(26, 255, 255, 255))
                    setStroke(dp(1), android.graphics.Color.argb(60, 255, 255, 255))
                }
                setPadding(dp(9), dp(3), dp(9), dp(3))
            })
        }
        card.addView(head)

        // Linha 2: eu  ·  placar/VS + resultado  ·  adversário
        val myState = when { item.isWin -> 1; item.isLoss -> -1; else -> 0 }
        val match = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(12), 0, 0)
        }
        match.addView(historyPlayer(
            name = item.myName?.takeIf { it.isNotBlank() } ?: getString(R.string.ga195_hist_you),
            avatar = item.myAvatar,
            state = myState,
            isMe = true,
            cpu = false
        ))
        val center = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(dp(96), -2)
        }
        center.addView(TextView(this).apply {
            gravity = Gravity.CENTER
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            if (item.hasScore) {
                text = "${item.myScore}  –  ${item.opponentScore}"
                textSize = 22f
                setTextColor(getColor(R.color.text_primary))
            } else {
                text = getString(R.string.ga195_hist_vs)
                textSize = 14f
                letterSpacing = 0.2f
                setTextColor(getColor(R.color.text_muted))
            }
        })
        center.addView(TextView(this).apply {
            text = label
            gravity = Gravity.CENTER
            textSize = 11f
            letterSpacing = 0.12f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(accent)
            setPadding(0, dp(4), 0, 0)
        })
        match.addView(center)
        match.addView(historyPlayer(
            name = if (single) getString(R.string.ga195_hist_cpu) else (item.opponentName?.takeIf { it.isNotBlank() } ?: getString(R.string.ga195_hist_opponent)),
            avatar = if (single) null else item.opponentAvatar,
            state = -myState,
            isMe = false,
            cpu = single
        ))
        card.addView(match)

        // Linha 3: data
        formatHistoryDate(item.playedAt)?.let { hora ->
            card.addView(TextView(this).apply {
                text = hora
                gravity = Gravity.CENTER
                textSize = 10f
                setTextColor(getColor(R.color.text_muted))
                setPadding(0, dp(10), 0, 0)
            })
        }
        return card
    }

    /** GA16_HISTORY_CARD: avatar redondo + medalha (🏆 venceu / 😞 perdeu) + nome. state: 1 venceu, -1 perdeu, 0 empate/sem resultado. */
    private fun historyPlayer(name: String, avatar: String?, state: Int, isMe: Boolean, cpu: Boolean): LinearLayout {
        val ring = when (state) {
            1 -> getColor(R.color.gold_rank)
            -1 -> getColor(R.color.live_red)
            else -> android.graphics.Color.argb(90, 255, 255, 255)
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        val frame = FrameLayout(this).apply { layoutParams = LinearLayout.LayoutParams(dp(58), dp(58)) }
        val img = ImageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(dp(52), dp(52), Gravity.CENTER)
            scaleType = ImageView.ScaleType.CENTER_CROP
            setPadding(dp(3), dp(3), dp(3), dp(3))
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(android.graphics.Color.argb(40, 255, 255, 255))
                setStroke(dp(2), ring)
            }
            if (state == -1) alpha = 0.75f
        }
        if (cpu) {
            img.setPadding(dp(12), dp(12), dp(12), dp(12))
            img.setImageResource(R.drawable.ic_gamepad)
            img.setColorFilter(getColor(R.color.text_secondary))
        } else {
            SocialAvatar.load(img, avatar)
        }
        frame.addView(img)
        if (state != 0) {
            frame.addView(TextView(this).apply {
                text = if (state == 1) "🏆" else "😞"
                textSize = 14f
                layoutParams = FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.END)
            })
        }
        col.addView(frame)
        col.addView(TextView(this).apply {
            text = name
            gravity = Gravity.CENTER
            textSize = 12f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(getColor(if (isMe) R.color.neon_green else R.color.text_primary))
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(2), dp(6), dp(2), 0)
        })
        return col
    }

    /**
     * Formata timestamp ISO em "dd/MM HH:mm" (hora local).
     * Usa parseIsoTime() que já trata o fuso UTC corretamente.
     */
    private fun formatHistoryDate(iso: String?): String? {
        val ms = parseIsoTime(iso)
        if (ms <= 0) return null
        return try {
            val fmt = java.text.SimpleDateFormat(
                "dd/MM HH:mm",
                java.util.Locale.getDefault()
            )
            fmt.format(java.util.Date(ms))
        } catch (e: Exception) {
            null
        }
    }

    // ============================================================
    // TAB 3: RANKING (temporariamente vazio — Fase futura)
    // ============================================================
    private fun renderRank() {
        tabContent.removeAllViews()
        tabContent.addView(loadingText())

        lifecycleScope.launch {
            val list = ApiClient.fetchRanking(limit = 50)

            tabContent.removeAllViews()

            if (list.isEmpty()) {
                tabContent.addView(emptyState(
                    getString(R.string.tn_rank_empty),
                    getString(R.string.tn_rank_empty_sub)
                ))
                return@launch
            }

            // Cabeçalho
            val head = LinearLayout(this@TournamentsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(4), dp(14), dp(4), dp(6))
            }
            head.addView(rankHeader("#", 34))
            head.addView(rankHeader(getString(R.string.tn_player_caps), 0, 1f))
            head.addView(rankHeader(getString(R.string.tn_wins_caps), 70))
            head.addView(rankHeader(getString(R.string.tn_total_caps), 60))
            tabContent.addView(head)

            // O próprio user (para destacar)
            val myUserId = try {
                val payload = session.getToken()?.split(".")?.getOrNull(1)
                if (payload != null) {
                    val decoded = android.util.Base64.decode(
                        payload,
                        android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING
                    )
                    val json = String(decoded)
                    val regex = "\"userId\"\\s*:\\s*\"([^\"]+)\"".toRegex()
                    regex.find(json)?.groupValues?.getOrNull(1)
                } else null
            } catch (e: Exception) { null }

            list.forEach { row ->
                tabContent.addView(buildRankCard(row, isMe = row.userId == myUserId))
            }
            staggerIn() // GA_FASE3_P4B
        }
    }

    /**
     * Card de linha de ranking.
     * Cor por posição:
     *   1º → ouro + 🥇
     *   2º → prata + 🥈
     *   3º → bronze + 🥉
     *   4+ → número simples
     * Se for o próprio user, a borda esquerda é neon_green.
     */
    private fun buildRankCard(item: RankingRowDto, isMe: Boolean): View {
        val accent = when (item.position) {
            1 -> getColor(R.color.gold_rank)
            2 -> getColor(R.color.text_secondary)
            3 -> 0xFFCD7F32.toInt()  // bronze
            else -> getColor(R.color.text_muted)
        }

        val posText = when (item.position) {
            1 -> "🥇"
            2 -> "🥈"
            3 -> "🥉"
            else -> item.position.toString()
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(if (item.position <= 3) R.drawable.ga5_card_glass_gold else R.drawable.ga5_card_glass)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) }
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }

        // Barra lateral esquerda: destaca o próprio user
        if (isMe) {
            card.addView(View(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp(3), dp(40))
                setBackgroundColor(getColor(R.color.neon_green))
            })
        }

        // Posição
        card.addView(TextView(this).apply {
            text = posText
            textSize = if (item.position <= 3) 22f else 14f
            setTextColor(accent)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(dp(34), -2)
        })

        // Nome + nível
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(10) }
        }
        col.addView(TextView(this).apply {
            text = item.username + if (isMe) "  (" + getString(R.string.tn_you) + ")" else ""
            setTextColor(
                if (isMe) getColor(R.color.neon_green) else getColor(R.color.text_primary)
            )
            textSize = 14f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        })
        col.addView(TextView(this).apply {
            text = getString(R.string.prof_level_fmt, item.level.toString())
            setTextColor(getColor(R.color.text_secondary))
            textSize = 10f
            setPadding(0, dp(2), 0, 0)
        })
        card.addView(col)

        // Vitórias
        card.addView(TextView(this).apply {
            text = item.wins.toString()
            setTextColor(getColor(R.color.neon_green))
            textSize = 15f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(dp(70), -2)
        })

        // Total
        card.addView(TextView(this).apply {
            text = item.totalMatches.toString()
            setTextColor(getColor(R.color.text_muted))
            textSize = 13f
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(dp(60), -2)
        })

        return card
    }

    private fun rankHeader(text: String, width: Int, weight: Float = 0f): TextView {
        val tv = TextView(this)
        tv.text = text
        tv.setTextColor(getColor(R.color.text_muted))
        tv.textSize = 9f
        tv.setTypeface(tv.typeface, android.graphics.Typeface.BOLD)
        tv.letterSpacing = 0.1f
        tv.layoutParams = if (weight > 0) {
            LinearLayout.LayoutParams(0, -2, weight)
        } else if (width > 0) {
            LinearLayout.LayoutParams(dp(width), -2)
        } else {
            LinearLayout.LayoutParams(-2, -2)
        }
        return tv
    }

    // ============================================================
    // TAB 4: COMUNICAÇÃO
    // ============================================================
    private fun renderComm() {
        tabContent.removeAllViews()

        val items = listOf(
            CommItem(R.drawable.ic_megaphone, getString(R.string.tn_comm_ann), getString(R.string.tn_comm_ann_sub)),
            CommItem(R.drawable.ic_chat, getString(R.string.tn_comm_chat), getString(R.string.tn_comm_chat_sub)),
            CommItem(R.drawable.ic_shield, getString(R.string.prof_support), getString(R.string.tn_comm_support_sub)),
            CommItem(R.drawable.ic_calendar, getString(R.string.tn_comm_events), getString(R.string.tn_comm_events_sub)),
            CommItem(R.drawable.ic_swords, getString(R.string.tn_comm_rules), getString(R.string.tn_comm_rules_sub)),
            CommItem(R.drawable.ic_heart_outline, getString(R.string.tn_comm_suggest), getString(R.string.tn_comm_suggest_sub))
        )

        items.forEach { item ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setBackgroundResource(R.drawable.ga5_card_glass)
                setPadding(dp(14), dp(14), dp(14), dp(14))
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) }
                isClickable = true
                isFocusable = true
                setOnClickListener { v ->
                    v.playSoundEffect(android.view.SoundEffectConstants.CLICK)
                    Toast.makeText(this@TournamentsActivity, getString(R.string.tn_coming_soon_fmt, item.title), Toast.LENGTH_SHORT).show()
                }
            }

            row.addView(ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp(20), dp(20))
                setImageResource(item.iconRes)
                setColorFilter(getColor(R.color.neon_green))
            })

            val col = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(12) }
            }
            col.addView(TextView(this).apply {
                text = item.title
                setTextColor(getColor(R.color.text_primary))
                textSize = 13f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
            col.addView(TextView(this).apply {
                text = item.description
                setTextColor(getColor(R.color.text_muted))
                textSize = 11f
            })
            row.addView(col)

            tabContent.addView(row)
        }
        staggerIn() // GA_FASE3_P4B
    }

    // ============================================================
    // HELPERS
    // ============================================================
    private fun loadingText(): TextView = TextView(this).apply {
        text = getString(R.string.tn_loading)
        setTextColor(getColor(R.color.text_muted))
        textSize = 13f
        gravity = Gravity.CENTER
        setPadding(0, dp(60), 0, dp(60))
    }

    private fun emptyState(title: String, sub: String): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(0, dp(60), 0, dp(60))
        }
        box.addView(TextView(this).apply {
            text = title
            setTextColor(getColor(R.color.text_primary))
            textSize = 15f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
        })
        box.addView(TextView(this).apply {
            text = sub
            setTextColor(getColor(R.color.text_muted))
            textSize = 12f
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        })
        return box
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
