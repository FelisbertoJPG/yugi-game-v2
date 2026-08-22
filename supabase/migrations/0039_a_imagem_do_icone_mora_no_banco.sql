-- ============================================================================
-- A IMAGEM DO ICONE PASSA A MORAR NO BANCO.
--
-- A 0035 guardou so' o NOME do arquivo, com a imagem em `web/img/icones/`
-- viajando no `game.zip`. A ideia tinha uma logica — arte e' conteudo do
-- repositorio, como os tabuleiros — e um custo que so' apareceu no uso:
--
--   • a rota que grava o PNG so' existe no `tools/serve.mjs` (o `npm run dev`),
--     porque o jogo instalado serve %LOCALAPPDATA%, que nenhum Release le';
--   • entao, para quem roda o .exe — que e' como o jogo e' usado —, subir um
--     icone exigia mover o arquivo para o repositorio A MAO e publicar um
--     Release. POR ICONE. Na pratica, cadastrar icone era impossivel.
--
-- Hoje a imagem e' uma coluna: uma `data:` URL de ~1 a 40 KB por icone. Ela
-- chega junto com a linha, entao funciona no .exe, no `npm run dev` e em todo
-- jogador, sem Release nenhum e sem uma segunda fonte para divergir.
--
-- `arquivo` SAI. Com a imagem no banco ele seria uma segunda fonte para a mesma
-- coisa — o erro que este projeto ja' pagou (chancesDe x chancesDoPacote) — e as
-- duas se desencontrariam no primeiro icone cadastrado por um caminho so'.
-- ============================================================================

alter table public.icones
  add column if not exists imagem text;

comment on column public.icones.imagem is
  'A arte, como data: URL (PNG 128x128). Unica fonte — ver a 0039.';

alter table public.icones drop column if exists arquivo;

-- Teto por icone. Um PNG de 128x128 da' 1-40 KB em base64; 256 KB e' folga
-- larga para uma arte mais complexa e continua sendo um limite: sem ele, um
-- engano (subir a foto de 12 MB sem recortar) viajaria para todo jogador que
-- abrisse a lista de icones, para sempre.
alter table public.icones
  drop constraint if exists icones_imagem_tamanho;
alter table public.icones
  add constraint icones_imagem_tamanho
  check (imagem is null or length(imagem) <= 262144);

-- E TEM de ser imagem. Sem isto, a coluna aceitaria qualquer texto — inclusive
-- um `data:text/html`, que o navegador buscaria como imagem e simplesmente nao
-- desenharia, calado.
alter table public.icones
  drop constraint if exists icones_imagem_e_imagem;
