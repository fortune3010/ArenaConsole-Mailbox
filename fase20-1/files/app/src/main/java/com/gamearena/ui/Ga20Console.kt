package com.gamearena.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.gamearena.R
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * GA20_CONSOLE (Fase 20.1) — Arena Console no Launcher.
 *
 *  - Ga20Console: contrato do Intent para o emulador externo (ver CONTRATO-ARENA-CONSOLE.md).
 *  - Ga20Roms: biblioteca de jogos do utilizador em getExternalFilesDir(DOCUMENTS)/roms/.
 *  - Ga20ConsolePanel: painel da sub-aba "Console" do GamesActivity (carregar ISO + biblioteca).
 *  - Ga20ConsoleFileProvider: partilha a ISO com o emulador por content:// (Android 11+ não deixa
 *    outra app ler /Android/data/... só com o caminho).
 */
object Ga20Console {
    const val ACTION_START_GAME = "com.gamearena.console.START_GAME"
    const val SERVER_URL = "https://gamer-fortune.onrender.com"
    const val SIGNAL_NAMESPACE = "/console"
    const val PROTOCOL_VERSION = 1

    const val EXTRA_BUNDLE = "arena_bundle"
    const val EXTRA_ISO_PATH = "iso_path"
    const val EXTRA_ISO_URI = "iso_uri"
    const val EXTRA_ISO_NAME = "iso_name"
    const val EXTRA_ISO_FINGERPRINT = "iso_fingerprint"
    const val EXTRA_GAME_ID = "game_id"
    const val EXTRA_ROLE = "role"
    const val EXTRA_PEER_ID = "peer_id"
    const val EXTRA_REMOTE_PEER_ID = "remote_peer_id"
    const val EXTRA_ROOM_CODE = "room_code"
    const val EXTRA_START_TOKEN = "start_token"
    const val EXTRA_SERVER_URL = "server_url"
    const val EXTRA_SIGNAL_NAMESPACE = "signal_namespace"
    const val EXTRA_PROTOCOL = "protocol_version"

    fun authority(ctx: Context): String = ctx.packageName + ".console.fileprovider"

    fun romUri(ctx: Context, file: File): Uri? = try {
        FileProvider.getUriForFile(ctx, authority(ctx), file)
    } catch (e: Exception) {
        android.util.Log.e("GA20", "FileProvider: ${e.message}")
        null
    }
}

/** Provider próprio (não pode reutilizar o androidx FileProvider do OTA: a mesma classe não pode ser registada 2x). */
class Ga20ConsoleFileProvider : FileProvider()

object Ga20Roms {
    val EXTS = setOf("iso", "cso", "pbp")
    private const val FP_BYTES = 4L * 1024 * 1024
    private const val HEAD_BYTES = 0x8800
    private const val SPARE_BYTES = 64L * 1024 * 1024

    data class Rom(val file: File, val name: String, val size: Long, val fp: String, val gid: String)

