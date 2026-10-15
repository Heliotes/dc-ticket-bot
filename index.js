// Bot de Tickets / Suporte - discord.js v14
// Feito pra ficar 24h no Render/Railway de graça + seguro (token só no .env)
require('dotenv').config();

// Blindagem: nada derruba o processo — loga e continua online
process.on('unhandledRejection', (e) => console.error('⚠️ Rejeição não tratada (bot continua):', e && e.message ? e.message : e));
process.on('uncaughtException', (e) => console.error('⚠️ Exceção não tratada (bot continua):', e && e.message ? e.message : e));

const express = require('express');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

// ---------- 1. Validação segura das variáveis ----------
const TOKEN = process.env.TOKEN;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const EMBED_COLOR = process.env.EMBED_COLOR || '#5865F2';
const AUTO_ROLE_ID = process.env.AUTO_ROLE_ID || null;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || null;
const WELCOME_MESSAGE = process.env.WELCOME_MESSAGE || 'Olá {user}, bem-vindo(a) ao **{server}**! 🎉';
const INACTIVE_HOURS = parseFloat(process.env.INACTIVE_HOURS || '24'); // 0 = desativa auto-close
const ANTILINK = (process.env.ANTILINK || 'true').toLowerCase() === 'true';
const BADWORDS = (process.env.BADWORDS || 'fdp,vsf,otario,otário,idiota,lixo').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);

if (!TOKEN || TOKEN === 'seu_token_aqui') {
  console.error('❌ Faltou o TOKEN no arquivo .env! Veja o .env.example e o README.');
  process.exit(1);
}

// ---------- 2. Keep-alive pro Render (health check) ----------
// O Render derruba serviço sem porta aberta. Isso mantém online + UptimeRobot pode pingar.
const app = express();
app.get('/', (req, res) => res.send('✅ Bot de tickets online!'));
app.get('/health', (req, res) => res.json({ status: 'online', uptime: process.uptime() }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Keep-alive rodando na porta ${PORT}`));

// ---------- 3. Client ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.GuildMember],
});

// Tipos de ticket que aparecem no painel
const TICKET_TYPES = {
  suporte: { label: '🛠️ Suporte Geral', desc: 'Ajuda, dúvidas e problemas', emoji: '🛠️' },
  denuncia: { label: '🚨 Denúncia', desc: 'Denunciar jogador ou staff', emoji: '🚨' },
  parceria: { label: '🤝 Parceria', desc: 'Propostas de parceria/divulgação', emoji: '🤝' },
  bug: { label: '🐛 Bug / Erro', desc: 'Reportar bug do servidor', emoji: '🐛' },
};

function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  if (STAFF_ROLE_ID && member.roles.cache.has(STAFF_ROLE_ID)) return true;
  return false;
}

// NOVO: só ADMIN pode fechar/reabrir/deletar ticket
function isAdmin(member) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator);
}
const ADMIN_ONLY_MSG = '❌ Só **ADMIN** pode fazer isso (fechar/reabrir/deletar/assumir).';

function isTicketChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildText) return false;
  if (channel.name.startsWith('ticket-') || channel.name.startsWith('fechado-')) return true;
  if (channel.topic && channel.topic.includes('TICKET:')) return true;
  return false;
}

function getTicketOwnerId(channel) {
  const t = parseTicketTopic(channel);
  return t.owner;
}

// Lê o tópico do ticket: { owner, tipo, criado, motivo, prioridade, fechadoPor, assumidoPor }
function parseTicketTopic(channel) {
  const out = {};
  const topic = (channel && channel.topic) || '';
  const get = (key) => {
    const m = topic.match(new RegExp(`${key}:([^|]+)`));
    return m ? m[1].trim() : null;
  };
  out.owner = get('TICKET');
  out.tipo = get('Tipo');
  out.criado = get('Criado');
  out.motivo = get('Motivo');
  out.prioridade = get('Prioridade');
  const f = topic.match(/FechadoPor:(\d+)/);
  out.fechadoPor = f ? f[1] : null;
  return out;
}

const PRIORIDADES = {
  baixa: { label: '🟢 Baixa', sufixo: 'baixa' },
  media: { label: '🟡 Média', sufixo: 'media' },
  alta: { label: '🟠 Alta', sufixo: 'alta' },
  urgente: { label: '🔴 Urgente', sufixo: 'urgente' },
};

function semSufixoPrioridade(nome) {
  return nome.replace(/-(baixa|media|alta|urgente)$/, '');
}

async function sendLog(guild, embed) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (ch && ch.isTextBased()) await ch.send({ embeds: [embed] }).catch(() => null);
  } catch {}
}

function logEmbed(color, title, desc, user, fields = []) {
  const e = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp().setFooter({ text: 'Bot Tickets • Log' });
  if (user) e.setThumbnail(user.displayAvatarURL()).addFields({ name: 'Usuário', value: `${user} (\`${user.id}\`)`, inline: false });
  if (fields.length) e.addFields(fields);
  return e;
}

