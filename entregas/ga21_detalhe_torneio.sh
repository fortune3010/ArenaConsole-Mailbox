#!/usr/bin/env bash
# GA21 — reorganiza o ecrã de detalhe do torneio (cabeçalho, separadores no topo, estado em pill,
# regras em cartão, participantes com cabeçalho). Mantém ids, cores e o tema claro/rosa.
set -euo pipefail
APP="${GA_APP:-$HOME/GameArena/app/src/main}"
cd "$APP"
KT=java/com/gamearena/ui/TournamentDetailActivity.kt
LAYOUT=res/layout/activity_tournament_detail.xml
[ -f "$KT" ] && [ -f "$LAYOUT" ] || { echo "ERRO: não encontrei $KT ou $LAYOUT em $APP"; exit 1; }
command -v python3 >/dev/null 2>&1 || pkg install -y python

BK="$HOME/ga21_backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BK"
cp "$LAYOUT" "$KT" "$BK/"
echo ">> backup em $BK"

# 1) Kotlin: só ganchos de uma linha. Se alguma âncora não existir exatamente 1 vez, aborta sem escrever nada.
python3 - "$KT" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if "GA21_LAYOUT" in s:
    print(">> Kotlin já tinha o GA21, nada a fazer"); sys.exit(0)
A = "this@TournamentDetailActivity"
subs = [
    ("        ga15v5Install() // GA15V5_HISTORY\n",
     "        ga15v5Install() // GA15V5_HISTORY\n        Ga21DetailLayout.install(this) // GA21_LAYOUT\n"),
    ("        ga15v5PaintTabs() // GA15V5_HISTORY\n",
     "        ga15v5PaintTabs() // GA15V5_HISTORY\n        Ga21DetailLayout.paintTabs(this) // GA21_LAYOUT\n"),
    ("        Ga15DetailExtras.onTournament(this, t) // GA_V7\n",
     "        Ga15DetailExtras.onTournament(this, t) // GA_V7\n        statusBanner.post { Ga21DetailLayout.status(this, t.status) } // GA21_LAYOUT\n"),
    ('tabContent.addView(emptyText("Sem participantes ainda"))',
     'tabContent.addView(Ga21DetailLayout.participantsHeader(' + A + ', "0/${tournament?.maxPlayers ?: 0}")); '
     'tabContent.addView(Ga21DetailLayout.emptyPlayers(' + A + ')) // GA21_LAYOUT'),
    ("tabContent.addView(buildPlayerRow(idx + 1, p))",
     'if (idx == 0) tabContent.addView(Ga21DetailLayout.participantsHeader(' + A + ', "${tournament?.currentPlayers ?: 0}/${tournament?.maxPlayers ?: 0}")); '
     'tabContent.addView(buildPlayerRow(idx + 1, p)) // GA21_LAYOUT'),
]
for old, new in subs:
    n = s.count(old)
    if n != 1:
        print("ERRO: âncora encontrada %d vezes (esperado 1): %r" % (n, old.strip())); sys.exit(2)
for old, new in subs:
    s = s.replace(old, new)
open(p, "w", encoding="utf-8").write(s)
print(">> Kotlin: 5 ganchos aplicados")
PY

mkdir -p res/color res/drawable

# 2) Helper Kotlin novo
cat > java/com/gamearena/ui/Ga21DetailLayout.kt <<'EOF'
package com.gamearena.ui

// GA21_LAYOUT — acabamento do detalhe do torneio. Corre depois do Ga15DetailSkin / Ga15V5, que
// acrescentam "Histórico" e "Ranking" ao mesmo contentor dos separadores.

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.widget.TextViewCompat
import com.gamearena.R

object Ga21DetailLayout {

    private const val RANK = "ga15_rank_tab"

    private fun dp(a: Activity, x: Int) = (x * a.resources.displayMetrics.density).toInt()

