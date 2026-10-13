# 🎫 Bot de Tickets pro Discord — 24h grátis e seguro

Bot em Node.js + discord.js v14 com painel, botões Fechar/Reabrir/Deletar/Assumir/Transcript, pronto pro Render/Railway.

## 1️⃣ Criar o bot (pegar o TOKEN)

1. Acesse https://discord.com/developers/applications > **New Application** > dê um nome > Create
2. No menu lateral: **Bot** > **Reset Token** > copie o token (é a senha! Nunca mostre pra ninguém)
3. Ainda em **Bot**, ative:
   - `SERVER MEMBERS INTENT` ✅ (pra pegar cargos)
   - `MESSAGE CONTENT INTENT` ✅ (pro transcript)
4. Em **OAuth2 > URL Generator**, marque:
   - Scopes: `bot` + `applications.commands`
   - Permissões: `Manage Channels`, `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Manage Roles` (ou Administrator pra simplificar)
   - Abra a URL gerada e adicione no seu servidor
5. Pegue os IDs (Ative Modo Desenvolvedor no Discord: Config > Avançado):
   - Botão direito no servidor > Copiar ID = `GUILD_ID`
   - Botão direito no seu app (Developer Portal > General Information > Application ID) = `CLIENT_ID`
   - Botão direito no cargo da equipe > Copiar ID = `STAFF_ROLE_ID`
   - (Opcional) botão direito na categoria > Copiar ID = `TICKET_CATEGORY_ID`
   - (Opcional) botão direito no canal de logs = `LOG_CHANNEL_ID`

## 2️⃣ Rodar local / testar

```bash
cd dc-ticket-bot
cp .env.example .env
# edite o .env com seus IDs/token
npm install
npm run deploy   # registra os /comandos UMA vez
npm start
```

Se aparecer `✅ Logado como SeuBot#1234`, use `/painel-ticket` no servidor.

## 3️⃣ Hospedar 24h GRÁTIS e seguro (Render)

Por que seguro? O token fica em **Environment Variables** no painel do Render, nunca no código. Nem se alguém ver seu GitHub pega seu token.

1. Suba essa pasta pro GitHub (sem o `.env`! O `.gitignore` já bloqueia)
2. Crie conta em https://render.com (login com GitHub)
3. **New + > Web Service >** selecione seu repositório
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: **Free**
4. Em **Environment**, adicione as variáveis do `.env.example`:
   `TOKEN`, `CLIENT_ID`, `GUILD_ID`, `STAFF_ROLE_ID`, etc.
5. **Deploy**. O bot fica online. A URL `https://seu-bot.onrender.com` deve mostrar `✅ Bot online`.
6. Anti-sleep grátis: Render free dorme após 15min sem acesso. Crie conta grátis em https://uptimerobot.com > Add Monitor > HTTP(s) > URL do seu Render > a cada 5 min. Isso pinga e mantém 24h.

> Alternativa: Railway.app (mesmo processo, não dorme tanto mas tem limite de horas grátis). VPS pago (Hostinger ~R$15/mês) é o único 100% 24h sem gambiarra.

## 4️⃣ Comandos

- `/painel-ticket` (equipe) — posta o painel com menu
- `/fechar` — pede confirmação e fecha
- `/assumir` — marca quem está atendendo
- `/adicionar @user` / `/remover @user`
- `/renomear nome`
- `/transcript` — baixa .txt do histórico
- `/ajuda`
- `/stats` — tickets abertos/fechados, uptime e ping

Fluxo dos botões no ticket: `Fechar 🔒` > confirma > vira `fechado-xxx` > `Reabrir 🔓` / `Transcript 📝` / `Deletar 🗑️ (5s)`.

## 4.5️⃣ Auto-cargo + Boas-vindas + Logs bonitões (NOVO)

No `.env` preencha:
- `AUTO_ROLE_ID=` ID do cargo que todo mundo ganha ao entrar (ex: Membro). Deixe vazio pra desativar.
- `WELCOME_CHANNEL_ID=` ID do canal #bem-vindo. Deixe vazio pra desativar.
- `WELCOME_MESSAGE=` use `{user}` e `{server}`. Ex: `Olá {user}, bem-vindo ao **{server}**!`
- `LOG_CHANNEL_ID=` logs de 📩 criou, 🔒 fechou, 🗑️ deletou, 📥 entrou, 📤 saiu — com avatar, hora e quem fez.

⚠️ Importante: no Discord, arraste o cargo do BOT pra cima do cargo AUTO_ROLE, senão dá erro de permissão. E ative `SERVER MEMBERS INTENT` no Developer Portal.

## 5️⃣ Segurança — LEIA

- ❌ NUNCA cole seu TOKEN no chat, no código ou no GitHub
- ✅ TOKEN só no `.env` local e nas Environment Variables do Render
- Se vazar: Developer Portal > Bot > Reset Token > atualize no Render > Redeploy
- Dê ao bot cargo acima do cargo Staff na hierarquia do servidor, senão ele não cria canal.

## Dúvidas comuns

**Comandos não aparecem?** Rode `npm run deploy` e espere 2 min. Veja se bot tem scope `applications.commands`.
**Não cria canal?** Falta permissão Gerenciar Canais / categoria errada.
**Bot offline no Render?** Veja Logs no painel. 99% é TOKEN errado ou variável faltando.
