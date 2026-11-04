# Fase 19.5 — Temas, tradução, ecrã de chamada

## Ficheiros
| Ação | Ficheiro |
|---|---|
| NOVO | app/src/main/java/com/gamearena/ui/GaThemes.kt (11 temas + pele em tempo de execução) |
| SUBSTITUIR | app/src/main/java/com/gamearena/ui/BaseActivity.kt (aplica o tema; modo noturno segue o tema) |
| SUBSTITUIR | app/src/main/java/com/gamearena/ui/TournamentsActivity.kt (= Fase 16 + textos traduzíveis) |
| SUBSTITUIR | app/src/main/java/com/gamearena/ui/GameWebViewActivity.kt (= Fase 17 + texto traduzível) |
| SUBSTITUIR | app/src/main/res/layout/activity_call.xml (IDs ga135* preservados) |
| NOVO | app/src/main/res/values/ga195_styles.xml, values/ids_ga195.xml |
| NOVO | app/src/main/res/values{,-en,-ru,-ar,-zh,-tr}/strings_ga195.xml |
| SUBSTITUIR | backend/public/games/shared/ga16-post.js e voice.js (= Fases 16/17 + 6 idiomas) |
| NOVO (script) | scripts/ga195-profile-themes.js → altera só o bloco do tema no ProfileActivity.kt |

## Ordem
Aplicar depois das Fases 16→18→17→19. Depois: `node scripts/ga195-profile-themes.js`.

## Temas
Claro e Escuro (os existentes) ficam iguais. Novos: Chocolate, Neon Verde, Azul Elétrico, Roxo Real,
Vermelho Fogo, Rosa Doce, Ouro Imperial, Ciano Gamer, Galáxia. Guardado em gamearena_prefs / ga_theme.
Limitações (Fase 19.6): contornos (stroke) dos drawables XML e ícones pintados com setColorFilter() no Kotlin
mantêm a cor de destaque base.
