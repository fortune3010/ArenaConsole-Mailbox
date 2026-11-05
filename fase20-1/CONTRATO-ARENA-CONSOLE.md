# Contrato Launcher → Arena Console (protocolo 1)

Este documento é a referência para a app do emulador (Fase 20.2). O Launcher já cumpre este contrato a partir da Fase 20.1.

## 1. Intent

O `ConsoleLobbyActivity` envia um Intent implícito quando o servidor manda `console_start`:

| Campo | Valor |
|---|---|
| action | `com.gamearena.console.START_GAME` |
| category | `android.intent.category.DEFAULT` |
| data | nenhum (não usa `setData`) |
| ClipData | `content://<applicationId>.console.fileprovider/roms/<ficheiro>` |
| flags | `FLAG_GRANT_READ_URI_PERMISSION` |

Os extras vão soltos no Intent e também agrupados num Bundle com a chave `arena_bundle`.

| Chave | Tipo | Exemplo | Notas |
|---|---|---|---|
| `iso_uri` | String | `content://com.gamearena.console.fileprovider/roms/MHFU.iso` | **Usar este.** Abrir com `contentResolver.openFileDescriptor(uri, "r")`. |
| `iso_path` | String | `/storage/emulated/0/Android/data/com.gamearena/files/Documents/roms/MHFU.iso` | Só informativo. No Android 11+ outra app não consegue ler este caminho. |
| `iso_name` | String | `MHFU` | Nome mostrado ao jogador. |
| `iso_fingerprint` | String | 32 hex | SHA-256 dos primeiros 4 MB + tamanho, truncado. Igual nos dois jogadores. |
| `game_id` | String | `ULES01213` | ID do volume ISO. Vazio em CSO/PBP. |
| `role` | String | `host` ou `guest` | |
| `peer_id` | String | 16 hex | O meu id na partida. |
| `remote_peer_id` | String | 16 hex | O id do adversário. |
| `room_code` | String | `GU74FX` | |
| `start_token` | String | 32 hex | Segredo da partida. Necessário para o `emu_join`. |
| `server_url` | String | `https://gamer-fortune.onrender.com` | |
| `signal_namespace` | String | `/console` | Socket.IO com `path: '/ws'`. |
| `protocol_version` | Int | `1` | |

### intent-filter de exemplo (Manifest do Arena Console)
```xml
<activity android:name=".EmulatorActivity" android:exported="true">
    <intent-filter>
        <action android:name="com.gamearena.console.START_GAME" />
        <category android:name="android.intent.category.DEFAULT" />
    </intent-filter>
</activity>
```

### Leitura da ISO no emulador (Kotlin)
```kotlin
val uri = intent.clipData?.getItemAt(0)?.uri
    ?: intent.getStringExtra("iso_uri")?.takeIf { it.isNotBlank() }?.let(Uri::parse)
val pfd = uri?.let { contentResolver.openFileDescriptor(it, "r") } // passar pfd.fd ao núcleo do emulador
```
A permissão de leitura dura enquanto a Activity que recebeu o Intent estiver viva.

O Launcher valida `role`, `room_code`, `peer_id`, `remote_peer_id` e `start_token` antes de enviar. Se nenhuma app tiver o filtro, mostra "Arena Console não instalado" e a sala fica aberta.

## 2. Sinalização do emulador (namespace `/console`)

Ligação: `io("https://gamer-fortune.onrender.com/console", { path: "/ws" })`.

| Sentido | Evento | Dados |
|---|---|---|
| emulador → servidor | `emu_join` | `{code, pid, startToken}` (code = `room_code`, pid = `peer_id`) |
| servidor → emulador | `emu_ready` | `{role, peerPid, iceServers, peerOnline}` |
| servidor → emulador | `emu_error` | `{reason: no_match \| bad_token \| bad_peer \| replaced}` |
| emulador → servidor | `emu_signal` | `{sdp:{type:'offer'\|'answer', sdp}}` ou `{candidate:{candidate, sdpMid, sdpMLineIndex}}` |
| servidor → emulador | `emu_signal` | o mesmo, com `from` (pid do outro) |
| servidor → emulador | `emu_peer` | `{online}`: o outro emulador ligou ou desligou |
| emulador → servidor | `emu_result` | `{winnerRole: 'host' \| 'guest' \| 'draw'}` |

Regras:
- O Host cria a oferta WebRTC quando `peerOnline` for `true` ou quando receber `emu_peer {online:true}`.
- `iceServers` vem do `cloudflare-turn` (como no Hockey). Sem ele, o servidor usa STUN público.
- O resultado só conta quando os dois emuladores enviam o mesmo `winnerRole`. Nesse caso o servidor chama `opts.onFinish` (GA16) e envia `console_over` ao lobby.
- Uma partida iniciada aceita (re)ligações dos emuladores durante 6 horas. Uma sala parada no lobby expira ao fim de 30 minutos.
