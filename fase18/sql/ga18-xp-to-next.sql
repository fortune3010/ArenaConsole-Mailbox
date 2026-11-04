-- GA18_XP_TO_NEXT — correr no Supabase SQL Editor (opcional, mas recomendado).
-- O backend (ga16History.awardXp) já grava xp_to_next = 100 a cada partida;
-- isto alinha os utilizadores que ainda não jogaram depois do deploy.

-- 1) Confirmar colunas (deve devolver xp, level, xp_to_next)
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'users'
  and column_name in ('xp', 'level', 'xp_to_next');

-- 2) Novo padrão + utilizadores existentes
alter table public.users alter column xp_to_next set default 100;
update public.users set xp_to_next = 100 where xp_to_next is distinct from 100;

-- 3) (OPCIONAL — decide tu) recalcular o nível de todos pela fórmula nova: level = 1 + floor(xp / 100)
-- update public.users set level = 1 + floor(coalesce(xp, 0) / 100);