// ---------- 4. Criar ticket ----------
async function createTicket(interaction, typeKey, motivo = 'Não informado') {
  const type = TICKET_TYPES[typeKey] || TICKET_TYPES.suporte;
  const guild = interaction.guild;
  const user = interaction.user;

  // Evita spam: 1 ticket aberto por pessoa (por tipo)
  const existing = guild.channels.cache.find(
    (c) => c.topic && c.topic.includes(`TICKET:${user.id}`) && !c.name.startsWith('fechado-')
  );
  if (existing) {
    return interaction.reply({
      content: `⚠️ Você já tem um ticket aberto: ${existing}`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
    },
    {
      id: client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory],
    },
  ];
  if (STAFF_ROLE_ID) {
    overwrites.push({
      id: STAFF_ROLE_ID,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const channelName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}-${Math.floor(Math.random() * 9000 + 1000)}`;

  const motivoCurto = String(motivo || 'Não informado').slice(0, 200).replace(/\n/g, ' ');
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID || null,
    topic: `TICKET:${user.id} | Tipo:${typeKey} | Criado:${new Date().toISOString()} | Motivo:${motivoCurto}`,
    permissionOverwrites: overwrites,
  }).catch((e) => {
    console.error('Erro ao criar canal:', e);
    return null;
  });

  if (!channel) {
    return interaction.editReply('❌ Não consegui criar o canal. Verifique se o bot tem permissão **Gerenciar Canais** e se a categoria/cargo estão certos no .env');
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${type.emoji} ${type.label} — Ticket de ${user.username}`)
    .setDescription(
      `Olá ${user}, a equipe já foi chamada!\n\n**Tipo:** ${type.label}\n**Motivo:** ${String(motivo || 'Não informado').slice(0, 1000)}\n\nDescreva com mais detalhes se precisar. Aguarde um atendente.`
    )
    .setFooter({ text: 'Use os botões abaixo para gerenciar' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
    new ButtonBuilder().setCustomId('claim_ticket').setLabel('Assumir').setStyle(ButtonStyle.Primary).setEmoji('🙋')
  );

  const staffMention = STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : 'Equipe';
  await channel.send({ content: `${staffMention} | ${user}`, embeds: [embed], components: [row] });

  await interaction.editReply(`✅ Ticket criado: ${channel}`);

  sendLog(guild, logEmbed('Green', '📩 Ticket criado', `**Canal:** ${channel}\n**Tipo:** ${type.label}`, user,
    [{ name: 'Criado em', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }]));
}

// ---------- 5. Transcript ----------
async function buildTranscript(channel) {
  const messages = [];
  let lastId = null;
  // Busca até ~500 msgs (paginado)
  for (let i = 0; i < 5; i++) {
    const opts = { limit: 100 };
    if (lastId) opts.before = lastId;
    const fetched = await channel.messages.fetch(opts).catch(() => null);
    if (!fetched || fetched.size === 0) break;
    const arr = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    messages.unshift(...arr);
    lastId = arr[0].id;
    if (fetched.size < 100) break;
  }
  const lines = messages.map((m) => {
    const date = new Date(m.createdTimestamp).toLocaleString('pt-BR');
    const author = `${m.author.tag} (${m.author.id})`;
    let text = m.content || '';
    // Inclui texto dos embeds (painéis, avisos) no histórico
    for (const e of m.embeds) {
      const parts = [e.title, e.description].filter(Boolean);
      for (const f of (e.fields || [])) parts.push(`${f.name}: ${f.value}`);
      if (parts.length) text += `\n[EMBED] ${parts.join(' | ').slice(0, 1000)}`;
    }
    if (!text.trim()) text = '[sem texto]';
    if (m.attachments.size > 0) text += ` [anexos: ${[...m.attachments.values()].map((a) => a.url).join(', ')}]`;
    return `[${date}] ${author}: ${text}`;
  });
  const header = `TRANSCRIPT — #${channel.name} (${channel.id})\nGerado em ${new Date().toLocaleString('pt-BR')}\nTotal: ${messages.length} mensagens\n${'='.repeat(60)}\n`;
  return header + lines.join('\n');
}

client.on('error', (e) => console.error('⚠️ Client error (bot continua):', e && e.message ? e.message : e));

// ---------- 6. Interações ----------
client.on('interactionCreate', async (interaction) => {
  try {
    // ----- Slash commands -----
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'painel-ticket') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Só a equipe pode criar o painel.', ephemeral: true });
        }
        // Defer primeiro: garante resposta mesmo com lag (evita Unknown interaction)
        await interaction.deferReply().catch(() => null);
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle('🎫 Central de Atendimento')
          .setDescription(
            'Precisa de ajuda? Abra um ticket!\n\n🛠️ **Suporte Geral** — ajuda e dúvidas\n🚨 **Denúncia** — denunciar alguém\n🤝 **Parceria** — propostas\n🐛 **Bug / Erro** — reportar problema\n\n👇 Selecione o tipo abaixo:'
          )
          .setFooter({ text: 'Não abuse. Abrir ticket à toa pode gerar punição.' });

        const menu = new StringSelectMenuBuilder()
          .setCustomId('select_ticket_type')
          .setPlaceholder('Selecione o tipo de ticket...')
          .addOptions(
            Object.entries(TICKET_TYPES).map(([value, t]) => ({
              label: t.label.slice(0, 100),
              description: t.desc.slice(0, 100),
              value,
              emoji: t.emoji,
            }))
          );

        return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => null);
      }

      if (commandName === 'fechar') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um canal de ticket.', ephemeral: true });
        if (!isAdmin(interaction.member)) { await denyAdmin(interaction); return; }
        const motivoF = (interaction.options.getString('motivo') || '').slice(0, 500);
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const ok = await doCloseTicket(interaction, interaction.channel, motivoF);
        return interaction.editReply(ok ? '🔒 Ticket fechado!' : '⚠️ Fechei com falhas, veja o canal.').catch(() => null);
      }

      if (commandName === 'prioridade') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um ticket.', ephemeral: true });
        if (!isAdmin(interaction.member)) { await denyAdmin(interaction); return; }
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const nivel = interaction.options.getString('nivel', true);
        const p = PRIORIDADES[nivel];
        if (!p) return interaction.editReply('❌ Nível inválido.').catch(() => null);
        const ch = interaction.channel;
        const novoNome = `${semSufixoPrioridade(ch.name.replace(/^fechado-/, ''))}-${p.sufixo}`.slice(0, 100);
        await ch.setName(novoNome).catch(() => null);
        const base = (ch.topic || '').replace(/\s*\|\s*Prioridade:[^|]+/g, '');
        await ch.setTopic(`${base} | Prioridade:${nivel}`.slice(0, 1024)).catch(() => null);
        await ch.send(`⚡ Prioridade definida como **${p.label}** por ${interaction.user}`).catch(() => null);
        sendLog(ch.guild, logEmbed('Yellow', '⚡ Prioridade alterada', `**Canal:** ${ch}\n**Nível:** ${p.label}\n**Por:** ${interaction.user}`, interaction.user));
        return interaction.editReply(`⚡ Prioridade: **${p.label}**`).catch(() => null);
      }

      if (commandName === 'tickets') {
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe.', ephemeral: true });
        const abertos = interaction.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText && c.name.startsWith('ticket-'));
        const fechadosN = interaction.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText && c.name.startsWith('fechado-')).size;
        if (abertos.size === 0) return interaction.reply({ content: `📭 Nenhum ticket aberto! (${fechadosN} fechados aguardando)`, ephemeral: true });
        const linhas = [...abertos.values()].slice(0, 20).map((c) => {
          const t = parseTicketTopic(c);
          const dono = t.owner ? `<@${t.owner}>` : '?';
          const tipo = t.tipo || '?';
          const pri = t.prioridade ? ` • ${PRIORIDADES[t.prioridade]?.label || t.prioridade}` : '';
          let idade = '';
          if (t.criado) {
            const ts = Math.floor(new Date(t.criado).getTime() / 1000);
            if (!isNaN(ts)) idade = ` • <t:${ts}:R>`;
          }
          return `${c} — ${dono} • ${tipo}${pri}${idade}`;
        });
        const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`🎫 Tickets abertos (${abertos.size})`)
          .setDescription(linhas.join('\n').slice(0, 4000))
          .setFooter({ text: `${fechadosN} fechados • mostrando até 20` }).setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (commandName === 'adicionar') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um ticket.', ephemeral: true });
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const target = interaction.options.getUser('usuario');
        const r = await interaction.channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch((e) => e);
        if (r instanceof Error) return interaction.editReply('❌ Não consegui adicionar. O cargo do bot precisa estar **acima** dos cargos do servidor.').catch(() => null);
        return interaction.editReply(`✅ ${target} adicionado ao ticket.`).catch(() => null);
      }

      if (commandName === 'remover') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um ticket.', ephemeral: true });
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const target = interaction.options.getUser('usuario');
        const ownerId = getTicketOwnerId(interaction.channel);
        if (target.id === ownerId) return interaction.editReply('❌ Não dá pra remover o dono do ticket.').catch(() => null);
        await interaction.channel.permissionOverwrites.delete(target.id).catch(() => null);
        return interaction.editReply(`✅ ${target} removido do ticket.`).catch(() => null);
      }

      if (commandName === 'renomear') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um ticket.', ephemeral: true });
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const nome = interaction.options.getString('nome', true).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
        if (!nome) return interaction.editReply('❌ Nome inválido. Use letras e números (ex: `suporte-urgente`).').catch(() => null);
        await interaction.channel.setName(nome).catch(() => null);
        return interaction.editReply(`✅ Canal renomeado para \`${nome}\``).catch(() => null);
      }

      if (commandName === 'assumir') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um ticket.', ephemeral: true });
        if (!isAdmin(interaction.member)) { await denyAdmin(interaction); return; }
        await interaction.deferReply().catch(() => null);
        await interaction.channel.setTopic(`${interaction.channel.topic || ''} | Assumido por:${interaction.user.tag}`).catch(() => null);
        return interaction.editReply(`🙋 Ticket assumido por ${interaction.user}!`).catch(() => null);
      }

      if (commandName === 'transcript') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um ticket.', ephemeral: true });
        await interaction.deferReply();
        const txt = await buildTranscript(interaction.channel);
        const file = new AttachmentBuilder(Buffer.from(txt, 'utf-8'), { name: `transcript-${interaction.channel.name}.txt` });
        return interaction.editReply({ content: '📝 Transcript:', files: [file] });
      }

      if (commandName === 'ajuda') {
        const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('❓ Ajuda — Bot de Tickets')
          .setDescription(
            '**Como usuário:**\nVá no painel 🎫 e escolha o tipo. Só abra 1 por vez.\n\n**Comandos (equipe):**\n`/painel-ticket` — posta o painel\n`/adicionar @user` / `/remover @user`\n`/renomear nome` — renomeia canal\n`/transcript` — baixa histórico\n`/stats` — status do bot (+ vê se você é ADMIN)\n`/anunciar` — posta anúncio bonito\n`/limpar qtd` — apaga até 100 msgs do canal\n`/tickets` — lista tickets abertos\n\n**Só ADMIN (1 clique):**\n`/fechar [motivo]` + `/prioridade` + botões 🙋 Assumir / 🔒 Fechar / 🔓 Reabrir / 🗑️ Deletar\n\n**Automático:** motivo obrigatório, avaliação ⭐ (chega na sua DM), auto-close inativo, anti-link/palavrão'
          );
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (commandName === 'stats') {
        const abertos = interaction.guild.channels.cache.filter((c) => c.name.startsWith('ticket-')).size;
        const fechados = interaction.guild.channels.cache.filter((c) => c.name.startsWith('fechado-')).size;
        const up = Math.floor(process.uptime());
        const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60), s = up % 60;
        const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('📊 Status do bot')
          .addFields(
            { name: '🎫 Abertos', value: `${abertos}`, inline: true },
            { name: '🔒 Fechados', value: `${fechados}`, inline: true },
            { name: '⏱️ Online há', value: `${h}h ${m}m ${s}s`, inline: true },
            { name: '📶 Ping', value: `${client.ws.ping}ms`, inline: true },
            { name: '👑 Você é ADMIN?', value: isAdmin(interaction.member) ? '✅ SIM' : '❌ NÃO (fechar/assumir bloqueados)', inline: true },
            { name: '🛡️ Você é equipe?', value: isStaff(interaction.member) ? '✅ SIM' : '❌ NÃO', inline: true },
          ).setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (commandName === 'anunciar') {
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe pode anunciar.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const canal = interaction.options.getChannel('canal', true);
        const titulo = interaction.options.getString('titulo', true);
        const mensagem = interaction.options.getString('mensagem', true).replace(/\\n/g, '\n');
        const corRaw = (interaction.options.getString('cor') || '').trim();
        const corInvalida = corRaw && !/^#[0-9A-Fa-f]{6}$/.test(corRaw);
        const cor = corInvalida ? EMBED_COLOR : (corRaw || EMBED_COLOR);
        if (!canal.isTextBased()) return interaction.reply({ content: '❌ Escolha um canal de texto.', ephemeral: true });
        const embed = new EmbedBuilder().setColor(cor).setTitle(titulo.slice(0, 256)).setDescription(mensagem.slice(0, 4000))
          .setFooter({ text: `Anúncio por ${interaction.user.tag}` }).setTimestamp();
        await canal.send({ embeds: [embed] }).catch(() => null);
        sendLog(interaction.guild, logEmbed('Blue', '📢 Anúncio enviado', `**Canal:** ${canal}\n**Título:** ${titulo.slice(0, 100)}`, interaction.user));
        return interaction.editReply(`✅ Anúncio postado em ${canal}!${corInvalida ? ' (⚠️ cor inválida, usei a padrão — formato `#FF0000`)' : ''}`).catch(() => null);
      }

      if (commandName === 'limpar') {
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe pode limpar.', ephemeral: true });
        const qtd = Math.min(Math.max(interaction.options.getInteger('qtd', true), 1), 100);
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const apagadas = await interaction.channel.bulkDelete(qtd, true).catch(() => null);
        const n = apagadas ? apagadas.size : 0;
        sendLog(interaction.guild, logEmbed('Grey', '🧹 Limpeza', `**Canal:** ${interaction.channel}\n**Apagadas:** ${n}\n**Por:** ${interaction.user}`, interaction.user));
        return interaction.editReply(`🧹 Apaguei **${n}** mensagens! (só msgs com menos de 14 dias)`).catch(() => null);
      }
      return;
    }

    // ----- Select menu: escolheu tipo → pede MOTIVO (modal) -----
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_type') {
      const typeKey = interaction.values[0];
      const type = TICKET_TYPES[typeKey] || TICKET_TYPES.suporte;
      const modal = new ModalBuilder().setCustomId(`modal_motivo_${typeKey}`).setTitle(`Novo ticket: ${type.label.slice(0, 30)}`);
      const input = new TextInputBuilder()
        .setCustomId('motivo')
        .setLabel('Descreva o motivo (obrigatório)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Ex: Fui banido sem motivo, quero revisão...')
        .setMinLength(5)
        .setMaxLength(500)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // ----- Modal: motivo enviado → cria o ticket -----
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_motivo_')) {
      const typeKey = interaction.customId.replace('modal_motivo_', '');
      const motivo = interaction.fields.getTextInputValue('motivo');
      await createTicket(interaction, typeKey, motivo);
      return;
    }

    // ----- Avaliação 1-5 (só o DONO vota, resultado vai na DM do admin) -----
    if (interaction.isStringSelectMenu() && interaction.customId === 'rate_ticket') {
      const nota = interaction.values[0];
      const ownerId = getTicketOwnerId(interaction.channel);
      if (ownerId && interaction.user.id !== ownerId) {
        return interaction.reply({ content: '❌ Só o dono do ticket pode avaliar.', ephemeral: true });
      }
      const stars = '⭐'.repeat(parseInt(nota)) || '⭐';
      await interaction.reply({ content: `Obrigado! Avaliação registrada: ${stars} (${nota}/5)`, ephemeral: true });
      sendLog(interaction.guild, logEmbed('Gold', '⭐ Avaliação recebida', `**Canal:** #${interaction.channel.name}\n**Nota:** ${stars} (${nota}/5)`, interaction.user));
      // DM pro admin que fechou com o resultado
      try {
        const m = (interaction.channel.topic || '').match(/FechadoPor:(\d+)/);
        if (m && m[1] !== interaction.user.id) {
          const admin = await client.users.fetch(m[1]).catch(() => null);
          if (admin) {
            await admin.send(`⭐ **Avaliação recebida!**\n**Ticket:** #${interaction.channel.name}\n**De:** ${interaction.user.tag}\n**Nota:** ${stars} (${nota}/5)`).catch(() => null);
          }
        }
      } catch {}
      return;
    }

    // ----- Botões -----
    if (interaction.isButton()) {
      const ch = interaction.channel;
      const id = interaction.customId;

      // Fechar em 1 clique (sem confirmação — Reabrir desfaz)
      if (id === 'close_ticket') {
        if (!isTicketChannel(ch)) return interaction.reply({ content: '❌ Não é um ticket.', ephemeral: true });
        if (!isAdmin(interaction.member)) { await denyAdmin(interaction); return; }
        try { await interaction.deferUpdate(); } catch {}
        await doCloseTicket(interaction, ch);
        return;
      }
      if (id === 'reopen_ticket') {
        if (!isAdmin(interaction.member)) { await denyAdmin(interaction); return; }
        await interaction.deferUpdate().catch(() => null);
        const ownerId = getTicketOwnerId(ch);
        if (ownerId) await ch.permissionOverwrites.edit(ownerId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => null);
        await ch.setName(ch.name.replace(/^fechado-/, '').slice(0, 100)).catch(() => null);
        return interaction.followUp(`🔓 Ticket reaberto por ${interaction.user}!`).catch(() => null);
      }

      if (id === 'delete_ticket') {
        if (!isAdmin(interaction.member)) { await denyAdmin(interaction); return; }
        await interaction.reply('🗑️ Deletando em 5 segundos...');
        sendLog(ch.guild, logEmbed('DarkRed', '🗑️ Ticket deletado', `**Canal:** #${ch.name}\n**Deletado por:** ${interaction.user}`, interaction.user));
        setTimeout(() => ch.delete().catch(() => null), 5000);
        return;
      }

      if (id === 'claim_ticket') {
        if (!isTicketChannel(ch)) return interaction.reply({ content: '❌ Não é um ticket.', ephemeral: true });
        if (!isAdmin(interaction.member)) { await denyAdmin(interaction); return; }
        await interaction.deferUpdate().catch(() => null);
        await ch.setTopic(`${ch.topic || ''} | Assumido por:${interaction.user.tag}`.slice(0, 1024)).catch(() => null);
        return interaction.followUp(`🙋 ${interaction.user} assumiu o atendimento!`).catch(() => null);
      }

      if (id === 'transcript_ticket') {
        await interaction.deferReply({ ephemeral: true });
        const txt = await buildTranscript(ch);
        const file = new AttachmentBuilder(Buffer.from(txt, 'utf-8'), { name: `transcript-${ch.name}.txt` });
        return interaction.editReply({ content: '📝 Aqui está:', files: [file] });
      }
    }
  } catch (err) {
    console.error('Erro na interação:', err);
    try {
      if (interaction.isRepliable()) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ Deu um erro. Tente de novo.', ephemeral: true });
        } else {
          await interaction.followUp({ content: `❌ Deu um erro aqui: ${String(err.message || err).slice(0, 300)}`, ephemeral: true });
        }
      }
    } catch {}
  }
});