    fun install(a: Activity) {
        try {
            a.window.statusBarColor = a.getColor(R.color.neon_green_dark)
            WindowInsetsControllerCompat(a.window, a.window.decorView).isAppearanceLightStatusBars = false
        } catch (_: Exception) {
        }
        header(a)
        // o ícone de partilhar pode ser acrescentado depois do primeiro frame
        a.findViewById<View>(R.id.btnBack)?.post { header(a) }
        tabLayout(a)
        paintTabs(a)
    }

    private fun header(a: Activity) {
        val back = a.findViewById<View>(R.id.btnBack) ?: return
        val bar = back.parent as? ViewGroup ?: return
        val titleRes = a.getString(R.string.txt_tournament_detail_torneio).trim()
        fun styleIcon(v: ImageView) {
            v.imageTintList = ColorStateList.valueOf(Color.WHITE)
            v.setBackgroundResource(R.drawable.bg_td_header_btn)
        }
        for (i in 0 until bar.childCount) {
            val v = bar.getChildAt(i)
            if (v === back) continue
            when (v) {
                is ImageView -> styleIcon(v)
                is TextView -> if (v.text.toString().trim().equals(titleRes, true)) v.text = title(titleRes.uppercase())
                is ViewGroup -> for (j in 0 until v.childCount) (v.getChildAt(j) as? ImageView)?.let { styleIcon(it) }
            }
        }
    }

