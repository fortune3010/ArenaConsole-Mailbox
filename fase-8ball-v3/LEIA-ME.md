# 8-Ball v3: microfone à esquerda e mesa sincronizada

Este script substitui as tentativas `fase-8ball/` (v1 e v2). Não uses essas.

Ficheiros que o script altera no Arenaapk:
- `backend/public/games/8ball/index.html`
- `backend/services/pool-namespace.js`

Ficheiros em que não toca: o Ludo e o `backend/public/games/shared/voice.js`.

## Como aplicar (Termux, na raiz do Arenaapk)

```
cp ~/Kiro-arquivos-/fase-8ball-v3/ga-8ball-v3.js .
node ga-8ball-v3.js
git add backend/public/games/8ball/index.html backend/services/pool-namespace.js
git commit -m "8-Ball v3: microfone do Host + esquerda, mesa do Host sincronizada"
git push arena rooms-client-validation:rooms-client-validation
rm ga-8ball-v3.js
```

As 8 âncoras foram tiradas dos teus greps. O script exige que cada uma apareça exatamente 1 vez. Se alguma falhar, não escreve nenhum ficheiro e diz qual é o grep que precisa. Depois de escrever, faz `node --check` ao servidor e compila os scripts do `index.html`. Se algo falhar, repõe o original. Não faças `git add` dos `.bak`.

## O que muda

**Microfone (index.html)**
- `join()` passa a usar a mesma lógica do Ludo. O Host recebe um `anonToken` (`anon-…`, guardado em `sessionStorage`) e o jogo chama `gaVoice.setRoom(ROOM, TOKEN||anonToken)` para o Host e para o Guest. O `create_room`/`join_room` enviado ao servidor do 8-Ball fica igual.
- A tag passa a ser `<script>window.GA_VOICE_LEFT=true;</script><script src="/games/shared/voice.js?v=7"></script>`.
- O `voice.js` que está no repo é a v2, que ainda não lê `GA_VOICE_LEFT`. Por isso o lado esquerdo é garantido por um `<style>` desta página com `#gaVoiceBtn#gaVoiceBtn`. Esse seletor ganha ao `!important` do `voice.js` sem alterar o ficheiro partilhado.

**Mesa (index.html + pool-namespace.js)**
- Host: ao clicar numa mesa antes do jogo, envia `set_scene {code, scene, token}`.
- Servidor: o `set_scene` só é aceite do lugar 0 e só antes do início. Guarda `room.scene` e envia `scene_update` e `room_update` (que passa a levar `scene`). O `match_start` já levava `scene`. Fica um log `[pool] GA16 ...` no Render.
- Guest: aplica a mesa recebida em `scene_update`, em `room_update` e em `match_start`. Se o `onMatch()` mudar a mesa depois disso, volta a pôr a do servidor. O Guest deixa de poder escolher a mesa numa sala (aparece o aviso "A mesa é escolhida pelo anfitrião"). A preferência local `p8s` do Guest não é apagada.
- Se o servidor tiver uma mesa diferente da do Host (por exemplo, o Host clicou antes de a sala existir), o Host corrige-a automaticamente.

## Testes feitos no sandbox

- Script aplicado a ficheiros com as linhas exatas dos greps: 8/8 âncoras, idempotente, e uma âncora em falta não escreve nada.
- Cliente simulado: 16/16 casos (Host, Guest e treino).
- Servidor simulado: 6/6 casos (Host muda para a Mesa 7, um estranho é recusado, `match_start` com a Mesa 7 para os dois, ninguém muda depois do início).

## Por confirmar

Não vi as linhas 54–74 do `backend/services/voice-namespace.js` (o bloco `GA17_VOICE_HOST_AUTH`). Se o microfone do Host aparecer mas disser "Voz indisponível nesta sala", manda-me:

```
nl -ba backend/services/voice-namespace.js | head -80 | tail -30
```
