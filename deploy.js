// Registra os slash commands UMA vez (rode: npm run deploy)
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Preencha TOKEN, CLIENT_ID e GUILD_ID no .env primeiro!');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName('painel-ticket').setDescription('[EQUIPE] Posta o painel de tickets com menu').toJSON(),
  new SlashCommandBuilder().setName('fechar').setDescription('[ADMIN] Fecha o ticket atual').toJSON(),
  new SlashCommandBuilder().setName('assumir').setDescription('[ADMIN] Assume o atendimento do ticket').toJSON(),
  new SlashCommandBuilder()
    .setName('adicionar').setDescription('[EQUIPE] Adiciona alguém ao ticket')
    .addUserOption((o) => o.setName('usuario').setDescription('Quem adicionar?').setRequired(true)).toJSON(),
  new SlashCommandBuilder()
    .setName('remover').setDescription('[EQUIPE] Remove alguém do ticket')
    .addUserOption((o) => o.setName('usuario').setDescription('Quem remover?').setRequired(true)).toJSON(),
  new SlashCommandBuilder()
    .setName('renomear').setDescription('[EQUIPE] Renomeia o canal do ticket')
    .addStringOption((o) => o.setName('nome').setDescription('Novo nome').setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName('transcript').setDescription('Gera o histórico do ticket em .txt').toJSON(),
  new SlashCommandBuilder().setName('ajuda').setDescription('Mostra ajuda do bot').toJSON(),
  new SlashCommandBuilder().setName('stats').setDescription('Mostra tickets abertos e status').toJSON(),
  new SlashCommandBuilder().setName('anunciar').setDescription('[EQUIPE] Posta um anúncio bonito em um canal')
    .addChannelOption((o) => o.setName('canal').setDescription('Onde postar?').setRequired(true))
    .addStringOption((o) => o.setName('titulo').setDescription('Título do anúncio').setRequired(true))
    .addStringOption((o) => o.setName('mensagem').setDescription('Texto (use \\n pra pular linha)').setRequired(true))
    .addStringOption((o) => o.setName('cor').setDescription('Cor hex. Ex: #FF0000').setRequired(false)).toJSON(),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('🔄 Registrando comandos...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`✅ ${commands.length} comandos registrados no servidor ${GUILD_ID}!`);
    console.log('💡 Dica: comandos de servidor atualizam na hora. Globais demoram 1h.');
  } catch (e) {
    console.error('❌ Erro ao registrar:', e);
  }
})();