alter table public.icones
  add constraint icones_imagem_e_imagem
  check (imagem is null or imagem ~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$');

-- ---------------------------------------------------------------- consultas
-- `meus_icones` devolve a imagem no lugar do arquivo. DROP antes: mudar as
-- colunas de um `returns table` nao e' um "create or replace".
drop function if exists public.meus_icones();

create function public.meus_icones()
returns table(id text, nome text, imagem text, preco int, raridade text,
              gratuito boolean, na_loja boolean, ordem int,
              tenho boolean, em_uso boolean)
language sql stable security definer
set search_path = public as $$
  select i.id, i.nome, i.imagem, i.preco, i.raridade,
         i.gratuito, i.na_loja, i.ordem,
         (i.gratuito or j.usuario_id is not null) as tenho,
         coalesce(p.icone_id = i.id, false)       as em_uso
    from public.icones i
    left join public.icones_do_jogador j
           on j.icone_id = i.id and j.usuario_id = auth.uid()
    left join public.perfis p on p.id = auth.uid()
   -- Os que voce tem primeiro, depois a ordem publicada, depois o nome: quem
   -- abre a tela quer escolher entre os seus, nao rolar a loja inteira.
   order by (i.gratuito or j.usuario_id is not null) desc, i.ordem, i.nome;
$$;

revoke all on function public.meus_icones() from public, anon;
grant execute on function public.meus_icones() to authenticated;

-- O premio de vitoria tambem devolve a imagem: a tela de fim de duelo mostra o
-- icone na hora, e uma segunda consulta so' para buscar a arte seria uma ida de
-- rede no meio da comemoracao.
create or replace function public.premiar_vitoria(p_duelo uuid)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  d record; w jsonb; npcs jsonb; npc jsonb;
  premio int; assinatura bigint; col jsonb;
  cfg jsonb; doNpc jsonb; escolhidoCfg jsonb; pool jsonb; qtd int; i int; escolhida bigint;
  sorteadas jsonb := '[]'::jsonb;
  drops jsonb := '[]'::jsonb;
  nova boolean;
  boosters jsonb;
  pesos jsonb := '{"UR": 4, "SR": 14, "R": 30, "N": 52}'::jsonb;
  baldes text[]; total int; sorteio numeric; r text; escolhido text; lista jsonb;
  chanceIcone int; faltando text[]; icone_id text; icone jsonb := null;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  select * into d from public.duelos
   where id = p_duelo and usuario_id = uid for update;

  if d is null then raise exception 'duelo nao encontrado'; end if;
  if d.premiado_em is not null then raise exception 'este duelo ja foi premiado'; end if;
  if now() - d.iniciado_em < interval '30 seconds' then
    raise exception 'duelo curto demais para ter sido jogado';
  end if;

  select dados into npcs from public.conteudo where chave = 'npcs';
  if npcs is not null then
    if jsonb_typeof(npcs) = 'array' then
      select value into npc from jsonb_array_elements(npcs)
        where value->>'id' = d.npc limit 1;
    else
      npc := npcs -> d.npc;
    end if;
  end if;

  premio := greatest(0, coalesce((npc->>'rewardDp')::int,
                                 (public.eco_const()->>'win_reward')::int));
  assinatura := nullif(npc->>'signatureId', '')::bigint;

  select dados into cfg from public.conteudo where chave = 'npc-drops';
  doNpc := cfg -> d.npc;

  if d.deck_npc is not null
     and coalesce(doNpc -> 'decks', '{}'::jsonb) ? d.deck_npc then
    escolhidoCfg := doNpc -> 'decks' -> d.deck_npc;
  else
    escolhidoCfg := doNpc;
  end if;

  pool := escolhidoCfg -> 'pool';
  qtd := least(greatest(coalesce((escolhidoCfg ->> 'quantidade')::int, 0), 0), 20);

  if jsonb_typeof(pool) = 'array' then
    pool := jsonb_build_object('N', pool);
  end if;

  select array_agg(k order by k) into baldes
    from jsonb_object_keys(coalesce(pool, '{}'::jsonb)) k
   where pesos ? k and jsonb_array_length(pool -> k) > 0;

  w := public.carteira_minha();
  col := coalesce(w->'collection', '{}'::jsonb);

  if baldes is not null and array_length(baldes, 1) > 0 and qtd > 0 then
    select sum((pesos->>k)::int) into total from unnest(baldes) k;
    for i in 1..qtd loop
      sorteio := random() * total;
      escolhido := baldes[array_length(baldes, 1)];
      foreach r in array baldes loop
        sorteio := sorteio - (pesos->>r)::int;
        if sorteio <= 0 then escolhido := r; exit; end if;
      end loop;
      lista := pool -> escolhido;
      escolhida := nullif(lista ->> floor(random() * jsonb_array_length(lista))::int, '')::bigint;
      if escolhida is not null then
        nova := coalesce((col->>escolhida::text)::int, 0) = 0;
        col := jsonb_set(col, array[escolhida::text],
                         to_jsonb(coalesce((col->>escolhida::text)::int, 0) + 1), true);
        sorteadas := sorteadas || to_jsonb(escolhida);
        drops := drops || jsonb_build_object('id', escolhida,
                                             'raridade', escolhido,
                                             'nova', nova);
      end if;
    end loop;
  elsif assinatura is not null then
    nova := coalesce((col->>assinatura::text)::int, 0) = 0;
    select dados into boosters from public.conteudo where chave = 'boosters';
    col := jsonb_set(col, array[assinatura::text],
                     to_jsonb(coalesce((col->>assinatura::text)::int, 0) + 1), true);
    sorteadas := jsonb_build_array(assinatura);
    drops := jsonb_build_array(
               jsonb_build_object('id', assinatura,
                                  'raridade', public.raridade_da_carta(boosters, assinatura::text),
                                  'nova', nova));
  end if;

  chanceIcone := least(greatest(coalesce((escolhidoCfg ->> 'chanceIcone')::int, 0), 0), 100);

  if chanceIcone > 0 then
    select array_agg(x.id order by x.id) into faltando
      from jsonb_array_elements_text(coalesce(escolhidoCfg -> 'icones', '[]'::jsonb)) as t(id)
      join public.icones x on x.id = t.id
     where not x.gratuito
       and not exists (select 1 from public.icones_do_jogador j
                        where j.icone_id = x.id and j.usuario_id = uid);

    if faltando is not null and array_length(faltando, 1) > 0
       and random() * 100 < chanceIcone then
      icone_id := faltando[1 + floor(random() * array_length(faltando, 1))::int];

      insert into public.icones_do_jogador (usuario_id, icone_id)
      values (uid, icone_id) on conflict do nothing;

      select jsonb_build_object('id', x.id, 'nome', x.nome,
                                'imagem', x.imagem, 'raridade', x.raridade)
        into icone
        from public.icones x where x.id = icone_id;
    end if;
  end if;

  w := w || jsonb_build_object('dp', (w->>'dp')::int + premio)
         || jsonb_build_object('collection', col);

  update public.carteiras set dados = w where usuario_id = uid;
  update public.duelos set premiado_em = now() where id = p_duelo;

  return jsonb_build_object('premio', premio,
                            'carta', sorteadas->0,
                            'cartas', sorteadas,
                            'drops', drops,
                            'icone', icone,
                            'carteira', w);
end;
$$;

grant execute on function public.premiar_vitoria(uuid) to authenticated;
