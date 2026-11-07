# GA20_ARENA · PATCH 1: Player de Trailer Interno (Landscape, Botão X, Auto-close)

## Contexto
O `ConsoleMenuActivity.kt` tem um botão "VER TRAILER" que atualmente abre o seletor do Android (`Intent.ACTION_VIEW`).
O dono quer um player **nativo** (como overlay do YouTube): landscape forçado, botão X no canto, auto-close no fim.

## Ficheiros afetados
- `app/src/main/java/com/gamearena/ui/TrailerPlayerActivity.kt` (NOVO)
- `app/src/main/res/layout/activity_trailer_player.xml` (NOVO)
- `app/src/main/java/com/gamearena/ui/ConsoleMenuActivity.kt` (1 linha alterada)

---

## PASSO 1: Criar TrailerPlayerActivity.kt

Cria o ficheiro `app/src/main/java/com/gamearena/ui/TrailerPlayerActivity.kt`:

```kotlin
package com.gamearena.ui

import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.VideoView
import androidx.appcompat.app.AppCompatActivity
import com.gamearena.R

/**
 * GA20_ARENA: player de trailer nativo (landscape, botão X, auto-close).
 * 
 * Uso:
 *   Intent(context, TrailerPlayerActivity::class.java)
 *     .putExtra(EXTRA_VIDEO_URL, "https://example.com/trailer.mp4")
 */
class TrailerPlayerActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_VIDEO_URL = "video_url"
    }

    private lateinit var videoView: VideoView
    private lateinit var closeButton: ImageButton
    private lateinit var progressBar: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Landscape forçado (como GameWebViewActivity linha 281)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        
        // Fullscreen (como GameWebViewActivity linha 202-209)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setBackgroundDrawable(null)
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        androidx.core.view.WindowInsetsControllerCompat(window, window.decorView).run {
            hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        
        setContentView(R.layout.activity_trailer_player)
        
        videoView = findViewById(R.id.trailerVideoView)
        closeButton = findViewById(R.id.trailerCloseButton)
        progressBar = findViewById(R.id.trailerProgressBar)
        
        val videoUrl = intent.getStringExtra(EXTRA_VIDEO_URL)
        if (videoUrl.isNullOrBlank()) {
            finish()
            return
        }
        
        closeButton.setOnClickListener { finish() }
        
        videoView.setOnPreparedListener { mp ->
            progressBar.visibility = View.GONE
            mp.start()
        }
        
        videoView.setOnCompletionListener {
            // Auto-close no fim do vídeo
            finish()
        }
        
        videoView.setOnErrorListener { _, what, extra ->
            android.util.Log.e("TrailerPlayer", "Erro ao reproduzir: what=$what extra=$extra")
            android.widget.Toast.makeText(this, "Não foi possível reproduzir o trailer.", android.widget.Toast.LENGTH_LONG).show()
            finish()
            true
        }
        
        try {
            videoView.setVideoURI(Uri.parse(videoUrl))
        } catch (e: Exception) {
            android.util.Log.e("TrailerPlayer", "URI inválido: $videoUrl", e)
            finish()
        }
    }
    
    override fun onPause() {
        super.onPause()
        // Pausa o vídeo se o utilizador sair (ex: botão Home)
        if (::videoView.isInitialized && videoView.isPlaying) {
            videoView.pause()
        }
    }
    
    override fun onDestroy() {
        if (::videoView.isInitialized) {
            videoView.stopPlayback()
        }
        super.onDestroy()
    }
}
```

---

## PASSO 2: Criar layout activity_trailer_player.xml

Cria o ficheiro `app/src/main/res/layout/activity_trailer_player.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- GA20_ARENA: player de trailer (landscape, botão X, auto-close) -->
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#000000">

    <!-- VideoView fullscreen -->
    <VideoView
        android:id="@+id/trailerVideoView"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:layout_gravity="center" />

    <!-- Loading spinner (desaparece quando o vídeo arrancar) -->
    <ProgressBar
        android:id="@+id/trailerProgressBar"
        style="?android:attr/progressBarStyleLarge"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_gravity="center"
        android:indeterminateTint="#FFFFFF" />

    <!-- Botão X no canto superior direito -->
    <ImageButton
        android:id="@+id/trailerCloseButton"
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:layout_gravity="top|end"
        android:layout_margin="16dp"
        android:background="@android:color/transparent"
        android:contentDescription="Fechar"
        android:src="@android:drawable/ic_menu_close_clear_cancel"
        android:tint="#FFFFFF"
        android:scaleType="fitCenter"
        android:padding="8dp" />

</FrameLayout>
```

---

## PASSO 3: Alterar ConsoleMenuActivity.kt (trocar launchExternalPlayer)

No ficheiro `app/src/main/java/com/gamearena/ui/ConsoleMenuActivity.kt`, localiza o método `launchExternalPlayer()`:

<!-- must(find_exact) -->
```kotlin
    private fun launchExternalPlayer(url: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.setDataAndType(Uri.parse(url), "video/*")
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "Não foi possível abrir o trailer.", Toast.LENGTH_LONG).show()
        }
    }
```
<!-- must(end) -->

Substitui por:

<!-- must(replace_with) -->
```kotlin
    private fun launchExternalPlayer(url: String) {
        try {
            val intent = Intent(this, TrailerPlayerActivity::class.java)
                .putExtra(TrailerPlayerActivity.EXTRA_VIDEO_URL, url)
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "Não foi possível abrir o trailer.", Toast.LENGTH_LONG).show()
        }
    }
```
<!-- must(end) -->

---

## Resultado
✅ Ao clicar em "VER TRAILER", abre o `TrailerPlayerActivity` em landscape.  
✅ Botão X no canto superior direito fecha o player.  
✅ Se o vídeo chegar ao fim, fecha automaticamente.  
✅ Sem seletor do Android (UX limpa).

---

## NOTA: AndroidManifest.xml
A declaração da Activity vai no **patch 06** (separado para evitar conflitos de merge).
