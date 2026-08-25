-- 0046 — a UR garantida passa a contar PACOTES, nao DP gasto. E a SR volta a 10.
--
-- Pedido: "SR 10 pacotes, UR 20 pacotes".
--
-- POR QUE O DP SAIU. `ur_pity_dp = 10000` era um alvo movel: com o pacote a 100
-- DP eram 100 pacotes, e o balanceamento de precos que vem ai (pacote bom mais
-- caro, ruim mais barato) mudaria a promessa sem ninguem tocar nela. Pior: era
-- ilegivel na tela — "faltam 7600 DP" nao responde a pergunta que o jogador faz,
-- que e' *quantos pacotes ainda*.
--
-- POR BOOSTER, e nao global como o DP era. Um contador global de PACOTES e'
-- exploravel: abre-se 19 pacotes do booster mais barato e o 20o no mais caro,
-- levando a UR dele de graca. Com o DP isso nao existia (o barato somava menos),
-- entao trocar a unidade sem trocar o escopo abriria a brecha.
--
-- ELE ZERA QUANDO UMA UR SAI, natural ou garantida, e e' isso que faz dele um
-- PISO ("voce nunca passa 20 pacotes sem UR") e nao um bonus: um contador que so'
-- somasse entregaria a garantida no 20o MESMO tendo saido uma natural no 19o.
--
--   taxa natural: 10,07% por pacote (~1 a cada 9,9)
--   com o piso:   nunca mais de 30 — ele dispara em ~4% dos casos
--
-- AS DUAS GARANTIAS CABEM NO MESMO PACOTE. Com SR a cada 10 e UR a cada 20, todo
-- multiplo de 20 dispara as duas. Antes as duas miravam a carta 1 e a UR vencia o
-- `elsif` — a SR garantida sumia calada, e o jogador perdia uma garantia sem
-- nunca saber que ela existiu. Agora a UR fica na carta 1 e a SR anda para a 2.
--
-- O QUE ZERA o contador e' a raridade que REALMENTE saiu, depois da cascata:
-- pedir UR num booster sem UR entrega outra coisa, e zerar ali prometeria uma UR
-- que nunca veio.
--
-- MIGRACAO SUAVE: quem nao tem `urPity` na carteira comeca do zero. Herdar algo
-- do `urSpend` antigo seria converter DP em pacotes por um preco que pode ter
-- mudado — um numero inventado. Zero e' a resposta honesta, e o pior que faz e'
-- adiar uma garantia.
--
-- OS MESMOS NUMEROS vivem em `web/js/boosters.js` (`PITY_EVERY`,
-- `UR_PITY_PACKS`, `PACK_SIZE`) e `web/js/pacote.js` (`PACK_ODDS`), que e' o que
-- a Loja PROMETE na tela. Divergir faz a barra mentir e nada acusa —
-- `node web/js/economia.test.mjs` compara os dois lados.
--

create or replace function public.eco_const()
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'start_dp',       500,
    'win_reward',     100,
    'pack_size',      5,
    'pity_every',     10,   -- pacotes do MESMO booster ate' a SR garantida
    'ur_pity_packs',  30,   -- pacotes do MESMO booster SEM UR ate' a UR garantida
    -- O alvo e' POR PACOTE: UR 10%, SR 34%. O peso e' por CARTA, entao ele sai
    -- da conta inversa — 1-(1-p)^5 = alvo. UR: p = 1 - 0,90^(1/5) = 2,1% -> 21.
    -- SR fica nos 80 (8,0%/carta = 34,09%/pacote).
    --
    -- Com estes numeros o piso de 30 pacotes dispara em ~4% dos casos: ele e' a
    -- rede de quem tem azar de verdade, nao o caminho normal. O numero certo
    -- depende da TAXA — com a UR a 22,6%/pacote um piso de 20 caia para 0,59% e
    -- virava decoracao. Ao mexer numa das duas, olhe a outra.
    'odds',           jsonb_build_object('N', 662, 'R', 237, 'SR', 80, 'UR', 21),
    'sell',           jsonb_build_object('N', 5, 'R', 10, 'SR', 20, 'UR', 100)
  );
$$;

-- ------------------------------------------------------------ o sorteio
--
-- Este e' o corpo VIVO, tal como esta' no banco. Ele fica aqui inteiro porque a
-- migration e' o registro do que foi aplicado: um arquivo que so' diz "veja no
-- banco" nao deixa ninguem revisar a regra, e um que mostra uma versao
-- diferente e' pior ainda.

create or replace function public.abrir_pacote(p_booster text, p_qtd int default 1)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  k jsonb := public.eco_const();
  w jsonb; boosters jsonb; b jsonb;
  preco int; dp int; pity int; ur_pity int;
  garante_sr boolean; garante_ur boolean; tem_ur boolean;
  col jsonb; saiu jsonb := '[]'::jsonb;
  i int; q int; r int; rar text; pool jsonb; carta bigint;
  qtd int; garantida boolean; saiu_ur boolean; slot_sr int;