// Fecha o ticket em 1 passo (botão Fechar e /fechar usam aqui)
async function doCloseTicket(interaction, ch, motivoFechamento = '') {
  if (ch.name.startsWith('fechado-')) {
    try {
      const msg = '🔒 Esse ticket já está fechado. Use 🔓 Reabrir ou 🗑️ Deletar.';
      if (interaction.deferred) await interaction.followUp({ content: msg, ephemeral: true }).catch(() => null);
      else if (!interaction.replied) await interaction.reply({ content: msg, ephemeral: true }).catch(() => null);
    } catch {}
    return true;
  }
  const ownerId = getTicketOwnerId(ch);
  const closerId = interaction.user.id;
  // Gera o transcript ANTES de trancar (garante histórico completo)
  const transcriptTxt = await buildTranscript(ch).catch(() => null);
  const transcriptFile = () =>
    transcriptTxt ? new AttachmentBuilder(Buffer.from(transcriptTxt, 'utf-8'), { name: `transcript-${ch.name}.txt` }) : null;
  const falhas = [];
  // 1) Tira permissão de falar do dono, mantém vendo
  if (ownerId) {
    const r = await ch.permissionOverwrites.edit(ownerId, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }).catch((e) => e);
    if (r instanceof Error) falhas.push('permissão do dono');
  }
  // 2) Salva quem fechou no tópico
  await ch.setTopic(`${ch.topic || ''} | FechadoPor:${closerId}`.slice(0, 1024)).catch(() => falhas.push('tópico'));
  // 3) Renomeia pra fechado-*
  if (!ch.name.startsWith('fechado-')) {
    const r = await ch.setName(`fechado-${ch.name}`.slice(0, 100)).catch((e) => e);
    if (r instanceof Error) falhas.push('renomear (bot precisa de Gerenciar Canais)');
  }

  // Só 2 botões depois de fechado: Reabrir e Deletar
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('reopen_ticket').setLabel('Reabrir').setStyle(ButtonStyle.Success).setEmoji('🔓'),
    new ButtonBuilder().setCustomId('delete_ticket').setLabel('Deletar').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
  );
  const embed = new EmbedBuilder().setColor('Red').setTitle('🔒 Ticket fechado')
    .setDescription(`Fechado por ${interaction.user}${motivoFechamento ? `\n**Motivo:** ${motivoFechamento.slice(0, 500)}` : ''}\n\n🔓 Reabrir ou 🗑️ Deletar abaixo.\n\n**Dono do ticket:** avalie o atendimento no menu abaixo! 👇`).setTimestamp();
  const tFile = transcriptFile();
  const postado = await ch.send({ embeds: [embed], components: [row], ...(tFile ? { files: [tFile] } : {}) }).catch((e) => e);
  if (postado instanceof Error) {
    try { await interaction.user.send(`⚠️ Fechei o ticket **#${ch.name}** mas não consegui postar nele (sem permissão de Enviar Mensagens).`).catch(() => null); } catch {}
    sendLog(ch.guild, logEmbed('Red', '⚠️ Ticket fechado com falhas', `**Canal:** #${ch.name}\n**Falhas:** postar msg + ${falhas.join(', ')}`, interaction.user));
    try { await interaction.followUp({ content: `🔒 Ticket trancado, mas tive falhas: ${['postar msg', ...falhas].join(', ')}.`, ephemeral: true }); } catch {}
    return;
  }
  if (falhas.length) await ch.send(`⚠️ Avisos (não críticos): ${falhas.join(', ')}.`).catch(() => null);
  const rateMenu = new StringSelectMenuBuilder()
    .setCustomId('rate_ticket')
    .setPlaceholder('⭐ Avalie o atendimento (1-5)...')
    .addOptions([1, 2, 3, 4, 5].map((n) => ({ label: `${'⭐'.repeat(n)} (${n}/5)`, value: `${n}`, emoji: '⭐' })));
  await ch.send({ content: 'Sua opinião ajuda a melhorar! (só o dono precisa votar)', components: [new ActionRowBuilder().addComponents(rateMenu)] }).catch(() => null);
  // DM pro dono pedindo avaliação (se a DM tiver fechada, ignora)
  if (ownerId) {
    try {
      const owner = await client.users.fetch(ownerId).catch(() => null);
      if (owner) {
        const dmEmbed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('🔒 Seu ticket foi fechado')
          .setDescription(`O ticket **#${ch.name}** foi fechado por ${interaction.user}.${motivoFechamento ? `\n**Motivo:** ${motivoFechamento.slice(0, 500)}` : ''}\n\nVolte ao canal ${ch} e vote de **1 a 5 ⭐** no menu de avaliação!`)
          .setTimestamp();
        const dmFile = transcriptFile();
        await owner.send({ embeds: [dmEmbed], ...(dmFile ? { files: [dmFile] } : {}) }).catch(() => null);
      }
    } catch {}
  }
  // Transcript também no canal de logs
  if (transcriptTxt && LOG_CHANNEL_ID) {
    try {
      const logCh = await ch.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (logCh && logCh.isTextBased()) {
        const lf = new AttachmentBuilder(Buffer.from(transcriptTxt, 'utf-8'), { name: `transcript-${ch.name}.txt` });
        await logCh.send({ content: `📝 Transcript de **#${ch.name}** (fechado por ${interaction.user})`, files: [lf] }).catch(() => null);
      }
    } catch {}
  }
  sendLog(ch.guild, logEmbed('Red', '🔒 Ticket fechado', `**Canal:** #${ch.name}\n**Fechado por:** ${interaction.user}${motivoFechamento ? `\n**Motivo:** ${motivoFechamento.slice(0, 500)}` : ''}`, interaction.user));
  return true;
}

