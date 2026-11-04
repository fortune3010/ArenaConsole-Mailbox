# Fase 19.5.1 — ecrã de chamada roxo/neon

Substitui o activity_call.xml da Fase 19.5 (que foi retirado, junto com ga195_styles.xml).

| Ação | Ficheiro |
|---|---|
| SUBSTITUIR | res/layout/activity_call.xml |
| SUBSTITUIR | res/drawable/ga13_call_btn.xml, ga13_call_btn_on.xml (fundos que o CallActivity aplica aos botões → vidro roxo) |
| NOVO | res/drawable/ga1951_*.xml (ondas em vector, brilho, anel neon, anéis a pulsar, avatar, botão vermelho, pílula, linha do nome, véu) |
| NOVO | res/values/ga1951_styles.xml |
| SCRIPT | scripts/ga1951-call-top.js → 2 linhas no CallActivity.setPhase() (título do topo) |
| ALTERADO | fase19.5/res/values*/strings_ga195.xml (+3 textos: Chamada recebida / de voz / de vídeo) |

Todos os IDs ga135* / call* mantidos. CallScreenFx.kt sem alterações.
