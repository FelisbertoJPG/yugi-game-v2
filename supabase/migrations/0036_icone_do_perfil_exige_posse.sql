-- ============================================================================
-- A POSSE do icone vale por QUALQUER caminho, nao so' pelo `escolher_icone`.
--
-- O furo, encontrado ao provar as travas da 0035: a policy de `perfis` e'
-- `perfis_atualizar_proprio` (`id = auth.uid() OR eh_admin()`), isto e', o dono
-- pode escrever na propria linha. Entao um `PATCH /perfis?id=eq.<meu>` com
-- `icone_id` de um icone caro passava por cima do `escolher_icone` inteiro — a
-- funcao continuava certa e simplesmente deixava de ser o unico caminho.
--
-- Na hora da prova ele so' nao passou porque o icone escolhido nao existia no
-- catalogo (a chave estrangeira barrou). Com um icone REAL no catalogo, teria
-- passado — o tipo de furo que so' aparece depois que o conteudo existe.
--
-- A regra e' do DONO DA LINHA, e nao de quem esta' escrevendo: "este perfil so'
-- pode usar um icone que ESTE perfil tem". Assim ela vale igual para o jogador,
-- para o admin editando outra pessoa e para qualquer funcao futura — nao ha'
-- caminho privilegiado que a contorne por distracao. Quem quiser dar um icone a
-- alguem usa `dar_icone`, que e' a porta que existe para isso.
-- ============================================================================

create or replace function public.perfis_valida_icone()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.icone_id is null then return new; end if;

  -- Nao mexeu no icone: nada a conferir. Sem esta saida, todo update de perfil
  -- (o `visto_em` do batimento, a cada 45s, de todo jogador aberto) pagaria a
  -- consulta de posse a' toa.
  if tg_op = 'UPDATE' and new.icone_id is not distinct from old.icone_id then
    return new;
  end if;

  if not exists (
    select 1 from public.icones i
     where i.id = new.icone_id
       and (i.gratuito
            or exists (select 1 from public.icones_do_jogador j
                        where j.icone_id = i.id and j.usuario_id = new.id))
  ) then
    raise exception 'este perfil nao tem o icone %', new.icone_id;
  end if;

  return new;
end;
$$;

comment on function public.perfis_valida_icone() is
  'Recusa icone_id que o dono do perfil nao possui, venha por onde vier.';

drop trigger if exists perfis_icone_valido on public.perfis;
create trigger perfis_icone_valido
  before insert or update of icone_id on public.perfis
  for each row execute function public.perfis_valida_icone();