// Neagação VISÍVEL quando não é admin (efêmera + aviso público que se apaga)
async function denyAdmin(interaction) {
  try { await interaction.reply({ content: `${ADMIN_ONLY_MSG}\n💡 Dica: use /stats pra ver se sua conta tem ADMIN de verdade.`, ephemeral: true }); } catch {}
  try {
    const ch = interaction.channel;
    if (ch && ch.isTextBased && ch.isTextBased()) {
      const w = await ch.send(`⚠️ ${interaction.user}, isso é **só pra ADMIN** (permissão Administrador).`).catch(() => null);
      if (w) setTimeout(() => w.delete().catch(() => null), 10000);
    }
  } catch {}
}

client.once('ready', () => {
  console.log(`✅ Logado como ${client.user.tag}!`);
  console.log('📌 Agora rode: npm run deploy (uma vez) e depois use /painel-ticket no servidor');
  try { client.user.setActivity('🎫 Tickets | /ajuda', { type: 3 }); } catch {}
  // Auto-close: checa a cada 10 min
  if (INACTIVE_HOURS > 0) {
    setInterval(autoCloseInactive, 10 * 60 * 1000);
    console.log(`⏰ Auto-close ativo: fecha tickets parados há +${INACTIVE_HOURS}h`);
  }
});

