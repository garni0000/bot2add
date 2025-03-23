const BATCH_SIZE = 200; // Envoi 200 messages par batch
const DELAY_BETWEEN_MESSAGES = 5; // Pause de 5ms entre chaque message
const DELAY_BETWEEN_BATCHES = 1000; // Pause de 1s entre chaque batch

async function broadcastMessage(ctx, fromChatId, messageId) {
  try {
    const collection = db.collection(COLLECTION_NAME);
    let users = await collection.find().toArray();
    let totalUsers = users.length;
    let success = 0;
    let errors = 0;

    await ctx.reply(`📤 Début de la diffusion à ${totalUsers} utilisateurs...`);

    while (users.length > 0) {
      let failedUsers = [];

      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);

        for (const user of batch) {
          try {
            await ctx.telegram.copyMessage(user.telegram_id, fromChatId, messageId, {
              parse_mode: 'MarkdownV2'
            });
            success++;
          } catch (error) {
            failedUsers.push(user); // Garde en mémoire les échecs pour réessayer
            errors++;
          }
          await sleep(DELAY_BETWEEN_MESSAGES); // Pause entre chaque message
        }

        console.log(`✅ Batch ${i / BATCH_SIZE + 1} terminé: ${batch.length} messages envoyés.`);
        await sleep(DELAY_BETWEEN_BATCHES); // Pause entre chaque batch
      }

      users = failedUsers; // On ne retente que les échecs

      if (users.length > 0) {
        console.log(`🔄 ${users.length} utilisateurs en échec. Nouvelle tentative...`);
        await ctx.reply(`🔄 ${users.length} utilisateurs en échec. Nouvelle tentative...`);
      }
    }

    await ctx.reply(`✅ Diffusion terminée :
📨 Envoyés avec succès : ${success}
❌ Échecs définitifs : ${errors}`);

  } catch (error) {
    console.error('Erreur lors de la diffusion:', error);
    await ctx.reply('❌ Erreur lors de la diffusion des messages.');
  }
}
