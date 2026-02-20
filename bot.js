// ================= IMPORTS =================
require("dotenv").config();
const { Client: WhatsAppClient, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { Client, GatewayIntentBits } = require("discord.js");
const qrcode = require("qrcode-terminal");
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");
const fs = require("fs");

// ================= CONFIG =================
const DISCORD_TOKEN = "token bot";
const DISCORD_CHANNEL_ID = "id chanelle";const DATA_FILE = "./accepted.json";

// ================= CONDITIONS =================
const CONDITIONS = `
?? Conditions de l’interface WhatsApp

Merci de respecter les règles suivantes :

? Pas de spam  
?? 1 message toutes les 3 secondes maximum  
?? Interface uniquement pour parler de l’école  
?? Messages inutiles interdits  
?? Contenu illégal interdit  
?? Insultes interdites  

?? Tape !accepte pour continuer.
`;

// ================= GLOBALS =================
let TARGET_GROUP_ID = null;
let groupsCache = [];
let whatsappReady = false;
let lastMsg = {};

// ================= ACCEPTED USERS =================
function loadAccepted() {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, { encoding: "utf8" }));
}
function saveAccepted(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), { encoding: "utf8" });
}

// ================= ANTI SPAM =================
function canSend(id) {
    const now = Date.now();
    if (!lastMsg[id] || now - lastMsg[id] > 3000) {
        lastMsg[id] = now;
        return true;
    }
    return false;
}

// ================= DISCORD CLIENT =================
const discord = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

discord.once("ready", () => {
    console.log("? Discord connecté :", discord.user.tag);
});

// ================= WHATSAPP CLIENT =================
const whatsapp = new WhatsAppClient({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: puppeteer.executablePath(),
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
});

whatsapp.on("qr", qr => {
    console.log("Scan QR WhatsApp:");
    qrcode.generate(qr, { small: true });
});

whatsapp.on("ready", () => {
    whatsappReady = true;
    console.log("? WhatsApp connecté !");
});

// ================= DISCORD ? WHATSAPP =================
discord.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (message.channel.id !== DISCORD_CHANNEL_ID) return;

    const accepted = loadAccepted();

    // Accept conditions
    if (message.content === "!accepte") {
        accepted[message.author.id] = true;
        saveAccepted(accepted);
        return message.reply("? Conditions acceptées !");
    }

    // List groups
    if (message.content === "!groupes") {
        if (!whatsappReady) return message.reply("? WhatsApp pas prêt");
        const chats = await whatsapp.getChats();
        groupsCache = chats.filter(c => c.isGroup);
        let txt = "?? Groupes WhatsApp:\n";
        groupsCache.forEach((g, i) => txt += `${i + 1} - ${g.name}\n`);
        txt += "\nTape !select X";
        return message.reply(txt);
    }

    // Select group
    if (message.content.startsWith("!select")) {
        const i = parseInt(message.content.split(" ")[1], 10) - 1;
        if (!groupsCache[i]) return message.reply("? Mauvais numéro");
        TARGET_GROUP_ID = groupsCache[i].id._serialized;
        return message.reply(`? Groupe sélectionné: ${groupsCache[i].name}`);
    }

    // Must accept
    if (!accepted[message.author.id]) {
        return message.reply(CONDITIONS);
    }

    // Anti spam
    if (!canSend(message.author.id)) return;
    if (!TARGET_GROUP_ID) return;

    const pseudo = message.member?.nickname || message.author.globalName || message.author.username;
    let content = message.content;

    // Mentions Discord ? @pseudo
    for (const [id, user] of message.mentions.users) {
        const name = user.globalName || user.username;
        content = content.replace(new RegExp(`<@!?${id}>`, "g"), `@${name}`);
    }

    // Reply ? SELECT
    if (message.reference) {
        const ref = await message.channel.messages.fetch(message.reference.messageId);
        const refName = ref.member?.nickname || ref.author.globalName || ref.author.username;
        // Blockquote style
        content = `> ${refName}: ${ref.content.replace(/\n/g, '\n> ')}\n\n${content}`;
    }

    // Media
    if (message.attachments.size > 0) {
        const file = message.attachments.first();
        const buffer = await fetch(file.url).then(r => r.arrayBuffer());
        const base64 = Buffer.from(buffer).toString("base64");
        const media = new MessageMedia(file.contentType, base64);

        await whatsapp.sendMessage(TARGET_GROUP_ID, media, { sendAudioAsVoice: true });
        return;
    }

    await whatsapp.sendMessage(TARGET_GROUP_ID, `[Discord | ${pseudo}] ${content}`);
});

// ================= WHATSAPP ? DISCORD =================
whatsapp.on("message", async msg => {
    if (!TARGET_GROUP_ID) return;
    if (msg.from !== TARGET_GROUP_ID) return;

    const channel = await discord.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return;

    const contact = await msg.getContact();
    const sender = contact.pushname || contact.name || contact.number;
    const accepted = loadAccepted();
    if (!accepted["whatsapp"]) return;

    let body = msg.body || "";
    body = body.replace(/@(\d+)/g, "@user");

    if (msg.hasQuotedMsg) {
        const q = await msg.getQuotedMessage();
        body = `> ${q.body.replace(/\n/g, '\n> ')}\n\n${body}`;
    }

    if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        const buffer = Buffer.from(media.data, "base64");

        if (media.mimetype.startsWith("audio")) {
            return channel.send({
                content: `?? WhatsApp | ${sender}`,
                files: [{ attachment: buffer, name: "vocal.ogg" }]
            });
        }

        return channel.send({
            content: `?? WhatsApp | ${sender}`,
            files: [{ attachment: buffer, name: "file" }]
        });
    }

    channel.send(`?? WhatsApp | ${sender}: ${body}`);
});

// ================= START =================
(async () => {
    await discord.login(DISCORD_TOKEN);
    await whatsapp.initialize();
})();