// ---------- 7b. Auto-close de tickets inativos ----------
async function autoCloseInactive() {
  try {
    for (const [, guild] of client.guilds.cache) {
      const tickets = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText && c.name.startsWith('ticket-'));
      for (const [, ch] of tickets) {
        try {
          const last = await ch.messages.fetch({ limit: 1 }).catch(() => null);
          const lastMsg = last && last.first();
          if (!lastMsg) continue;
          const hoursIdle = (Date.now() - lastMsg.createdTimestamp) / 3600000;
          if (hoursIdle >= INACTIVE_HOURS) {
            const ownerId = getTicketOwnerId(ch);
            if (ownerId) await ch.permissionOverwrites.edit(ownerId, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }).catch(() => null);
            await ch.setName(`fechado-${ch.name}`.slice(0, 100)).catch(() => null);
            await ch.send('⏰ **Ticket fechado automaticamente por inatividade.** Use 🔓 para reabrir (ADMIN) ou `/transcript` para o histórico.').catch(() => null);
            sendLog(guild, logEmbed('Orange', '⏰ Auto-close', `**Canal:** #${ch.name}\n**Parado há:** ${hoursIdle.toFixed(1)}h`, null));
          }
        } catch {}
      }
    }
  } catch (e) { console.error('Erro no auto-close:', e); }
}