    private fun title(t: String): CharSequence {
        val sb = SpannableStringBuilder(t)
        sb.setSpan(StyleSpan(Typeface.BOLD), 0, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        val start = sb.length
        sb.append("\nCompetir · Vencer · Evoluir")
        sb.setSpan(RelativeSizeSpan(0.55f), start, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        sb.setSpan(ForegroundColorSpan(0xCCFFFFFF.toInt()), start, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        return sb
    }

    private fun tabRow(a: Activity): LinearLayout? = a.findViewById<View>(R.id.tabPlayers)?.parent as? LinearLayout

    /** Os 4 separadores com a mesma largura e ícone por cima, numa só fila sem scroll. */
    private fun tabLayout(a: Activity) {
        val row = tabRow(a) ?: return
        for (i in 0 until row.childCount) {
            val tab = row.getChildAt(i) as? TextView ?: continue
            val icon = when {
                tab.id == R.id.tabPlayers -> R.drawable.ic_td_people
                tab.id == R.id.tabBracket -> R.drawable.ic_td_bracket
                tab.tag == RANK -> R.drawable.ic_td_trophy
                else -> R.drawable.ic_td_history
            }
            if (tab.tag == RANK) tab.text = "Ranking"
            tab.setCompoundDrawablesRelativeWithIntrinsicBounds(0, icon, 0, 0)
            tab.compoundDrawablePadding = dp(a, 3)
            tab.maxLines = 1
            tab.gravity = Gravity.CENTER
            tab.setPadding(dp(a, 4), dp(a, 8), dp(a, 4), dp(a, 8))
            // a cópia de layoutParams feita pelo Ga15V5 pode perder o peso
            val lp = (tab.layoutParams as? LinearLayout.LayoutParams)
                ?: LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.width = 0
            lp.weight = 1f
            lp.marginStart = dp(a, 2)
            lp.marginEnd = dp(a, 2)
            tab.layoutParams = lp
        }
    }

    /** Corre depois da pintura antiga: o activo mantém o pill rosa, os restantes ficam sem caixa. */
    fun paintTabs(a: Activity) {
        val row = tabRow(a) ?: return
        val activeText = a.getColor(R.color.bg_deep)
        for (i in 0 until row.childCount) {
            val tab = row.getChildAt(i) as? TextView ?: continue
            val active = tab.tag != RANK && tab.currentTextColor == activeText
            if (active) {
                tab.setBackgroundResource(R.drawable.bg_subtab_active)
            } else {
                tab.background = null
                tab.setTextColor(a.getColor(if (tab.tag == RANK) R.color.premium_gold else R.color.text_secondary))
            }
            TextViewCompat.setCompoundDrawableTintList(tab, ColorStateList.valueOf(tab.currentTextColor))
        }
    }

    fun status(a: Activity, status: String?) {
        val banner = a.findViewById<View>(R.id.statusBanner) ?: return
        val (bg, fg, dot) = when (status) {
            "OPEN" -> Triple(R.drawable.bg_td_status_open, 0xFF1E7A4D.toInt(), a.getColor(R.color.success))
            "FULL" -> Triple(R.drawable.bg_td_status_full, Color.WHITE, a.getColor(R.color.premium_gold))
            "LIVE" -> Triple(R.drawable.bg_td_status_live, a.getColor(R.color.live_red), a.getColor(R.color.live_red))
            else -> Triple(R.drawable.bg_td_status_neutral, a.getColor(R.color.text_secondary), a.getColor(R.color.dot_inactive))
        }
        banner.setBackgroundResource(bg)
        a.findViewById<TextView>(R.id.statusText)?.setTextColor(fg)
        a.findViewById<View>(R.id.statusDot)?.backgroundTintList = ColorStateList.valueOf(dot)
    }

    fun participantsHeader(a: Activity, count: String): View = LinearLayout(a).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundResource(R.drawable.bg_td_section_head)
        setPadding(dp(a, 16), dp(a, 12), dp(a, 12), dp(a, 12))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            .apply { bottomMargin = dp(a, 10) }
        addView(ImageView(a).apply {
            setImageResource(R.drawable.ic_td_people)
            imageTintList = ColorStateList.valueOf(0xFFF8BBD0.toInt())
        }, LinearLayout.LayoutParams(dp(a, 24), dp(a, 24)))
        addView(TextView(a).apply {
            text = "Participantes"
            textSize = 16f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.WHITE)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(a, 10) })
        addView(TextView(a).apply {
            text = count
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundResource(R.drawable.bg_td_count_pill)
            setPadding(dp(a, 12), dp(a, 4), dp(a, 12), dp(a, 4))
        })
    }

    fun emptyPlayers(a: Activity): View = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setBackgroundResource(R.drawable.bg_panel_card)
        setPadding(dp(a, 16), dp(a, 28), dp(a, 16), dp(a, 28))
        addView(ImageView(a).apply {
            setImageResource(R.drawable.ic_td_people)
            imageTintList = ColorStateList.valueOf(a.getColor(R.color.dot_inactive))
        }, LinearLayout.LayoutParams(dp(a, 56), dp(a, 56)))
        addView(TextView(a).apply {
            text = "Ainda não há jogadores inscritos."
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(a.getColor(R.color.text_muted))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(a, 10) })
    }
}
EOF

# 3) Drawables e cores novos (só usados neste ecrã; os partilhados ficam intactos)
w() { cat > "$1"; }
w res/drawable/bg_td_header.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:angle="0" android:startColor="@color/neon_green_dark" android:endColor="@color/neon_green" />
    <corners android:bottomLeftRadius="28dp" android:bottomRightRadius="28dp" android:topLeftRadius="0dp" android:topRightRadius="0dp" />
</shape>
EOF
w res/drawable/bg_td_header_btn.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
    <solid android:color="#40000000" />
</shape>
EOF
w res/drawable/bg_td_segment.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/bg_card" />
    <corners android:radius="18dp" />
    <stroke android:width="1dp" android:color="@color/divider" />
</shape>
EOF
w res/drawable/bg_td_status_full.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:angle="0" android:startColor="@color/neon_green_dark" android:endColor="@color/neon_green" />
    <corners android:radius="28dp" />
</shape>
EOF
w res/drawable/bg_td_status_open.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#E9F7EF" />
    <corners android:radius="28dp" />
    <stroke android:width="1dp" android:color="@color/success" />
