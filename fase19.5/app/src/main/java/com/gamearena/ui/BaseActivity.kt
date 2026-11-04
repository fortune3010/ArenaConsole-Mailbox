package com.gamearena.ui
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import android.os.Bundle
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import com.gamearena.R

open class BaseActivity : AppCompatActivity() {
    private var downX = 0f
    private var downY = 0f
    private var touchSlop = 0
    private val tmpLoc = IntArray(2)

    /** GA195_THEMES: um ecrã pode desligar a pele do tema (ex.: ecrãs com design próprio). */
    protected open val gaThemeSkinEnabled: Boolean = true

    override fun attachBaseContext(newBase: Context) {
        applySavedNightMode(newBase)
        super.attachBaseContext(newBase)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        touchSlop = ViewConfiguration.get(this).scaledTouchSlop
        ClickSound.init(applicationContext)
        ga3ApplySystemBarIcons() // GA_FASE3_P1
    }
    // GA195_THEMES: corre depois de cada setContentView → aplica a pele do tema escolhido
    override fun onContentChanged() {
        super.onContentChanged()
        if (gaThemeSkinEnabled) {
            try { GaThemes.attach(this) } catch (e: Exception) { android.util.Log.w("GaThemes", "pele: " + e.message) }
        }
    }
    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        if (ev != null) {
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = ev.rawX; downY = ev.rawY }
                MotionEvent.ACTION_UP -> {
                    val dx = ev.rawX - downX
                    val dy = ev.rawY - downY
                    if (dx * dx + dy * dy <= (touchSlop * touchSlop).toFloat()) {
                        try {
                            val target = findClickableAt(window.decorView, ev.rawX.toInt(), ev.rawY.toInt())
                            if (target != null) {
                                target.isSoundEffectsEnabled = false
                                ClickSound.play(this)
                            }
                        } catch (e: Exception) {}
                    }
                }
            }
        }
        return super.dispatchTouchEvent(ev)
    }
    private fun findClickableAt(v: View, x: Int, y: Int): View? {
        if (v.visibility != View.VISIBLE || v.alpha <= 0f) return null
        v.getLocationOnScreen(tmpLoc)
        if (x < tmpLoc[0] || y < tmpLoc[1] || x >= tmpLoc[0] + v.width || y >= tmpLoc[1] + v.height) return null
        if (v is ViewGroup) {
            for (i in v.childCount - 1 downTo 0) {
                val hit = findClickableAt(v.getChildAt(i), x, y)
                if (hit != null) return hit
            }
        }
        return if (v.isEnabled && v.isClickable) v else null
    }
    // GA_FASE3_P1: no modo claro a status/nav bar e clara -> icones escuros (senao ficam invisiveis).
    protected open fun ga3ApplySystemBarIcons() {
        try {
            val night = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
            val ctl = androidx.core.view.WindowInsetsControllerCompat(window, window.decorView)
            ctl.isAppearanceLightStatusBars = !night
            ctl.isAppearanceLightNavigationBars = !night
        } catch (e: Exception) {}
    }

    companion object {
        private const val PREFS = "gamearena_prefs"
        private const val KEY_NIGHT = "ga_night_mode"
        fun saveNightMode(ctx: Context, mode: Int) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_NIGHT, mode).apply()
        }
        // GA_FASE3_P1: padrao de fabrica = MODO CLARO. A escolha do Perfil continua guardada em KEY_NIGHT.
        fun savedNightMode(ctx: Context): Int =
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_NIGHT, AppCompatDelegate.MODE_NIGHT_NO)
        // GA195_THEMES: o modo noturno segue o tema (só "Claro" o desliga); sem tema escolhido, mantém KEY_NIGHT.
        fun applySavedNightMode(ctx: Context) {
            try {
                val mode = GaThemes.nightModeFor(GaThemes.current(ctx))
                if (AppCompatDelegate.getDefaultNightMode() != mode) { AppCompatDelegate.setDefaultNightMode(mode) }
            } catch (e: Exception) {}
        }
    }
}
internal object ClickSound {
    private var pool: SoundPool? = null
    private var soundId = 0
    @Volatile private var loaded = false
    fun init(ctx: Context) {
        if (pool != null) return
        try {
            val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            val p = SoundPool.Builder().setMaxStreams(4).setAudioAttributes(attrs).build()
            p.setOnLoadCompleteListener { _, id, status -> if (status == 0 && id == soundId) loaded = true }
            soundId = p.load(ctx, R.raw.ga_click, 1)
            pool = p
        } catch (e: Exception) { pool = null; loaded = false }
    }
    fun play(ctx: Context) {
        val p = pool
        if (p != null && loaded) {
            try { if (p.play(soundId, 0.7f, 0.7f, 1, 0, 1f) != 0) return } catch (e: Exception) {}
        }
        try { (ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager).playSoundEffect(AudioManager.FX_KEY_CLICK, 0.6f) } catch (e: Exception) {}
    }
}
