package com.gamearena.ui

// GA195_THEMES — 10 temas persistentes com "pele em tempo de execução" (Opção B).
//
// - "claro" (values/, rosa) e "escuro" (values-night/, azul-marinho + verde neon) são os temas que JÁ existem:
//   não há substituição de cores, só o modo noturno. Ficam exactamente como hoje.
// - Os outros 9 temas (Chocolate + 8) ligam o modo noturno e trocam as ~15 cores-chave:
//     1) janela, barra de estado e barra de navegação;
//     2) depois de cada setContentView e a cada novo layout, percorre o ecrã e troca as cores-chave em
//        textos, fundos sólidos, fundos GradientDrawable (fill) e tints de ícones (app:tint).
//   Limitações conhecidas (Fase 19.6): cores de contorno (stroke) dos drawables XML e ícones pintados com
//   setColorFilter() no Kotlin ficam com a cor de destaque original.
// - Persistência: SharedPreferences "gamearena_prefs", chave "ga_theme".

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatDelegate
import com.gamearena.R

object GaThemes {

    private const val PREFS = "gamearena_prefs"
    private const val KEY = "ga_theme"
    private const val KEY_NIGHT_LEGACY = "ga_night_mode" // o mesmo do BaseActivity

    data class Palette(
        val id: String,
        val nameRes: Int,
        val night: Boolean,
        val swatch: Int,
        val bg: Int? = null,
        val card: Int? = null,
        val accent: Int? = null,
        val accentDark: Int? = null
    ) {
        val skinned: Boolean get() = bg != null
    }

    private fun c(hex: String) = Color.parseColor(hex)

    val ALL: List<Palette> by lazy {
        listOf(
            Palette("claro", R.string.ga195_theme_claro, false, c("#C2185B")),
            Palette("escuro", R.string.ga195_theme_escuro, true, c("#00F5A0")),
            Palette("chocolate", R.string.ga195_theme_chocolate, true, c("#F2B544"), c("#2B1407"), c("#4A250E"), c("#F2B544"), c("#B9802A")),
            Palette("verde", R.string.ga195_theme_verde, true, c("#39FF6A"), c("#06140A"), c("#0E2414"), c("#39FF6A"), c("#1FAA45")),
            Palette("azul", R.string.ga195_theme_azul, true, c("#2E8BFF"), c("#050C1C"), c("#0C1A33"), c("#2E8BFF"), c("#1A5FCC")),
            Palette("roxo", R.string.ga195_theme_roxo, true, c("#A855F7"), c("#0F0820"), c("#1C1036"), c("#A855F7"), c("#7B2FD0")),
            Palette("vermelho", R.string.ga195_theme_vermelho, true, c("#FF3B3B"), c("#160505"), c("#2A0B0B"), c("#FF3B3B"), c("#C21F1F")),
            Palette("rosa", R.string.ga195_theme_rosa, true, c("#FF4FB3"), c("#1A0614"), c("#2E0D24"), c("#FF4FB3"), c("#D12E8C")),
            Palette("ouro", R.string.ga195_theme_ouro, true, c("#FFC23A"), c("#171006"), c("#2A1E0C"), c("#FFC23A"), c("#D49A1A")),
            Palette("ciano", R.string.ga195_theme_ciano, true, c("#22D3EE"), c("#04161A"), c("#0A262C"), c("#22D3EE"), c("#0E9FB5")),
            Palette("galaxia", R.string.ga195_theme_galaxia, true, c("#7C5CFF"), c("#0B0820"), c("#16103A"), c("#7C5CFF"), c("#4B32D9"))
        )
    }

    private val TEXT_1 = Color.parseColor("#FFFFFF")
    private val TEXT_2 = Color.parseColor("#C9D1E0")
    private val TEXT_3 = Color.parseColor("#8A93A6")

    // ------------------------------------------------------------------ persistência

    /** Tema guardado. Sem escolha ainda: deriva do modo noturno antigo (escuro → escuro, claro → claro). */
    fun current(ctx: Context): Palette {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = p.getString(KEY, null)
        ALL.firstOrNull { it.id == id }?.let { return it }
        val night = p.getInt(KEY_NIGHT_LEGACY, AppCompatDelegate.MODE_NIGHT_NO) == AppCompatDelegate.MODE_NIGHT_YES
        return if (night) ALL[1] else ALL[0]
    }

    fun nightModeFor(p: Palette): Int = if (p.night) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO

    /** Guarda o tema, acerta o modo noturno e reconstrói o ecrã. */
    fun select(activity: Activity, p: Palette) {
        val before = current(activity)
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, p.id).apply()
        val mode = nightModeFor(p)
        BaseActivity.saveNightMode(activity, mode)
        Toast.makeText(activity, activity.getString(R.string.ga195_theme_applied), Toast.LENGTH_SHORT).show()
        if (AppCompatDelegate.getDefaultNightMode() != mode) {
            AppCompatDelegate.setDefaultNightMode(mode) // o AppCompat reconstrói as Activities
        } else if (before.id != p.id) {
            activity.recreate()
        }
    }

    // ------------------------------------------------------------------ seletor (ecrã de Perfil)

    fun picker(activity: Activity, onPick: (Palette) -> Unit): View {
        val d = activity.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val cur = current(activity)
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) }
        }
        ALL.chunked(4).forEach { rowItems ->
            val row = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) }
            }
            rowItems.forEach { p ->
                val on = p.id == cur.id
                val cell = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER_HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                    isClickable = true
                    isFocusable = true
                    contentDescription = activity.getString(p.nameRes)
                    setOnClickListener { v ->
                        v.playSoundEffect(android.view.SoundEffectConstants.CLICK)
                        if (p.id != current(activity).id) onPick(p)
                    }
                }
                cell.addView(View(activity).apply {
                    layoutParams = LinearLayout.LayoutParams(dp(34), dp(34))
                    background = GradientDrawable(
                        GradientDrawable.Orientation.TL_BR,
                        intArrayOf(p.swatch, p.bg ?: (if (p.night) Color.parseColor("#010E1F") else Color.parseColor("#F4F6F9")))
                    ).apply {
                        shape = GradientDrawable.OVAL
                        setStroke(dp(if (on) 3 else 1), if (on) Color.WHITE else Color.argb(90, 128, 128, 128))
                    }
                    if (on) elevation = dp(4).toFloat()
                })
                cell.addView(TextView(activity).apply {
                    text = activity.getString(p.nameRes)
                    textSize = 9f
                    gravity = Gravity.CENTER
                    maxLines = 2
                    setTextColor(activity.getColor(if (on) R.color.neon_green else R.color.text_secondary))
                    if (on) setTypeface(typeface, android.graphics.Typeface.BOLD)
                    setPadding(dp(2), dp(4), dp(2), 0)
                })
                row.addView(cell)
            }
            box.addView(row)
        }
        return box
    }

    // ------------------------------------------------------------------ pele em tempo de execução

    /** Liga a pele a uma Activity (chamado pelo BaseActivity.onContentChanged). Idempotente. */
    fun attach(activity: Activity) {
        val p = current(activity)
        if (!p.skinned) return
        val decor = activity.window?.decorView ?: return
        if (decor.getTag(R.id.ga195_theme_tag) != null) { Skinner.schedule(decor); return }
        val skinner = Skinner(buildMap(activity, p))
        decor.setTag(R.id.ga195_theme_tag, skinner)
        try {
            val w = activity.window
            w.setBackgroundDrawable(ColorDrawable(p.bg!!))
            w.statusBarColor = p.bg
            w.navigationBarColor = p.bg
        } catch (_: Exception) { }
        decor.viewTreeObserver.addOnGlobalLayoutListener(object : ViewTreeObserver.OnGlobalLayoutListener {
            override fun onGlobalLayout() {
                if (!decor.isAttachedToWindow) { decor.viewTreeObserver.removeOnGlobalLayoutListener(this); return }
                Skinner.schedule(decor)
            }
        })
        skinner.walk(decor)
    }

    /** cor original (do tema base) → cor do tema escolhido. */
    private fun buildMap(ctx: Context, p: Palette): Map<Int, Int> {
        val m = LinkedHashMap<Int, Int>()
        fun put(res: Int, to: Int) {
            val from = try { ctx.getColor(res) } catch (_: Exception) { return }
            if (!m.containsKey(from) && from != to) m[from] = to
        }
        val bg = p.bg!!
        val card = p.card!!
        val accent = p.accent!!
        val accentDark = p.accentDark!!
        val hover = blend(card, Color.WHITE, 0.08f)
        // destaque primeiro (prioridade quando duas cores base coincidem)
        put(R.color.neon_green, accent)
        put(R.color.neon_green_dark, accentDark)
        put(R.color.border_neon, accent)
        put(R.color.xp_fill, accent)
        put(R.color.ga9d_btn_add_fill, accent)
        put(R.color.ga9d_btn_accept_fill, accentDark)
        put(R.color.ga9d_search_icon, accent)
        // fundos
        put(R.color.bg_deep, bg)
        put(R.color.bg_secondary, bg)
        put(R.color.bg_nav, bg)
        put(R.color.bg_card, card)
        put(R.color.bg_card_deep, card)
        put(R.color.tourney_card_bg, card)
        put(R.color.bg_card_hover, hover)
        put(R.color.chip_bg, hover)
        // texto
        put(R.color.text_primary, TEXT_1)
        put(R.color.text_secondary, TEXT_2)
        put(R.color.text_muted, TEXT_3)
        return m
    }

    private fun blend(a: Int, b: Int, t: Float): Int = Color.argb(
        Color.alpha(a),
        (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt()
    )

    private class Skinner(private val map: Map<Int, Int>) {
        @Volatile var pending = false

        fun walk(v: View) {
            if (v.visibility == View.GONE && v !is ViewGroup) return
            val bg = v.background
            if (bg is ColorDrawable) {
                map[bg.color]?.let { v.setBackgroundColor(it) }
            } else if (bg is GradientDrawable && Build.VERSION.SDK_INT >= 24) {
                val fill = bg.color?.defaultColor
                if (fill != null) map[fill]?.let { (bg.mutate() as GradientDrawable).setColor(it) }
            }
            if (v is TextView) {
                map[v.currentTextColor]?.let { v.setTextColor(it) }
                if (v is EditText) map[v.currentHintTextColor]?.let { v.setHintTextColor(it) }
            }
            if (v is ImageView) {
                val tint = v.imageTintList?.defaultColor
                if (tint != null) map[tint]?.let { v.imageTintList = android.content.res.ColorStateList.valueOf(it) }
            }
            if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
        }

        companion object {
            /** No máximo uma passagem por frame (as cores alteradas não voltam a corresponder → termina). */
            fun schedule(decor: View) {
                val s = decor.getTag(R.id.ga195_theme_tag) as? Skinner ?: return
                if (s.pending) return
                s.pending = true
                decor.post {
                    s.pending = false
                    try { s.walk(decor) } catch (_: Exception) { }
                }
            }
        }
    }
}