</shape>
EOF
w res/drawable/bg_td_status_live.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FDECEC" />
    <corners android:radius="28dp" />
    <stroke android:width="1dp" android:color="@color/live_red" />
</shape>
EOF
w res/drawable/bg_td_status_neutral.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/bg_card" />
    <corners android:radius="28dp" />
    <stroke android:width="1dp" android:color="@color/divider" />
</shape>
EOF
w res/drawable/bg_td_rules_lock.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FCE4EC" />
    <corners android:radius="16dp" />
</shape>
EOF
w res/drawable/bg_td_section_head.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:angle="0" android:startColor="@color/neon_green_dark" android:endColor="@color/neon_green" />
    <corners android:radius="16dp" />
</shape>
EOF
w res/drawable/bg_td_count_pill.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/neon_pink" />
    <corners android:radius="14dp" />
</shape>
EOF
w res/drawable/ic_td_people.xml <<'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="22dp" android:height="22dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FF000000" android:pathData="M16,11c1.66,0 2.99,-1.34 2.99,-3S17.66,5 16,5c-1.66,0 -3,1.34 -3,3s1.34,3 3,3zM8,11c1.66,0 2.99,-1.34 2.99,-3S9.66,5 8,5C6.34,5 5,6.34 5,8s1.34,3 3,3zM8,13c-2.33,0 -7,1.17 -7,3.5V19h14v-2.5c0,-2.33 -4.67,-3.5 -7,-3.5zM16,13c-0.29,0 -0.62,0.02 -0.97,0.05 1.16,0.84 1.97,1.97 1.97,3.45V19h6v-2.5c0,-2.33 -4.67,-3.5 -7,-3.5z" />
</vector>
EOF
w res/drawable/ic_td_bracket.xml <<'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="22dp" android:height="22dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FF000000" android:pathData="M22,11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z" />
</vector>
EOF
w res/drawable/ic_td_history.xml <<'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="22dp" android:height="22dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FF000000" android:pathData="M13,3c-4.97,0 -9,4.03 -9,9H1l3.89,3.89 0.07,0.14L9,12H6c0,-3.87 3.13,-7 7,-7s7,3.13 7,7 -3.13,7 -7,7c-1.93,0 -3.68,-0.79 -4.94,-2.06l-1.42,1.42C8.27,19.99 10.51,21 13,21c4.97,0 9,-4.03 9,-9s-4.03,-9 -9,-9zM12,8v5l4.28,2.54 0.72,-1.21 -3.5,-2.08V8H12z" />
</vector>
EOF
w res/drawable/ic_td_trophy.xml <<'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="22dp" android:height="22dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="@color/premium_gold" android:pathData="M19,5h-2V3H7v2H5C3.9,5 3,5.9 3,7v1c0,2.55 1.92,4.63 4.39,4.94c0.63,1.5 1.98,2.63 3.61,2.96V19H7v2h10v-2h-4v-3.1c1.63,-0.33 2.98,-1.46 3.61,-2.96C19.08,12.63 21,10.55 21,8V7C21,5.9 20.1,5 19,5zM5,8V7h2v3.82C5.84,10.4 5,9.3 5,8zM19,8c0,1.3 -0.84,2.4 -2,2.82V7h2V8z" />
</vector>
EOF
w res/drawable/ic_td_trophy_lg.xml <<'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="44dp" android:height="44dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFD54F" android:pathData="M19,5h-2V3H7v2H5C3.9,5 3,5.9 3,7v1c0,2.55 1.92,4.63 4.39,4.94c0.63,1.5 1.98,2.63 3.61,2.96V19H7v2h10v-2h-4v-3.1c1.63,-0.33 2.98,-1.46 3.61,-2.96C19.08,12.63 21,10.55 21,8V7C21,5.9 20.1,5 19,5zM5,8V7h2v3.82C5.84,10.4 5,9.3 5,8zM19,8c0,1.3 -0.84,2.4 -2,2.82V7h2V8z" />
</vector>
EOF
w res/drawable/ic_td_rules.xml <<'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="@color/neon_green" android:pathData="M14,2H6c-1.1,0 -1.99,0.9 -1.99,2L4,20c0,1.1 0.89,2 1.99,2H18c1.1,0 2,-0.9 2,-2V8l-6,-6zM16,18H8v-2h8v2zM16,14H8v-2h8v2zM13,9V3.5L18.5,9H13z" />
</vector>
EOF
w res/color/td_action_bg.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:color="@color/border_blue" android:state_enabled="false" />
    <item android:color="@color/neon_green" />
