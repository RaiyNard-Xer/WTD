// =========================
// IMPORTS
// =========================
const { Client: WhatsAppClient, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { Client: DiscordClient, GatewayIntentBits } = require("discord.js");
const qrcode = require("qrcode-terminal");
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");

// =========================
// CONFIG À REMPLACER
// =========================
const DISCORD_TOKEN = "TON_TOKEN_DISCORD";
const DISCORD_CHANNEL_ID = "ID_DU_CHANNEL_DISCORD";

// =========================
// VARIABLES GLOBALES
// =========================
let whatsappReady = false;
let groupsCache = [];
let TARGET_GROUP_ID = null;

// =========================
// DISCORD CLIENT
// =========================
const discord = new DiscordClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

discord.once("clientReady", () => {
    console.log("✅ Discord connecté :", discord.user.tag);
});

// =========================
// WHATSAPP CLIENT
// =========================
const whatsapp = new WhatsAppClient({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: puppeteer.executablePath(),
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
});

// QR CODE
whatsapp.on("qr", qr => {
    console.log("\n📱 Scanne ce QR code pour connecter WhatsApp :\n");
    qrcode.generate(qr, { small: true });
    console.log("\n⚠️ Si le QR est illisible, agrandis ton terminal.\n");
});

// WHATSAPP PRÊT
whatsapp.on("ready", () => {
    whatsappReady = true;
    console.log("📱 WhatsApp connecté !");
});

// =========================
// COMMANDES DISCORD
// =========================
discord.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (message.channel.id !== DISCORD_CHANNEL_ID) return;

    // ----------------------------
    // !groupes → liste les groupes
    // ----------------------------
    if (message.content === "!groupes") {

        if (!whatsappReady) {
            return message.reply("❌ WhatsApp n'est pas encore connecté.");
        }

        try {
            const chats = await whatsapp.getChats();
            groupsCache = chats.filter(c => c.isGroup);

            if (groupsCache.length === 0) {
                return message.reply("❌ Aucun groupe WhatsApp trouvé.");
            }

            let txt = "📋 **Liste des groupes WhatsApp :**\n\n";
            groupsCache.forEach((g, i) => {
                txt += `**${i + 1}** — ${g.name}\n`;
            });

            txt += "\n➡️ Utilise : `!select <numéro>` pour choisir un groupe.";

            return message.reply(txt);

        } catch (err) {
            console.error("Erreur !groupes :", err);
            return message.reply("❌ Impossible de récupérer les groupes WhatsApp.");
        }
    }

    // ----------------------------
    // !select X → choisir un groupe
    // ----------------------------
    if (message.content.startsWith("!select")) {

        if (!whatsappReady) {
            return message.reply("❌ WhatsApp n'est pas encore connecté.");
        }

        const parts = message.content.split(" ");
        const index = parseInt(parts[1]) - 1;

        if (isNaN(index)) {
            return message.reply("❌ Utilisation : `!select <numéro>`");
        }

        if (!groupsCache[index]) {
            return message.reply("❌ Numéro invalide. Tape `!groupes` pour voir la liste.");
        }

        TARGET_GROUP_ID = groupsCache[index].id._serialized;

        return message.reply(`✅ Groupe sélectionné : **${groupsCache[index].name}**`);
    }

    // ----------------------------
    // Envoi Discord → WhatsApp
    // ----------------------------
    if (TARGET_GROUP_ID) {

        // ----- FICHIER DISCORD → WHATSAPP -----
        if (message.attachments.size > 0) {
            const file = message.attachments.first();
            const pseudo = message.member?.nickname || message.author.username;

            // ----- VOCAL -----
            if (file.contentType.startsWith("audio")) {
                const audioBuffer = await fetch(file.url).then(res => res.arrayBuffer());

                await whatsapp.sendMessage(
                    TARGET_GROUP_ID,
                    Buffer.from(audioBuffer),
                    { sendAudioAsVoice: true }
                );

                return message.reply("🎤 Vocal envoyé sur WhatsApp !");
            }

            // ----- IMAGE -----
            if (file.contentType.startsWith("image")) {
                const imgBuffer = await fetch(file.url).then(res => res.arrayBuffer());
                const base64 = Buffer.from(imgBuffer).toString("base64");

                const media = new MessageMedia(file.contentType, base64, "image.jpg");

                await whatsapp.sendMessage(
                    TARGET_GROUP_ID,
                    media,
                    { caption: `[Discord | ${pseudo}]` }
                );

                return message.reply("🖼️ Image envoyée sur WhatsApp !");
            }

            // ----- VIDÉO -----
            if (file.contentType.startsWith("video")) {
                const vidBuffer = await fetch(file.url).then(res => res.arrayBuffer());
                const base64 = Buffer.from(vidBuffer).toString("base64");

                const media = new MessageMedia(file.contentType, base64, "video.mp4");

                await whatsapp.sendMessage(
                    TARGET_GROUP_ID,
                    media,
                    { caption: `[Discord | ${pseudo}]` }
                );

                return message.reply("🎬 Vidéo envoyée sur WhatsApp !");
            }
        }

        // ----- TEXTE DISCORD → WHATSAPP -----
        const pseudo = message.member?.nickname || message.author.username;
        await whatsapp.sendMessage(
            TARGET_GROUP_ID,
            `[Discord | ${pseudo}] ${message.content}`
        );
    }
});

// =========================
// WHATSAPP → DISCORD
// =========================
whatsapp.on("message", async msg => {
    if (!TARGET_GROUP_ID) return;
    if (msg.from !== TARGET_GROUP_ID) return;

    const channel = await discord.channels.fetch(DISCORD_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const contact = await msg.getContact();
    const senderName =
        contact.pushname ||
        contact.verifiedName ||
        contact.name ||
        contact.number;

    // ----- MEDIA (VOCAL + IMAGE + VIDÉO) -----
    if (msg.hasMedia) {
        const media = await msg.downloadMedia();

        // VOCAL
        if (media.mimetype.startsWith("audio")) {
            return channel.send({
                content: `🎤 **WhatsApp | ${senderName} a envoyé un vocal :**`,
                files: [{
                    attachment: Buffer.from(media.data, "base64"),
                    name: "vocal.ogg"
                }]
            });
        }

        // IMAGE
        if (media.mimetype.startsWith("image")) {
            return channel.send({
                content: `🖼️ **WhatsApp | ${senderName} a envoyé une image :**`,
                files: [{
                    attachment: Buffer.from(media.data, "base64"),
                    name: "image.jpg"
                }]
            });
        }

        // VIDÉO
        if (media.mimetype.startsWith("video")) {
            return channel.send({
                content: `🎬 **WhatsApp | ${senderName} a envoyé une vidéo :**`,
                files: [{
                    attachment: Buffer.from(media.data, "base64"),
                    name: "video.mp4"
                }]
            });
        }
    }

    // ----- TEXTE -----
    channel.send(`📩 **WhatsApp | ${senderName} :** ${msg.body}`);
});

// =========================
// LANCEMENT
// =========================
(async () => {
    try {
        await discord.login(DISCORD_TOKEN);
        await whatsapp.initialize();
    } catch (err) {
        console.error("❌ Erreur :", err);
    }
})();