    fun dir(ctx: Context): File? {
        val base = ctx.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS) ?: return null
        val d = File(base, "roms")
        if (!d.exists()) d.mkdirs()
        return if (d.isDirectory) d else null
    }

    private fun metaFile(f: File): File = File(f.parentFile, f.name + ".ga.json")

    fun meta(f: File): Rom {
        val base = f.name.substringBeforeLast('.')
        try {
            val m = metaFile(f)
            if (m.isFile) {
                val j = JSONObject(m.readText())
                if (j.optLong("size", -1L) == f.length()) {
                    return Rom(f, j.optString("name", base), f.length(), j.optString("fp", ""), j.optString("gid", ""))
                }
            }
        } catch (e: Exception) { }
        return Rom(f, base, f.length(), "", "")
    }

    fun saveMeta(r: Rom) {
        try {
            metaFile(r.file).writeText(
                JSONObject().put("name", r.name).put("size", r.size).put("fp", r.fp).put("gid", r.gid)
                    .put("added", System.currentTimeMillis()).toString()
            )
        } catch (e: Exception) { }
    }

    fun list(ctx: Context): List<Rom> {
        val d = dir(ctx) ?: return emptyList()
        val files = d.listFiles() ?: return emptyList()
        return files.filter { it.isFile && it.extension.lowercase() in EXTS }
            .sortedByDescending { it.lastModified() }
            .map { meta(it) }
    }

    fun delete(r: Rom) {
        try { r.file.delete() } catch (e: Exception) { }
        try { metaFile(r.file).delete() } catch (e: Exception) { }
    }

    /** Impressão digital: SHA-256 dos primeiros 4 MB + tamanho. Os 2 jogadores têm de ter a MESMA ISO. */
    fun fingerprint(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { inp ->
            val buf = ByteArray(1 shl 16)
            var left = FP_BYTES
            while (left > 0) {
                val n = inp.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                if (n < 0) break
                md.update(buf, 0, n)
                left -= n
            }
        }
        md.update(f.length().toString().toByteArray())
        return md.digest().joinToString("") { "%02x".format(it) }.take(32)
    }

    private fun ascii(b: ByteArray, off: Int, len: Int): String {
        if (off + len > b.size) return ""
        return String(b, off, len, Charsets.US_ASCII)
    }

    /** ISO: "CD001" em 0x8001 · CSO/ZSO: "CISO"/"ZISO" · PBP: "\0PBP". Devolve o ID do disco (ex.: ULES00151) ou "" se válido sem ID; null se inválido. */
    private fun validate(ext: String, head: ByteArray, len: Int): String? {
        if (len < 4) return null
        return when (ext) {
            // descritor de volume primário em 0x8000: "CD001" em +1, identificador do volume em +40 (0x8028)
            "iso" -> if (len >= 0x8048 && ascii(head, 0x8001, 5) == "CD001") ascii(head, 0x8028, 32).trim() else null
            "cso" -> { val m = ascii(head, 0, 4); if (m == "CISO" || m == "ZISO") "" else null }
            "pbp" -> if (head[0].toInt() == 0 && ascii(head, 1, 3) == "PBP") "" else null
            else -> null
        }
    }

    private fun queryName(ctx: Context, uri: Uri): Pair<String?, Long> {
        var name: String? = null
        var size = -1L
        try {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val si = c.getColumnIndex(OpenableColumns.SIZE)
                    if (ni >= 0 && !c.isNull(ni)) name = c.getString(ni)
                    if (si >= 0 && !c.isNull(si)) size = c.getLong(si)
                }
            }
        } catch (e: Exception) { }
        return Pair(name, size)
    }

    private fun safeName(raw: String): String {
        val n = raw.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").trim().trimStart('.')
        return if (n.isBlank()) "jogo.iso" else n.take(120)
    }

    /** Copia o ficheiro escolhido para roms/. Devolve null se correu bem, ou a mensagem de erro. */
    suspend fun importRom(ctx: Context, uri: Uri, progress: (Long, Long) -> Unit): String? = withContext(Dispatchers.IO) {
        val main = Handler(Looper.getMainLooper())
        val (rawName, total) = queryName(ctx, uri)
        val name = safeName(rawName ?: "jogo.iso")
        val ext = name.substringAfterLast('.', "").lowercase()
        if (ext !in EXTS) return@withContext "Formato não suportado. Usa um ficheiro .iso, .cso ou .pbp."
        val d = dir(ctx) ?: return@withContext "Armazenamento indisponível."
        if (total > 0) {
            val free = try { StatFs(d.path).availableBytes } catch (e: Exception) { Long.MAX_VALUE }
            if (free < total + SPARE_BYTES) return@withContext "Sem espaço livre suficiente (precisas de " + (total / 1_048_576) + " MB)."
        }
        var out = File(d, name)
        var k = 2
        while (out.exists()) { out = File(d, name.substringBeforeLast('.') + " (" + k + ")." + ext); k++ }
        val part = File(d, out.name + ".part")
        val md = MessageDigest.getInstance("SHA-256")
        val head = ByteArray(HEAD_BYTES)
        var headLen = 0
        var done = 0L
        try {
            val inp = ctx.contentResolver.openInputStream(uri) ?: return@withContext "Não foi possível abrir o ficheiro."
            inp.use { input ->
                part.outputStream().buffered(1 shl 20).use { os ->
                    val buf = ByteArray(1 shl 20)
                    var lastTick = 0L
                    while (true) {
                        ensureActive()
                        val n = input.read(buf)
                        if (n < 0) break
                        if (n == 0) continue
                        os.write(buf, 0, n)
                        if (done < FP_BYTES) md.update(buf, 0, minOf(n.toLong(), FP_BYTES - done).toInt())
                        if (headLen < head.size) {
                            val c = minOf(n, head.size - headLen)
                            System.arraycopy(buf, 0, head, headLen, c)
                            headLen += c
                        }
                        done += n
                        if (done - lastTick >= 8L * 1024 * 1024) {
                            lastTick = done
                            val dn = done
                            main.post { progress(dn, total) }
                        }
                    }
                }
            }
            val gid = validate(ext, head, headLen)
            if (gid == null) {
                part.delete()
                return@withContext "Este ficheiro não parece um jogo PSP válido."
            }
            md.update(done.toString().toByteArray())
            val fp = md.digest().joinToString("") { "%02x".format(it) }.take(32)
            if (!part.renameTo(out)) {
                part.delete()
                return@withContext "Não foi possível guardar o jogo."
            }
            saveMeta(Rom(out, out.name.substringBeforeLast('.'), done, fp, gid))
            main.post { progress(done, done) }
            null
        } catch (e: CancellationException) {
            part.delete()
            throw e
        } catch (e: Exception) {
            part.delete()
            android.util.Log.e("GA20", "import: ${e.message}", e)
            "Erro ao copiar o jogo: " + (e.message ?: "desconhecido")
        }
    }

    fun human(b: Long): String = when {
        b >= 1_073_741_824L -> String.format("%.2f GB", b / 1_073_741_824.0)
        b >= 1_048_576L -> String.format("%.0f MB", b / 1_048_576.0)
        else -> String.format("%.0f KB", b / 1024.0)
    }
}