// ---------- 7c. Anti-link + anti-palavrão ----------
const INVITE_RE = /(discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/)/i;
client.on('messageCreate', async (msg) => {
  try {
    if (!msg.guild || msg.author.bot) return;
    const member = msg.member;
    if (isStaff(member)) return; // equipe pode postar link
    const content = msg.content || '';
    const isLink = ANTILINK && INVITE_RE.test(content);
    const low = content.toLowerCase();
    const hasBad = BADWORDS.length > 0 && BADWORDS.some((w) => low.includes(w));
    if (!isLink && !hasBad) return;
    await msg.delete().catch(() => null);
    const motivo = isLink ? 'link de convite' : 'palavra proibida';
    const warn = await msg.channel.send(`⚠️ ${msg.author}, ${motivo} não é permitido aqui!`).catch(() => null);
    if (warn) setTimeout(() => warn.delete().catch(() => null), 8000);
    sendLog(msg.guild, logEmbed('Orange', '🛡️ Auto-mod', `**Por:** ${msg.author}\n**Canal:** ${msg.channel}\n**Motivo:** ${motivo}\n**Mensagem:** ${content.slice(0, 500)}`, msg.author));
  } catch {}
});

// ---------- 7. Auto-role + Boas-vindas + Logs de entrada/saída ----------
client.on('guildMemberAdd', async (member) => {
  try {
    // Auto-role
    if (AUTO_ROLE_ID) {
      const role = member.guild.roles.cache.get(AUTO_ROLE_ID);
      if (role) await member.roles.add(role).catch((e) => console.error('Auto-role falhou (cargo do bot precisa estar ACIMA):', e.message));
      else console.warn('⚠️ AUTO_ROLE_ID não encontrado no servidor.');
    }
    // Boas-vindas
    if (WELCOME_CHANNEL_ID) {
      const ch = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
      if (ch && ch.isTextBased()) {
        const text = WELCOME_MESSAGE.replace('{user}', `${member}`).replace('{server}', member.guild.name);
        const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`👋 Bem-vindo(a), ${member.user.username}!`)
          .setDescription(text).setThumbnail(member.user.displayAvatarURL()).setTimestamp();
        await ch.send({ embeds: [embed] }).catch(() => null);
      }
    }
    sendLog(member.guild, logEmbed('Green', '📥 Entrou no servidor', `**Conta criada:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, member.user));
  } catch (e) { console.error('Erro no guildMemberAdd:', e); }
});

client.on('guildMemberRemove', async (member) => {
  try {
    sendLog(member.guild, logEmbed('Grey', '📤 Saiu do servidor', `**Entrou em:** ${member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : 'desconhecido'}\n**Cargos:** ${member.roles.cache.map((r) => r.name).slice(0, 10).join(', ')}`, member.user));
  } catch {}
});

client.login(TOKEN).catch((e) => {
  console.error('❌ Falha no login — confira o TOKEN:', e && e.message ? e.message : e);
  process.exit(1);
});
