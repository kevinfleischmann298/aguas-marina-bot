require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log("Iniciando Bot de Aguas Marina para Easypanel...");

// Link del JSON público que aloja GitHub Pages
const CATALOGO_URL = 'https://kevinfleischmann298.github.io/aguas-marina-dashboard/catalogo.json';

const sesiones = {};
let promptBase = '';
try {
    promptBase = fs.readFileSync('./prompt_agente.txt', 'utf-8');
} catch (e) {
    promptBase = "Eres el asistente virtual de Agua Marina.";
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // Configuraciones CLAVES para correr dentro de Easypanel/Docker (Linux) sin entorno gráfico
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable'
    }
});

client.on('qr', (qr) => {
    console.log('\n\n======================================================');
    console.log('📱 ESCANEA ESTE CÓDIGO QR EN LA APP DE WHATSAPP:');
    console.log('======================================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n✅ ¡WHATSAPP VINCULADO CON ÉXITO EN EASYPANEL!');
    console.log('🤖 El agente está leyendo el catálogo desde GitHub Pages y esperando mensajes...');
});

// Caché global del catálogo
let cacheCatalogoReducido = '';
let lastFetchTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutos

client.on('message_create', async (message) => {
    // Evitar estados y grupos
    if (message.from === 'status@broadcast' || message.from.includes('@g.us') || message.to.includes('@g.us')) return;

    // Identificar el chat real (si es nuestro, usamos 'to', si es del cliente, usamos 'from')
    const chatID = message.fromMe ? message.to : message.from;
    const body = message.body;
    if (!body || message.hasMedia) return;

    // Inicializar memoria del chat si no existe
    if (!sesiones[chatID]) sesiones[chatID] = { carrito: [], historial: [], botActivo: true, lastBotResponse: '' };
    const sesion = sesiones[chatID];

    // --- LÓGICA DE MODO HUMANO ---
    if (message.fromMe) {
        const txt = body.trim().toLowerCase();
        if (txt === '!bot off') {
            sesion.botActivo = false;
            console.log(`🔴 Bot apagado manualmente para ${chatID}`);
        } else if (txt === '!bot on') {
            sesion.botActivo = true;
            console.log(`🟢 Bot reactivado para ${chatID}`);
        } else if (body !== sesion.lastBotResponse) {
            // Si mandamos un mensaje nosotros (el humano) y no es el que acaba de mandar el bot...
            if (sesion.botActivo) {
                sesion.botActivo = false;
                console.log(`🔴 Auto-pausa activada: El humano intervino en la conversación con ${chatID}`);
            }
        }
        return; // Salir de la función (no procesar mensajes que enviamos nosotros)
    }

    // Si el bot está apagado para este cliente, ignorar todo
    if (!sesion.botActivo) return;

    console.log(`\nMensaje recibido de ${chatID}: ${body}`);
    sesion.historial.push({ role: "user", content: body });

    try {
        // OBTENER CATÁLOGO CON CACHÉ
        if (Date.now() - lastFetchTime > CACHE_TTL || !cacheCatalogoReducido) {
            try {
                console.log("Descargando catálogo fresco desde GitHub...");
                const res = await axios.get(CATALOGO_URL);
                const catalogoActual = res.data;
                
                // Compresión a texto plano denso para ahorrar tokens y acelerar la IA
                const lineasCatalogo = catalogoActual.map(p => {
                    return `Cod:${p.codigo || '-'} | ${p.nombre} | ${p.presentacion || '-'} | May:$${p.precio_mayorista} | Min:$${p.precio_minorista} | Stock:${p.sin_stock ? 'NO' : 'SI'}`;
                });
                cacheCatalogoReducido = lineasCatalogo.join('\n');
                lastFetchTime = Date.now();
            } catch(e) {
                console.error("Error obteniendo catálogo. Usando caché anterior si existe.");
            }
        }
        
        const openaiMessages = [
            {
                role: "system",
                content: `${promptBase}\n\nCATÁLOGO ACTUALIZADO EN VIVO:\n${cacheCatalogoReducido}\n\nCARRITO ACTUAL:\n${JSON.stringify(sesion.carrito)}`
            },
            ...sesion.historial
        ];

        let aiResponse = "";
        
        if (process.env.OPENROUTER_API_KEY) {
            const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                model: "openai/gpt-4o-mini",
                messages: openaiMessages,
                temperature: 0.3
            }, {
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json"
                }
            });
            aiResponse = response.data.choices[0].message.content;
        } else {
            aiResponse = "⚠️ Faltan las credenciales de OpenRouter en Easypanel (Environment Variables).";
        }

        sesion.historial.push({ role: "assistant", content: aiResponse });
        sesion.lastBotResponse = aiResponse; // Guardar última respuesta para la auto-pausa

        await client.sendMessage(chatID, aiResponse);
        console.log(`🤖 Respondido a ${chatID}`);

    } catch (error) {
        console.error("Error AI:", error.message);
        await client.sendMessage(chatID, "Disculpa, estoy experimentando problemas técnicos temporales.");
    }
});

client.initialize();
