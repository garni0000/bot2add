require('dotenv').config();
const { Telegraf } = require('telegraf');
const { MongoClient } = require('mongodb');
const express = require('express');

// Vérification des variables d'environnement
const requiredEnv = ['TELEGRAM_BOT_TOKEN', 'MONGODB_URI', 'VIDEO_URL', 'CHANNEL1_URL', 'CHANNEL2_URL'];
requiredEnv.forEach(env => {
  if (!process.env[env]) throw new Error(`❌ Variable manquante : ${env}`);
});

// Configuration Express
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.get('/', (req, res) => res.send('🤖 Bot en fonctionnement'));
const server = app.listen(PORT, () => console.log(`✅ Serveur Express sur le port ${PORT}`));

// Configuration MongoDB
const DB_NAME = process.env.DB_NAME || 'telegram_bot';
const COLLECTION_NAME = 'users';
let db;

async function connectDB() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connecté à MongoDB');
  } catch (error) {
    console.error('❌ Erreur MongoDB:', error);
    process.exit(1);
  }
}

// Initialisation du bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Configuration Webhook pour production
if (process.env.NODE_ENV === 'production') {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl);
  app.use(bot.webhookCallback('/webhook'));
  console.log(`🌍 Webhook configuré sur ${webhookUrl}`);
} else {
  bot.launch().then(() => console.log('🔵 Mode développement (polling)'));
}

// Fonctions utilitaires
function escapeMarkdown(text) {
  return text.replace(/[\_*\[\]\(\)~\`>\#\+\-=\|{}\.!]/g, '\\$&');
}

function isAdmin(userId) {
  return (process.env.ADMINS || '').split(',').includes(userId.toString());
}

async function canSendMessage(userId) {
  try {
    await bot.telegram.getChat(userId);
    return true;
  } catch (error) {
    if (error.code === 403) {
      await db.collection(COLLECTION_NAME).deleteOne({ telegram_id: userId });
    }
    return false;
  }
}

// Gestion des demandes d'adhésion
bot.on('chat_join_request', async (ctx) => {
  const { user, chat } = ctx.update.chat_join_request;
  
  try {
    // Sauvegarde utilisateur
    await db.collection(COLLECTION_NAME).updateOne(
      { telegram_id: user.id },
      { $set: {
        first_name: user.first_name,
        username: user.username,
        status: 'pending',
        last_activity: new Date()
      }},
      { upsert: true }
    );

    // Envoi message de bienvenue après 5s
    setTimeout(() => sendWelcomeMessage(user), 5000);
    
    // Approbation finale après 10min
    setTimeout(async () => {
      const userData = await db.collection(COLLECTION_NAME).findOne({ telegram_id: user.id });
      if (userData?.status === 'pending') {
        await ctx.approveChatJoinRequest(user.id);
        await db.collection(COLLECTION_NAME).updateOne(
          { telegram_id: user.id },
          { $set: { status: 'approved', approved_at: new Date() }}
        );
      }
    }, 600000);

  } catch (error) {
    console.error('❌ Erreur traitement demande:', error);
  }
});

// Envoi du message de bienvenue
async function sendWelcomeMessage(user) {
  try {
    const startParam = `start=user_${user.id}`;
    const caption = `*${escapeMarkdown(user.first_name)}*, bienvenue !\n\n`
      + "Cliquez sur le bouton ci-dessous pour confirmer votre adhésion :";

    await bot.telegram.sendVideo(user.id, process.env.VIDEO_URL, {
      caption: caption,
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[{
          text: '✅ Confirmer mon adhésion',
          url: `https://t.me/${bot.botInfo.username}?start=${startParam}`
        }]]
      }
    });

    console.log(`📨 Message envoyé à ${user.id}`);
  } catch (error) {
    console.error(`❌ Échec envoi à ${user.id}:`, error.message);
    if (error.code === 403) {
      await db.collection(COLLECTION_NAME).deleteOne({ telegram_id: user.id });
    }
  }
}

// Commandes admin
bot.command('stats', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  const stats = await db.collection(COLLECTION_NAME).aggregate([
    { $group: { 
      _id: '$status',
      count: { $sum: 1 },
      latest: { $max: '$last_activity' }
    }}
  ]).toArray();

  let message = '📊 Statistiques :\n';
  stats.forEach(s => {
    message += `\n- ${s._id.toUpperCase()}: ${s.count} (dernière activité: ${s.latest.toLocaleString()})`;
  });
  
  await ctx.reply(message);
});

bot.command('send', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  const message = ctx.message.reply_to_message;
  if (!message) return ctx.reply('⚠️ Répondez à un message avec /send');

  const users = await db.collection(COLLECTION_NAME).find().toArray();
  let success = 0;
  
  await ctx.reply(`⏳ Début de la diffusion à ${users.length} utilisateurs...`);

  for (const user of users) {
    if (await canSendMessage(user.telegram_id)) {
      try {
        await bot.telegram.copyMessage(
          user.telegram_id, 
          ctx.chat.id, 
          message.message_id,
          { parse_mode: 'MarkdownV2' }
        );
        success++;
        await new Promise(resolve => setTimeout(resolve, 50)); // Anti-spam
      } catch (error) {
        console.error(`❌ Échec envoi à ${user.telegram_id}:`, error.message);
      }
    }
  }

  await ctx.reply(`✅ Diffusion terminée :\n${success} messages envoyés\n${users.length - success} échecs`);
});

// Commande de test
bot.command('test', async (ctx) => {
  await ctx.replyWithVideo(process.env.VIDEO_URL, {
    caption: 'Ceci est un message de test',
    parse_mode: 'MarkdownV2'
  });
  ctx.reply('✅ Test réussi !');
});

// Démarrage
(async () => {
  await connectDB();
  if (process.env.NODE_ENV !== 'production') {
    bot.launch();
  }
  console.log('🤖 Bot prêt');
})();

// Gestion des arrêts
process.on('SIGTERM', async () => {
  await bot.stop();
  server.close();
  process.exit(0);
});