</selector>
EOF
w res/color/td_action_text.xml <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:color="@color/text_muted" android:state_enabled="false" />
    <item android:color="@color/bg_deep" />
</selector>
EOF

# 4) Layout novo (mesmos ids; o texto "Regras" sem id continua imediatamente antes do rulesText)
w "$LAYOUT" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/bg_deep"
    android:orientation="vertical">

    <!-- GA21: cabeçalho rosa. Estrutura [voltar, título, espaço] mantida para os extras que lhe acrescentam o partilhar. -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:background="@drawable/bg_td_header"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:paddingStart="16dp"
        android:paddingTop="14dp"
        android:paddingEnd="16dp"
        android:paddingBottom="38dp">

        <ImageView
            android:id="@+id/btnBack"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:background="@drawable/bg_td_header_btn"
            android:clickable="true"
            android:contentDescription="@string/txt_create_tournament_voltar"
            android:focusable="true"
            android:padding="9dp"
            android:src="@drawable/ic_back"
            app:tint="@android:color/white" />

        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginStart="12dp"
            android:layout_weight="1"
            android:drawableStart="@drawable/ic_td_trophy_lg"
            android:drawablePadding="10dp"
            android:gravity="center_vertical|start"
            android:includeFontPadding="false"
            android:letterSpacing="0.03"
            android:lineSpacingMultiplier="1.1"
            android:maxLines="2"
            android:text="@string/txt_tournament_detail_torneio"
            android:textColor="@android:color/white"
            android:textSize="24sp" />

        <View
            android:layout_width="40dp"
            android:layout_height="40dp" />
    </LinearLayout>

    <!-- GA21: separadores fixos no topo, sobrepostos ao cabeçalho -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginHorizontal="16dp"
        android:layout_marginTop="-26dp"
        android:background="@drawable/bg_td_segment"
        android:baselineAligned="false"
        android:elevation="6dp"
        android:orientation="horizontal"
        android:padding="4dp">

        <TextView
            android:id="@+id/tabPlayers"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginHorizontal="2dp"
            android:layout_weight="1"
            android:background="@drawable/bg_subtab_active"
            android:clickable="true"
            android:drawableTop="@drawable/ic_td_people"
            android:drawablePadding="3dp"
            android:ellipsize="end"
            android:focusable="true"
            android:gravity="center"
            android:maxLines="1"
            android:paddingHorizontal="4dp"
            android:paddingVertical="8dp"
            android:text="Jogadores"
            android:textColor="@color/bg_deep"
            android:textSize="12sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/tabBracket"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginHorizontal="2dp"
            android:layout_weight="1"
            android:clickable="true"
            android:drawableTop="@drawable/ic_td_bracket"
            android:drawablePadding="3dp"
            android:ellipsize="end"
            android:focusable="true"
            android:gravity="center"
            android:maxLines="1"
            android:paddingHorizontal="4dp"
            android:paddingVertical="8dp"
            android:text="Chaves"
            android:textColor="@color/text_secondary"
            android:textSize="12sp"
            android:textStyle="bold" />
    </LinearLayout>

    <ScrollView
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:clipToPadding="false"
        android:fillViewport="true">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:paddingHorizontal="16dp"
            android:paddingTop="14dp"
            android:paddingBottom="16dp">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginBottom="12dp"
                android:background="@drawable/bg_panel_card"
                android:elevation="2dp"
                android:orientation="vertical"
                android:padding="18dp">

                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:gravity="center_vertical"
                    android:orientation="horizontal">

                    <TextView
                        android:id="@+id/tournamentCategory"
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:letterSpacing="0.03"
                        android:text="@string/txt_create_tournament_corrida_1v1"
                        android:textColor="@color/neon_green"
                        android:textSize="13sp"
                        android:textStyle="bold" />

                    <ImageView
                        android:id="@+id/tournamentSeal"
                        android:layout_width="22dp"
                        android:layout_height="27dp"
                        android:contentDescription="Oficial"
                        android:src="@drawable/ic_ga_seal"
                        android:visibility="gone" />
                </LinearLayout>

                <TextView
                    android:id="@+id/tournamentTitle"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="6dp"
                    android:ellipsize="end"
                    android:maxLines="2"
                    android:text="@string/txt_tournament_detail_torneio"
                    android:textColor="@color/text_primary"
                    android:textSize="24sp"
                    android:textStyle="bold" />

                <View
                    android:layout_width="match_parent"
                    android:layout_height="1dp"
                    android:layout_marginTop="14dp"
                    android:background="@color/divider" />

                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="14dp"
                    android:baselineAligned="false"
                    android:orientation="horizontal">

                    <LinearLayout
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:gravity="center_horizontal"
                        android:orientation="vertical">

                        <TextView
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:letterSpacing="0.05"
                            android:maxLines="1"
                            android:text="JOGADORES"
                            android:textColor="@color/text_muted"
                            android:textSize="11sp"
                            android:textStyle="bold" />

                        <TextView
                            android:id="@+id/tournamentPlayers"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:layout_marginTop="4dp"
                            android:maxLines="1"
                            android:text="0/8"
                            android:textColor="@color/text_primary"
                            android:textSize="16sp"
                            android:textStyle="bold" />
                    </LinearLayout>

                    <View
                        android:layout_width="1dp"
                        android:layout_height="match_parent"
                        android:background="@color/divider" />

                    <LinearLayout
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:gravity="center_horizontal"
                        android:orientation="vertical">

                        <TextView
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:letterSpacing="0.05"
                            android:maxLines="1"
                            android:text="ENTRADA"
                            android:textColor="@color/text_muted"
                            android:textSize="11sp"
                            android:textStyle="bold" />

                        <TextView
                            android:id="@+id/tournamentFee"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:layout_marginTop="4dp"
                            android:maxLines="1"
                            android:text="@string/txt_create_tournament_r_0_00"
                            android:textColor="@color/text_primary"
                            android:textSize="16sp"
                            android:textStyle="bold" />
                    </LinearLayout>

                    <View
                        android:layout_width="1dp"
                        android:layout_height="match_parent"
                        android:background="@color/divider" />

                    <LinearLayout
                        android:layout_width="0dp"
                        android:layout_height="wrap_content"
                        android:layout_weight="1"
                        android:gravity="center_horizontal"
                        android:orientation="vertical">

                        <TextView
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:letterSpacing="0.05"
                            android:maxLines="1"
                            android:text="PRÉMIO"
                            android:textColor="@color/text_muted"
                            android:textSize="11sp"
                            android:textStyle="bold" />

                        <TextView
                            android:id="@+id/tournamentPrize"
                            android:layout_width="wrap_content"
                            android:layout_height="wrap_content"
                            android:layout_marginTop="4dp"
                            android:drawableStart="@drawable/ic_td_trophy"
                            android:drawablePadding="2dp"
                            android:gravity="center_vertical"
                            android:maxLines="1"
                            android:text="@string/txt_create_tournament_r_0_00"
                            android:textColor="@color/premium_gold"
                            android:textSize="16sp"
                            android:textStyle="bold" />
                    </LinearLayout>
                </LinearLayout>
            </LinearLayout>

            <LinearLayout
                android:id="@+id/statusBanner"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginBottom="12dp"
                android:background="@drawable/bg_td_status_neutral"
                android:gravity="center_vertical"
                android:minHeight="52dp"
                android:orientation="horizontal"
                android:paddingHorizontal="18dp"
                android:paddingVertical="12dp">

                <View
                    android:id="@+id/statusDot"
                    android:layout_width="12dp"
                    android:layout_height="12dp"
                    android:background="@drawable/bg_dot_live" />

                <TextView
                    android:id="@+id/statusText"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="12dp"
                    android:layout_weight="1"
                    android:text="@string/txt_tournament_detail_inscricoes_abertas"
                    android:textColor="@color/text_primary"
                    android:textSize="15sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <!-- Sem id de propósito: o Ga15DetailSkin encontra-o por ser o irmão anterior do rulesText. -->
            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginBottom="10dp"
                android:background="@drawable/bg_td_rules_lock"
                android:gravity="center"
                android:paddingHorizontal="14dp"
                android:paddingVertical="12dp"
                android:text="@string/txt_create_tournament_regras"
                android:textColor="@color/neon_green"
                android:textSize="13sp"
                android:textStyle="bold" />

            <TextView
                android:id="@+id/rulesText"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginBottom="16dp"
                android:background="@drawable/bg_panel_card"
                android:drawableStart="@drawable/ic_td_rules"
                android:drawablePadding="12dp"
                android:gravity="center_vertical"
                android:lineSpacingMultiplier="1.25"
                android:minHeight="56dp"
                android:padding="16dp"
                android:text="@string/txt_create_tournament_regras"
                android:textColor="@color/text_primary"
                android:textSize="14sp"
                android:textStyle="bold" />

            <LinearLayout
                android:id="@+id/tabContent"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="vertical" />

            <TextView
                android:id="@+id/errorMessage"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="12dp"
                android:gravity="center"
                android:textColor="@color/live_red"
                android:textSize="12sp"
                android:visibility="gone" />
        </LinearLayout>
    </ScrollView>

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:background="@color/bg_deep"
        android:orientation="vertical"
        android:paddingHorizontal="16dp"
        android:paddingTop="10dp"
        android:paddingBottom="16dp">

        <Button
            android:id="@+id/actionButton"
            style="@style/NeonButton"
            android:layout_width="match_parent"
            android:layout_height="56dp"
            android:gravity="center"
            android:includeFontPadding="false"
            android:letterSpacing="0.06"
            android:minHeight="0dp"
            android:paddingTop="0dp"
            android:paddingBottom="0dp"
            android:text="@string/txt_tournament_detail_inscrever_me"
            android:textColor="@color/td_action_text"
            android:textSize="16sp"
            app:backgroundTint="@color/td_action_bg"
            app:cornerRadius="28dp" />

        <ProgressBar
            android:id="@+id/loadingBar"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_gravity="center_horizontal"
            android:layout_marginTop="12dp"
            android:indeterminateTint="@color/neon_green"
            android:visibility="gone" />
    </LinearLayout>
</LinearLayout>
EOF

echo ">> ficheiros escritos. Ganchos no Kotlin:"
grep -n "GA21_LAYOUT" "$KT" | cut -c1-120
echo
echo ">> Para desfazer: cp $BK/activity_tournament_detail.xml $APP/$LAYOUT && cp $BK/TournamentDetailActivity.kt $APP/$KT && rm -f $APP/java/com/gamearena/ui/Ga21DetailLayout.kt $APP/res/drawable/bg_td_*.xml $APP/res/drawable/ic_td_*.xml $APP/res/color/td_action_*.xml"
git -C "$APP" status --short 2>/dev/null | head -40 || true
