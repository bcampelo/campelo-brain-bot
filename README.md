# Campelo Brain Bot

Bot de WhatsApp que lê o que você manda e registra tudo no Notion, no [template do Campelo Brain](https://telling-balmoral-a42.notion.site/Campelo-Brain-41053de21280818fb826f8a095aec7f0). Você escreve "estatística: prova segunda" e a prova aparece na database de avaliações, com a data certa.

Ele conecta no WhatsApp sem a API oficial (Baileys) e usa o Gemini (grátis) ou o Claude para entender a mensagem. Roda em Docker, em qualquer máquina com Linux. Funciona bem numa placa pequena em casa e também numa VPS.

```
você no WhatsApp ──► Baileys ──► IA (entende e escolhe a ação) ──► API do Notion
                         ◄────────────── resposta curta confirmando ◄──┘
```

## O que ele faz

| Você manda | O que acontece no Notion |
|---|---|
| `estatística: prova segunda sobre regressão` | Avaliação na matéria, com a data da próxima segunda |
| `trabalho de SO dia 20, vale 3` | Avaliação tipo Trabalho com peso 3 |
| `tirei 8,5 na prova 1 de ED` | Nota lançada e avaliação marcada como Feita (+50 XP) |
| `tarefa: mandar orçamento amanhã, alta` | Tarefa com prazo e prioridade |
| `terminei o orçamento` | Tarefa marcada como Feito |
| `anota aula de LP2: polimorfismo é...` | Nota tipo Aula ligada à matéria, com o texto no corpo |
| `ideia pro app: atalho global` | Nota tipo Ideia ligada ao projeto |
| `fui na academia, treino B` | Diário de hoje com Treino B e Atividade física |
| `li 15 páginas` | Soma páginas no Diário e liga ao livro que está Lendo |
| `pesei 74,3` | Peso do dia |
| `gastei 32 no ifood` / `recebi 800 de cliente` | Lançamento em Finanças |
| `toda segunda pagar a academia` | Tarefa recorrente. Ao concluir, o bot cria a próxima |
| `o que anotei de SO sobre escalonamento?` | Pesquisa nas notas e responde com resumo e link |
| `cortar o cabelo amanhã às 15h` | Tarefa com horário, aviso antes e arquivo para o Calendário |
| `o que tenho essa semana?` | Provas, tarefas (com atrasadas) e hábitos que faltam |
| `meu status` | Nível, XP total, saldo e XP de hoje |
| um áudio, uma foto de recibo ou uma mensagem encaminhada | Transcreve, lê e registra |

Uma mensagem pode ter várias coisas. "Treinei, li 10 páginas e gastei 15 no almoço" vira três registros.

Extras automáticos
- **Acordar cedo.** Se a primeira mensagem do dia chegar antes do horário limite, marca o hábito sozinho.
- **Bom dia com contexto.** Manda provas e trabalhos dos próximos 7 dias, tarefas de hoje e atrasadas, hábitos que ficaram sem marcar, sequências de dias seguidos e o clima (se você informar a localização).
- **Fechamento do dia.** Pergunta como foi o dia, e a sua resposta vai para o Diário.
- **Pergunta na dúvida.** Data no passado, matéria ambígua ou gasto sem valor. O bot não grava, pergunta com opções numeradas e você responde "2".
- **Lembretes.** Avisa antes de tarefas e provas com horário. Você pode responder `+15`, `+1h` ou `amanhã` para adiar.

Comandos: `/ajuda`, `/desfazer` (`/desfazer 3` desfaz as 3 últimas), `/diario <texto>`, `/id` (mostra o ID do chat) e `/reset` (limpa o contexto e recarrega as matérias).

## Antes de começar

Você precisa de
- **Uma máquina ligada o tempo todo** com Linux e Docker. Pode ser uma placa tipo Raspberry Pi ou Arduino com Linux, uma VPS ou um PC velho. Sem Docker, serve Node 22.
- **Um número de WhatsApp para o bot.** Recomendo um chip só para ele. A conexão é não oficial e viola os termos do WhatsApp, então existe risco de banimento. Com chip separado você perde só o do bot.
- **Uma conta no Notion** (o plano grátis serve).
- **Uma chave de IA.** Para começar de graça, use o Gemini em aistudio.google.com/apikey. Na camada gratuita o Google pode usar o conteúdo das mensagens para treinar modelos. Para usar o Claude, é só trocar a chave no `.env`.

## Instalação

**1. Duplique o template.** Abra o [template do Campelo Brain](https://telling-balmoral-a42.notion.site/Campelo-Brain-41053de21280818fb826f8a095aec7f0) e clique em Duplicar para o seu workspace. Não renomeie as databases nem as propriedades, o bot procura por esses nomes.

**2. Crie a integração do Notion.** Em notion.so/profile/integrations crie uma integração interna e copie o token. Depois abra a página Campelo Brain, clique em `...` > Conexões e adicione a integração. Isso libera todas as databases de dentro dela.

**3. Baixe o código.** Copie a URL do repositório no botão Code do GitHub e rode
```bash
git clone <url do repositório>
cd <pasta do repositório>
cp .env.example .env
```

**4. Preencha o `.env`.** Abra o arquivo e coloque
- `NOTION_TOKEN`, o token do passo 2
- `GEMINI_API_KEY` (ou `ANTHROPIC_API_KEY` e `PROVIDER=claude`)
- `OWNER_NUMBERS`, o seu número com DDI e DDD, só dígitos (ex: `5511999999999`)
- `TZ_NAME`, o seu fuso (ex: `America/Sao_Paulo`)

**5. Descubra os IDs das databases.** O link de uma database do Notion não serve, o ID dele é outro. Deixe o bot achar sozinho
```bash
docker compose run --rm brain-bot node src/descobrir-ids.js
```
Sem Docker, use `npm install` e depois `npm run ids`. Ele imprime as linhas `NOTION_DS_...` e `NOTION_PERFIL_ID`. Cole no `.env`. Se ele reclamar de algo, a mensagem diz o que fazer.

**6. Suba o bot.**
```bash
docker compose up -d --build
docker compose logs -f
```

**7. Conecte o WhatsApp.** Nos logs aparece um QR. No celular do número do bot, vá em WhatsApp > Dispositivos conectados > Conectar dispositivo e escaneie. Se preferir sem QR, coloque o número do bot em `PAIRING_NUMBER`, reinicie e use o código de 8 letras em "Conectar com número de telefone".

A sessão fica salva em `./auth`. Depois de vincular uma vez, o bot reconecta sozinho, inclusive depois de reiniciar a máquina.

**8. Teste.** Mande `/ajuda` e depois `tarefa: testar o bot, amanhã`. A tarefa tem que aparecer no Notion.

## Onde conversar com o bot

**Modo A, chip separado (recomendado).** Coloque o seu número em `OWNER_NUMBERS` e mande mensagem direto para o número do bot. Se quiser um grupo, crie um com você e o bot, mande `/id` lá dentro e coloque o ID em `ALLOWED_CHATS`.

**Modo B, seu próprio número.** Vincule o seu WhatsApp e use `ALLOW_FROM_ME=true`. O bot lê o que você escreve em "Mensagem para você mesmo" ou num grupo só seu liberado em `ALLOWED_CHATS`. O risco de banimento cai na sua conta principal.

Ninguém fora dessas regras recebe resposta.

## Rodando em uma VPS

Funciona igual. O bot só faz conexões de saída, então não precisa abrir porta nenhuma. Alguns cuidados
- Instale Docker e Docker Compose, e siga a instalação acima.
- Mantenha a pasta `auth` no disco. Ela guarda a sessão do WhatsApp, e sem ela o bot pede QR de novo.
- O WhatsApp às vezes desconfia mais de IP de datacenter. Costuma funcionar, mas use um número secundário.
- Uma VPS com 512 MB a 1 GB de RAM é suficiente.

## Atualizar sozinho

O script `deploy/auto-update.sh` compara a versão local com a do GitHub e, se houver commit novo, baixa e reconstrói o container. Se o build falhar, o bot antigo continua no ar. Coloque no cron para rodar a cada 5 minutos
```
*/5 * * * * cd /caminho/da/pasta && ./deploy/auto-update.sh >> deploy/update.log 2>&1
```
Ele faz `git reset --hard`, então não use se você mexeu no código nessa máquina. Se não quiser atualização automática, atualize na mão com `git pull && docker compose up -d --build`.

## Variáveis do `.env`

Todas estão comentadas no `.env.example`. As principais

| Variável | Para que serve |
|---|---|
| `NOTION_TOKEN` | Token da integração do Notion |
| `NOTION_DS_*` e `NOTION_PERFIL_ID` | IDs das databases e da sua página no Perfil (`npm run ids` acha) |
| `PROVIDER` | `gemini` ou `claude` |
| `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | Chave da IA escolhida |
| `OWNER_NUMBERS` | Quem pode mandar comandos |
| `ALLOWED_CHATS`, `ALLOW_FROM_ME` | Grupos liberados e modo no seu próprio número |
| `TZ_NAME` | Fuso horário (afeta datas e lembretes) |
| `AREAS`, `AREA_TRABALHO` | Opções do campo Área e qual delas é a do trabalho |
| `ALIAS_MATERIAS` | Apelidos de matérias em JSON, ex: `{"so":"Sistemas Operacionais"}` |
| `RESUMO_DIARIO`, `FECHAMENTO_HORA` | Horários do bom dia e do fechamento. Vazio desliga |
| `LEMBRETE_MIN` | Minutos de aviso antes de tarefas com horário |
| `CLIMA_LAT`, `CLIMA_LON` | Localização para o clima do bom dia. Sem elas, vai sem clima |

## Use o Claude para montar o seu

Se você não quer seguir tudo sozinho, deixe o Claude guiar. No Claude Code, abra a pasta do projeto e cole o prompt abaixo. No chat do Claude, anexe `README.md`, `.env.example`, `Dockerfile`, `docker-compose.yml` e a pasta `src`, e cole o prompt. No chat ele não roda comandos, mas explica cada passo.

~~~
Você vai me ajudar a montar e colocar para rodar o brain-bot, um bot de WhatsApp que registra tudo no Notion (template Campelo Brain). O código está nesta pasta.

Primeiro, entenda o projeto. Leia README.md, package.json, .env.example, Dockerfile, docker-compose.yml, deploy/auto-update.sh e os arquivos de src/ (config.js, notion.js, tools.js, agent.js, whatsapp.js e index.js). Depois me explique em até 10 linhas, com as suas palavras, como a mensagem viaja do WhatsApp até o Notion. Assim eu vejo que você entendeu.

Depois me ajude a montar, um passo por vez. Antes de começar, me pergunte
1. onde vou rodar o bot (placa com Linux, Raspberry Pi, VPS ou meu computador)
2. qual IA vou usar (Gemini grátis ou Claude pago)
3. qual número de WhatsApp o bot vai usar (de preferência um chip só para ele)
4. se eu já dupliquei o template do Notion

Com as respostas, monte a lista do que eu preciso ter e fazer. Cubra pelo menos
- Notion: duplicar o template, criar a integração interna e conectar a integração na página Campelo Brain
- chaves: NOTION_TOKEN e GEMINI_API_KEY (ou ANTHROPIC_API_KEY)
- Docker e Docker Compose instalados na máquina (ou Node 22, se eu não for usar Docker)
- o .env criado a partir do .env.example
- rodar npm run ids para descobrir os IDs das databases e colar no .env
- subir o bot, escanear o QR e testar uma mensagem
- opcional, atualização automática com deploy/auto-update.sh

Regras
- Siga a lista passo a passo e só avance quando eu disser que o passo deu certo.
- Eu mesmo edito o .env. Nunca peça para eu colar tokens, chaves ou o conteúdo do .env na conversa.
- Explique o que cada comando faz antes de eu rodar. Se algo falhar, peça só o trecho do log sem chaves e procure a causa no código antes de sugerir mudança.
- Não altere arquivos do projeto sem eu pedir. Se achar que algo precisa mudar, diga o motivo e peça confirmação.
- Avise que o bot usa uma conexão não oficial do WhatsApp, que pode levar ao banimento do número, e que por isso é melhor usar um chip separado.
- Responda em português, curto e direto.
~~~

## Problemas comuns

- **"Faltam variáveis no .env".** O bot lista o que falta. Para os IDs do Notion, rode o passo 5.
- **"Notion 404" ou "object_not_found".** A integração não foi adicionada na página Campelo Brain.
- **Matéria não encontrada.** O bot só enxerga matérias com Status Cursando. Depois de mudar algo no Notion, mande `/reset`.
- **Bot não responde.** Mande `/id` e veja nos logs o número ou ID que chegou. Em contas novas o WhatsApp manda um ID terminado em `@lid` em vez do número. Nesse caso coloque esse ID em `ALLOWED_CHATS`.
- **Lembretes em horário errado.** Confira o `TZ_NAME` no `.env`.
- **Desconectou de vez.** Apague a pasta `auth` e vincule de novo.

## Estrutura

```
src/
  index.js          fila por chat, comandos, bom dia, fechamento
  whatsapp.js       conexão Baileys, QR ou código, filtro de quem pode falar
  agent.js          loop de function calling (Gemini ou Claude), transcrição de áudio
  tools.js          ações no Notion (avaliação, tarefa, nota, hábitos, leitura, treino, peso, finanças, agenda, diário)
  generic.js        ferramentas genéricas (criar, editar, buscar, ler e apagar item) e pesquisa
  notion.js         cliente da API do Notion (versão 2025-09-03, data sources)
  config.js         variáveis do .env
  descobrir-ids.js  acha os IDs das databases (npm run ids)
  briefing.js       dados do bom dia (clima, agenda, sequências)
  recorrentes.js    tarefas que se repetem
  lembretes.js      aviso antes de tarefas e arquivo .ics
  comandos.js       /desfazer, /diario e adiar aviso, sem passar pela IA
deploy/
  auto-update.sh    atualização automática por cron
test/
  offline.test.js   testes sem rede, com Notion e IA simulados (npm test)
```

Os testes não usam dados reais. O `test/setup.js` define valores falsos.
