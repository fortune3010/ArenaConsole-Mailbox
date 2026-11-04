-- GA19 — limite de jogadores das SALAS LIVRES (routes/rooms.js:293 usa games."maxPlayersPerRoom", ou 2 se vier vazio).
-- NÃO afecta torneios: as salas de torneio são criadas pelo ga15SyncFix com max_players = jogadores da partida.

-- 1) Ver o estado actual (procura por nome e por id)
select id, "displayName", "maxPlayersPerRoom"
from games
where id ilike '%neon%' or id ilike '%flappy%' or id ilike '%impostor%'
   or "displayName" ilike '%neon%' or "displayName" ilike '%flappy%' or "displayName" ilike '%impostor%';

-- 2) Subir só quem está abaixo do máximo que o jogo suporta (NeonRush 8, Flappy 12, Impostor 10)
update games set "maxPlayersPerRoom" = 8
 where (id ilike '%neon%' or "displayName" ilike '%neon%') and coalesce("maxPlayersPerRoom", 0) < 8;
update games set "maxPlayersPerRoom" = 12
 where (id ilike '%flappy%' or "displayName" ilike '%flappy%') and coalesce("maxPlayersPerRoom", 0) < 12;
update games set "maxPlayersPerRoom" = 10
 where (id ilike '%impostor%' or "displayName" ilike '%impostor%') and coalesce("maxPlayersPerRoom", 0) < 10;

-- 3) Confirmar (repetir a query 1)
