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

client.on('message', async (message) => {
    if (message.from === 'status@broadcast' || message.from.includes('@g.us')) return;

    const from = message.from;
    const body = message.body;
    if (!body || message.hasMedia) return;

    console.log(`\nMensaje recibido de ${from}: ${body}`);

    if (!sesiones[from]) sesiones[from] = { carrito: [], historial: [] };
    const sesion = sesiones[from];
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

        await client.sendMessage(from, aiResponse);
        console.log(`🤖 Respondido a ${from}`);

    } catch (error) {
        console.error("Error AI:", error.message);
        await client.sendMessage(from, "Disculpa, estoy experimentando problemas técnicos temporales.");
    }
});

client.initialize();
