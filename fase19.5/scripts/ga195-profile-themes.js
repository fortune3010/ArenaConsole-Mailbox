#!/usr/bin/env node
'use strict';
/**
 * GA195_THEMES — troca o seletor "Escuro / Claro" do Perfil pela grelha dos 11 temas (GaThemes.picker).
 * Só substitui o bloco do tema em renderCustomize(); o resto do ProfileActivity.kt fica igual.
 * Idempotente (marcador GA195_THEMES).  Uso na raiz do repo:  node scripts/ga195-profile-themes.js
 */
const fs = require('fs');
const path = require('path');
function must(c, m) { if (!c) { console.error('❌ ' + m); process.exit(1); } }

const f = path.join(process.cwd(), 'app/src/main/java/com/gamearena/ui/ProfileActivity.kt');
must(fs.existsSync(f), 'não existe ' + f);
let s = fs.readFileSync(f, 'utf8');
if (s.includes('GA195_THEMES')) { console.log('= ProfileActivity.kt: já aplicado'); process.exit(0); }

const OLD = [
  '        val night = isNightActive()',
  '        val theme = section(getString(R.string.prof_theme), R.drawable.ic_moon)',
  '        val themeRow = LinearLayout(this).apply {',
  '            orientation = LinearLayout.HORIZONTAL',
  '            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = 6 }',
  '        }',
  '        themeRow.addView(themePill(R.drawable.ic_moon, getString(R.string.prof_dark_mode), true, night))',
  '        themeRow.addView(themePill(R.drawable.ic_sun, getString(R.string.prof_light_mode), false, !night))',
  '        theme.addView(themeRow)',
  '        content.addView(theme)'
].join('\n');
const NEW = [
  '        val theme = section(getString(R.string.prof_theme), R.drawable.ic_moon)',
  '        theme.addView(GaThemes.picker(this) { p -> GaThemes.select(this, p) }) // GA195_THEMES: 11 temas',
  '        content.addView(theme)'
].join('\n');

const norm = s.replace(/\r\n/g, '\n');
const a = norm.indexOf(OLD);
must(a >= 0, 'bloco do tema não encontrado em renderCustomize() — corre: grep -n "themePill\\|isNightActive()" ' + f);
must(norm.indexOf(OLD, a + 1) < 0, 'bloco do tema aparece mais de uma vez');
fs.writeFileSync(f, norm.slice(0, a) + NEW + norm.slice(a + OLD.length));
console.log('✅ ProfileActivity.kt: seletor de 11 temas');