begin
  if uid is null then raise exception 'nao autenticado'; end if;

  qtd := least(greatest(coalesce(p_qtd, 1), 1), 10);

  select dados into boosters from public.conteudo where chave = 'boosters';
  if boosters is null then raise exception 'nenhum booster publicado'; end if;

  if jsonb_typeof(boosters) = 'object' then
    b := boosters -> p_booster;
  else
    select value into b from jsonb_array_elements(boosters)
      where value->>'name' = p_booster limit 1;
  end if;
  if b is null then raise exception 'booster % nao existe', p_booster; end if;

  preco := coalesce((b->>'price')::int, 100);
  w := public.carteira_minha();
  dp := (w->>'dp')::int;
  -- O preco do LOTE INTEIRO antes de abrir qualquer um: abrir sete e parar por
  -- falta de DP no oitavo entregaria um lote pela metade.
  if dp < preco * qtd then raise exception 'DP insuficiente'; end if;

  tem_ur   := jsonb_array_length(coalesce(b->'cards'->'UR', '[]'::jsonb)) > 0;
  pity     := coalesce((w->'pity'->>p_booster)::int, 0);
  -- MIGRACAO SUAVE: quem nunca abriu depois desta mudanca nao tem `urPity` e
  -- comeca do zero. Herdar algo do `urSpend` antigo seria converter DP em
  -- pacotes por um preco que pode ter mudado — um numero inventado.
  ur_pity  := coalesce((w->'urPity'->>p_booster)::int, 0);
  col      := coalesce(w->'collection', '{}'::jsonb);

  for q in 1..qtd loop
    pity    := pity + 1;
    ur_pity := ur_pity + 1;

    garante_ur := tem_ur and ur_pity >= (k->>'ur_pity_packs')::int;
    garante_sr := (pity % (k->>'pity_every')::int) = 0;

    -- A UR fica na carta 1; a SR anda para a 2 quando as duas disparam no mesmo
    -- pacote. Sem isto a SR garantida sumia calada no multiplo das duas.
    slot_sr := case when garante_ur then 2 else 1 end;
    saiu_ur := false;

    for i in 1..(k->>'pack_size')::int loop
      garantida := false;
      if i = 1 and garante_ur then rar := 'UR'; garantida := true;
      elsif i = slot_sr and garante_sr then rar := 'SR'; garantida := true;
      else
        r := floor(random() * 1000)::int;
        rar := case
          when r < (k->'odds'->>'UR')::int then 'UR'
          when r < (k->'odds'->>'UR')::int + (k->'odds'->>'SR')::int then 'SR'
          when r < (k->'odds'->>'UR')::int + (k->'odds'->>'SR')::int
                 + (k->'odds'->>'R')::int then 'R'
          else 'N' end;
      end if;

      foreach rar in array (case rar
          when 'UR' then array['UR','SR','R','N']
          when 'SR' then array['SR','R','N','UR']
          when 'R'  then array['R','N','SR','UR']
          else array['N','R','SR','UR'] end)
      loop
        pool := coalesce(b->'cards'->rar, '[]'::jsonb);
        exit when jsonb_array_length(pool) > 0;
      end loop;
      if jsonb_array_length(pool) = 0 then raise exception 'booster % esta vazio', p_booster; end if;

      -- O que ZERA o contador e' a raridade que REALMENTE saiu, depois da
      -- cascata: pedir UR num booster sem UR entrega outra coisa, e zerar ali
      -- prometeria uma UR que nunca veio.
      if rar = 'UR' then saiu_ur := true; end if;

      carta := (pool -> floor(random() * jsonb_array_length(pool))::int)::text::bigint;
      saiu := saiu || jsonb_build_object('id', carta, 'rarity', rar,
                                         'pacote', q, 'guaranteed', garantida);
      col  := jsonb_set(col, array[carta::text],
                        to_jsonb(coalesce((col->>carta::text)::int, 0) + 1), true);
    end loop;

    -- Natural ou garantida, tanto faz: saiu UR, o piso recomeca.
    if saiu_ur then ur_pity := 0; end if;
  end loop;

  w := w
       || jsonb_build_object('dp', dp - preco * qtd)
       || jsonb_build_object('collection', col)
       || jsonb_build_object('pity', jsonb_set(coalesce(w->'pity','{}'::jsonb),
                                               array[p_booster], to_jsonb(pity), true))
       || jsonb_build_object('urPity', jsonb_set(coalesce(w->'urPity','{}'::jsonb),
                                                 array[p_booster], to_jsonb(ur_pity), true));

  update public.carteiras set dados = w where usuario_id = uid;
  return jsonb_build_object('cartas', saiu, 'carteira', w, 'pacotes', qtd);
end;
$function$;

grant execute on function public.abrir_pacote(text, int) to authenticated;
