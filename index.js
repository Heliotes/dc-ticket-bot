// Bot de Tickets / Suporte - discord.js v14
// Feito pra ficar 24h no Render/Railway de graça + seguro (token só no .env)
require('dotenv').config();
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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
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

function isTicketChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildText) return false;
  if (channel.name.startsWith('ticket-') || channel.name.startsWith('fechado-')) return true;
  if (channel.topic && channel.topic.includes('TICKET:')) return true;
  return false;
}

function getTicketOwnerId(channel) {
  if (channel.topic) {
    const m = channel.topic.match(/TICKET:(\d+)/);
    if (m) return m[1];
  }
  return null;
}

async function sendLog(guild, embed) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (ch && ch.isTextBased()) ch.send({ embeds: [embed] });
  } catch {}
}

function logEmbed(color, title, desc, user, fields = []) {
  const e = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp().setFooter({ text: 'Bot Tickets • Log' });
  if (user) e.setThumbnail(user.displayAvatarURL()).addFields({ name: 'Usuário', value: `${user} (\`${user.id}\`)`, inline: false });
  if (fields.length) e.addFields(fields);
  return e;
}

// ---------- 4. Criar ticket ----------
async function createTicket(interaction, typeKey) {
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

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID || null,
    topic: `TICKET:${user.id} | Tipo:${typeKey} | Criado:${new Date().toISOString()}`,
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
      `Olá ${user}, a equipe já foi chamada!\n\n**Tipo:** ${type.label}\n**Descreva seu problema** com o máximo de detalhes.\n\nAguarde um atendente. Não marque ninguém à toa.`
    )
    .setFooter({ text: 'Use os botões abaixo para gerenciar' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
    new ButtonBuilder().setCustomId('claim_ticket').setLabel('Assumir').setStyle(ButtonStyle.Primary).setEmoji('🙋'),
    new ButtonBuilder().setCustomId('transcript_ticket').setLabel('Transcript').setStyle(ButtonStyle.Secondary).setEmoji('📝')
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
    let text = m.content || '[embed/anexo]';
    if (m.attachments.size > 0) text += ` [anexos: ${[...m.attachments.values()].map((a) => a.url).join(', ')}]`;
    return `[${date}] ${author}: ${text}`;
  });
  const header = `TRANSCRIPT — #${channel.name} (${channel.id})\nGerado em ${new Date().toLocaleString('pt-BR')}\nTotal: ${messages.length} mensagens\n${'='.repeat(60)}\n`;
  return header + lines.join('\n');
}

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

        return interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
      }

      if (commandName === 'fechar') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um canal de ticket.', ephemeral: true });
        return askCloseConfirmation(interaction);
      }

      if (commandName === 'adicionar') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um ticket.', ephemeral: true });
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe.', ephemeral: true });
        const target = interaction.options.getUser('usuario');
        await interaction.channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        return interaction.reply(`✅ ${target} adicionado ao ticket.`);
      }

      if (commandName === 'remover') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um ticket.', ephemeral: true });
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe.', ephemeral: true });
        const target = interaction.options.getUser('usuario');
        const ownerId = getTicketOwnerId(interaction.channel);
        if (target.id === ownerId) return interaction.reply({ content: '❌ Não dá pra remover o dono do ticket.', ephemeral: true });
        await interaction.channel.permissionOverwrites.delete(target.id).catch(() => null);
        return interaction.reply(`✅ ${target} removido do ticket.`);
      }

      if (commandName === 'renomear') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um ticket.', ephemeral: true });
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe.', ephemeral: true });
        const nome = interaction.options.getString('nome', true).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90);
        await interaction.channel.setName(nome);
        return interaction.reply(`✅ Canal renomeado para \`${nome}\``);
      }

      if (commandName === 'assumir') {
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: '❌ Use dentro de um ticket.', ephemeral: true });
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe pode assumir.', ephemeral: true });
        await interaction.channel.setTopic(`${interaction.channel.topic || ''} | Assumido por:${interaction.user.tag}`);
        return interaction.reply(`🙋 Ticket assumido por ${interaction.user}!`);
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
            '**Como usuário:**\nVá no painel 🎫 e escolha o tipo. Só abra 1 por vez.\n\n**Comandos (equipe):**\n`/painel-ticket` — posta o painel\n`/fechar` — fecha o ticket\n`/assumir` — assume atendimento\n`/adicionar @user` / `/remover @user`\n`/renomear nome` — renomeia canal\n`/transcript` — baixa histórico\n`/stats` — status do bot'
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
          ).setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      return;
    }

    // ----- Select menu: escolheu tipo -----
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_type') {
      const typeKey = interaction.values[0];
      await createTicket(interaction, typeKey);
      return;
    }

    // ----- Botões -----
    if (interaction.isButton()) {
      const ch = interaction.channel;
      const id = interaction.customId;

      if (id === 'close_ticket') {
        if (!isTicketChannel(ch)) return interaction.reply({ content: '❌ Não é um ticket.', ephemeral: true });
        return askCloseConfirmation(interaction);
      }

      if (id === 'cancel_close') {
        return interaction.update({ content: '❌ Fechamento cancelado.', embeds: [], components: [] });
      }

      if (id === 'confirm_close') {
        await interaction.update({ content: '🔒 Fechando ticket...', embeds: [], components: [] });
        const ownerId = getTicketOwnerId(ch);
        // Tira permissão de falar do dono, mantém vendo
        if (ownerId) {
          await ch.permissionOverwrites.edit(ownerId, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }).catch(() => null);
        }
        if (!ch.name.startsWith('fechado-')) await ch.setName(`fechado-${ch.name}`.slice(0, 100)).catch(() => null);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('reopen_ticket').setLabel('Reabrir').setStyle(ButtonStyle.Success).setEmoji('🔓'),
          new ButtonBuilder().setCustomId('transcript_ticket').setLabel('Transcript').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
          new ButtonBuilder().setCustomId('delete_ticket').setLabel('Deletar').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
        );
        const embed = new EmbedBuilder().setColor('Red').setTitle('🔒 Ticket fechado')
          .setDescription(`Fechado por ${interaction.user}\n\nReabra, gere transcript ou delete em 5s (digite!).`).setTimestamp();
        await ch.send({ embeds: [embed], components: [row] });
        sendLog(ch.guild, logEmbed('Red', '🔒 Ticket fechado', `**Canal:** #${ch.name}\n**Fechado por:** ${interaction.user}`, interaction.user));
        return;
      }

      if (id === 'reopen_ticket') {
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe pode reabrir.', ephemeral: true });
        const ownerId = getTicketOwnerId(ch);
        if (ownerId) await ch.permissionOverwrites.edit(ownerId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => null);
        await ch.setName(ch.name.replace(/^fechado-/, '').slice(0, 100)).catch(() => null);
        return interaction.reply(`🔓 Ticket reaberto por ${interaction.user}!`);
      }

      if (id === 'delete_ticket') {
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe pode deletar.', ephemeral: true });
        await interaction.reply('🗑️ Deletando em 5 segundos...');
        sendLog(ch.guild, logEmbed('DarkRed', '🗑️ Ticket deletado', `**Canal:** #${ch.name}\n**Deletado por:** ${interaction.user}`, interaction.user));
        setTimeout(() => ch.delete().catch(() => null), 5000);
        return;
      }

      if (id === 'claim_ticket') {
        if (!isTicketChannel(ch)) return interaction.reply({ content: '❌ Não é um ticket.', ephemeral: true });
        if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Só a equipe pode assumir.', ephemeral: true });
        await ch.setTopic(`${ch.topic || ''} | Assumido por:${interaction.user.tag}`).catch(() => null);
        return interaction.reply(`🙋 ${interaction.user} assumiu o atendimento!`);
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
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: '❌ Deu um erro. Tente de novo.', ephemeral: true }).catch(() => null);
    }
  }
});

async function askCloseConfirmation(interaction) {
  const embed = new EmbedBuilder().setColor('Yellow').setTitle('🔒 Fechar ticket?')
    .setDescription('Tem certeza? O usuário não vai mais poder falar aqui.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm_close').setLabel('Confirmar').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
  );
  return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

client.once('ready', () => {
  console.log(`✅ Logado como ${client.user.tag}!`);
  console.log('📌 Agora rode: npm run deploy (uma vez) e depois use /painel-ticket no servidor');
  try { client.user.setActivity('🎫 Tickets | /ajuda', { type: 3 }); } catch {}
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
        ch.send({ embeds: [embed] });
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

client.login(TOKEN);