/**
 * Painel da sub-aba "Console" (substitui o cadeado). O GamesActivity só chama render() e onPicked().
 * isShown: o painel só se redesenha se a sub-aba Console continuar aberta (não estraga a lista Mobile).
 */
class Ga20ConsolePanel(
    private val act: androidx.activity.ComponentActivity,
    private val isShown: () -> Boolean,
    private val pick: () -> Unit
) {
    private var container: ViewGroup? = null
    private var copying = false
    private var copyLabel = ""
    private var copyDone = 0L
    private var copyTotal = -1L
    private var bar: ProgressBar? = null
    private var barText: TextView? = null

    private val d get() = act.resources.displayMetrics.density
    private fun px(v: Int): Int = (v * d).toInt()

    fun render(c: ViewGroup): Boolean {
        return try {
            container = c
            build(c)
            true
        } catch (e: Exception) {
            android.util.Log.e("GA20", "painel: ${e.message}", e)
            c.removeAllViews()
            false
        }
    }

    fun onPicked(uri: Uri?) {
        if (uri == null || copying) return
        copying = true
        copyLabel = "A preparar…"
        copyDone = 0L
        copyTotal = -1L
        rerender()
        act.lifecycleScope.launch {
            val err = Ga20Roms.importRom(act, uri) { dn, tot ->
                copyDone = dn
                copyTotal = tot
                updateBar()
            }
            copying = false
            if (act.isFinishing) return@launch
            Toast.makeText(act, err ?: "Jogo adicionado à tua biblioteca ✓", if (err == null) Toast.LENGTH_SHORT else Toast.LENGTH_LONG).show()
            rerender()
        }
    }

    private fun rerender() {
        val c = container ?: return
        if (!isShown()) return
        c.removeAllViews()
        render(c)
    }

    private fun updateBar() {
        val b = bar ?: return
        val t = barText
        if (copyTotal > 0) {
            b.isIndeterminate = false
            b.progress = ((copyDone * 1000) / copyTotal).toInt().coerceIn(0, 1000)
            t?.text = "A copiar… " + Ga20Roms.human(copyDone) + " / " + Ga20Roms.human(copyTotal)
        } else {
            b.isIndeterminate = true
            t?.text = "A copiar… " + Ga20Roms.human(copyDone)
        }
    }

    private fun round(color: Int, radius: Float, stroke: Int = 0, strokeColor: Int = 0): android.graphics.drawable.GradientDrawable {
        val g = android.graphics.drawable.GradientDrawable()
        g.cornerRadius = radius
        g.setColor(color)
        if (stroke > 0) g.setStroke(stroke, strokeColor)
        return g
    }

    private fun build(c: ViewGroup) {
        val neon = ContextCompat.getColor(act, R.color.neon_green)
        val card = ContextCompat.getColor(act, R.color.bg_card)
        val deep = ContextCompat.getColor(act, R.color.bg_deep)
        val tp = ContextCompat.getColor(act, R.color.text_primary)
        val ts = ContextCompat.getColor(act, R.color.text_secondary)
        val tm = ContextCompat.getColor(act, R.color.text_muted)
        val wrap = LinearLayout.LayoutParams.WRAP_CONTENT
        val match = LinearLayout.LayoutParams.MATCH_PARENT
        fun alpha(col: Int, a: Int) = androidx.core.graphics.ColorUtils.setAlphaComponent(col, a)

        // ── cabeçalho ──
        val head = LinearLayout(act)
        head.orientation = LinearLayout.VERTICAL
        head.gravity = Gravity.CENTER_HORIZONTAL
        head.setPadding(px(20), px(22), px(20), px(20))
        head.background = round(card, 16 * d, px(1).coerceAtLeast(1), alpha(neon, 90))
        head.layoutParams = LinearLayout.LayoutParams(match, wrap).apply { topMargin = px(14) }

        val icon = TextView(act)
        icon.text = "🎮"
        icon.textSize = 32f
        icon.gravity = Gravity.CENTER
        icon.background = android.graphics.drawable.GradientDrawable().apply {
            shape = android.graphics.drawable.GradientDrawable.OVAL
            setColor(alpha(neon, 38))
            setStroke(px(2), alpha(neon, 150))
        }
        icon.layoutParams = LinearLayout.LayoutParams(px(72), px(72))
        head.addView(icon)

        val title = TextView(act)
        title.text = "Arena Console"
        title.setTextColor(tp)
        title.textSize = 18f
        title.typeface = android.graphics.Typeface.DEFAULT_BOLD
        title.gravity = Gravity.CENTER
        title.layoutParams = LinearLayout.LayoutParams(match, wrap).apply { topMargin = px(12) }
        head.addView(title)

        val sub = TextView(act)
        sub.text = "Carrega o teu jogo PSP (ISO ou CSO), cria uma sala e joga online 1x1 com um amigo."
        sub.setTextColor(ts)
        sub.textSize = 12f
        sub.gravity = Gravity.CENTER
        sub.setLineSpacing(0f, 1.15f)
        sub.layoutParams = LinearLayout.LayoutParams(match, wrap).apply { topMargin = px(6) }
        head.addView(sub)

        val btn = TextView(act)
        btn.text = if (copying) "A CARREGAR…" else "＋  CARREGAR JOGO (ISO)"
        btn.setTextColor(deep)
        btn.textSize = 14f
        btn.typeface = android.graphics.Typeface.DEFAULT_BOLD
        btn.letterSpacing = 0.06f
        btn.gravity = Gravity.CENTER
        btn.background = round(if (copying) alpha(neon, 120) else neon, 50 * d)
        btn.setPadding(px(22), px(12), px(22), px(12))
        btn.isClickable = true
        btn.isFocusable = true
        btn.layoutParams = LinearLayout.LayoutParams(wrap, wrap).apply { topMargin = px(16) }
        btn.setOnClickListener {
            if (copying) return@setOnClickListener
            try { pick() } catch (e: Exception) {
                Toast.makeText(act, "Não foi possível abrir o seletor de ficheiros.", Toast.LENGTH_SHORT).show()
            }
        }
        head.addView(btn)

        if (copying) {
            val pb = ProgressBar(act, null, android.R.attr.progressBarStyleHorizontal)
            pb.max = 1000
            pb.isIndeterminate = copyTotal <= 0
            pb.progressTintList = android.content.res.ColorStateList.valueOf(neon)
            pb.layoutParams = LinearLayout.LayoutParams(match, px(6)).apply { topMargin = px(14) }
            head.addView(pb)
            bar = pb
            val pt = TextView(act)
            pt.text = copyLabel
            pt.setTextColor(ts)
            pt.textSize = 11f
            pt.gravity = Gravity.CENTER
            pt.layoutParams = LinearLayout.LayoutParams(match, wrap).apply { topMargin = px(6) }
            head.addView(pt)
            barText = pt
            updateBar()
        } else {
            bar = null
            barText = null
        }

        val legal = TextView(act)
        legal.text = "Usa apenas cópias de jogos que tens. O ficheiro fica só neste telemóvel."
        legal.setTextColor(tm)
        legal.textSize = 10f
        legal.gravity = Gravity.CENTER
        legal.layoutParams = LinearLayout.LayoutParams(match, wrap).apply { topMargin = px(12) }
        head.addView(legal)
        c.addView(head)

        // ── biblioteca ──
        val roms = Ga20Roms.list(act)
        val label = TextView(act)
        label.text = "A TUA BIBLIOTECA · " + roms.size
        label.setTextColor(tm)
        label.textSize = 10f
        label.typeface = android.graphics.Typeface.DEFAULT_BOLD
        label.letterSpacing = 0.1f
        label.layoutParams = LinearLayout.LayoutParams(match, wrap).apply { topMargin = px(18); bottomMargin = px(6) }
        c.addView(label)

        if (roms.isEmpty()) {
            val empty = TextView(act)
            empty.text = "Ainda não tens jogos. Toca em \"Carregar jogo (ISO)\" e escolhe o ficheiro no telemóvel."
            empty.setTextColor(tm)
            empty.textSize = 12f
            empty.gravity = Gravity.CENTER
            empty.setPadding(px(12), px(26), px(12), px(26))
            c.addView(empty)
            return
        }

        for (r in roms) {
            val row = LinearLayout(act)
            row.orientation = LinearLayout.HORIZONTAL
            row.gravity = Gravity.CENTER_VERTICAL
            row.setPadding(px(14), px(12), px(14), px(12))
            row.background = round(card, 12 * d, px(1).coerceAtLeast(1), alpha(neon, 40))
            row.layoutParams = LinearLayout.LayoutParams(match, wrap).apply { bottomMargin = px(8) }
            row.isClickable = true
            row.isFocusable = true

            val disc = TextView(act)
            disc.text = "💿"
            disc.textSize = 24f
            row.addView(disc)

            val col = LinearLayout(act)
            col.orientation = LinearLayout.VERTICAL
            col.layoutParams = LinearLayout.LayoutParams(0, wrap, 1f).apply { marginStart = px(12) }
            val nm = TextView(act)
            nm.text = r.name
            nm.setTextColor(tp)
            nm.textSize = 14f
            nm.typeface = android.graphics.Typeface.DEFAULT_BOLD
            nm.maxLines = 1
            nm.ellipsize = android.text.TextUtils.TruncateAt.END
            col.addView(nm)
            val info = TextView(act)
            info.text = r.file.extension.uppercase() + " · " + Ga20Roms.human(r.size) + (if (r.gid.isNotBlank()) " · " + r.gid else "")
            info.setTextColor(ts)
            info.textSize = 11f
            col.addView(info)
            row.addView(col)

            val play = TextView(act)
            play.text = "JOGAR"
            play.setTextColor(neon)
            play.textSize = 11f
            play.typeface = android.graphics.Typeface.DEFAULT_BOLD
            play.background = round(alpha(neon, 28), 50 * d, px(1).coerceAtLeast(1), neon)
            play.setPadding(px(12), px(5), px(12), px(5))
            row.addView(play)

            val open = View.OnClickListener {
                if (copying) return@OnClickListener
                act.startActivity(Intent(act, ConsoleLobbyActivity::class.java).putExtra(ConsoleLobbyActivity.EXTRA_ROM, r.file.absolutePath))
            }
            row.setOnClickListener(open)
            play.setOnClickListener(open)
            row.setOnLongClickListener {
                android.app.AlertDialog.Builder(act)
                    .setTitle("Apagar jogo?")
                    .setMessage(r.name + " (" + Ga20Roms.human(r.size) + ") vai ser apagado deste telemóvel.")
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton("Apagar") { _, _ -> Ga20Roms.delete(r); rerender() }
                    .show()
                true
            }
            c.addView(row)
        }
    }
}
