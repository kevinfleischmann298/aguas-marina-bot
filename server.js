require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const PDFDocument = require('pdfkit');
const path = require('path');
const express = require('express');

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

    // Limitar historial a los últimos 20 mensajes para ahorrar tokens y evitar confusiones
    if (sesion.historial.length > 20) {
        sesion.historial = sesion.historial.slice(-20);
    }

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

        // INTERCEPTAR EL REMITO SI EXISTE
        let mensajeFinal = aiResponse;

        // DEBUG: Ver qué devolvió la IA
        console.log(`\n📝 RESPUESTA CRUDA DE LA IA (${chatID}):`);
        console.log(aiResponse);
        console.log(`\n🔍 ¿Contiene [REMITO_JSON]? ${aiResponse.includes('[REMITO_JSON]')}`);
        console.log(`🔍 ¿Contiene [PEDIDO_DATA]? ${aiResponse.includes('[PEDIDO_DATA]')}`);
        console.log(`🔍 ¿Contiene [RATING_DATA]? ${aiResponse.includes('[RATING_DATA]')}`);

        // Función para extraer, guardar y limpiar otros JSONs
        const extractAndSave = (tagOpen, tagClose, filename) => {
            const regex = new RegExp(`\\[${tagOpen}\\]([\\s\\S]*?)\\[\\/${tagClose}\\]`, 'gi');
            let matches = [...mensajeFinal.matchAll(regex)];
            matches.forEach(matchData => {
                if (matchData && matchData[1]) {
                    try {
                        const dataObj = JSON.parse(matchData[1].trim());
                        mensajeFinal = mensajeFinal.replace(matchData[0], '').trim();
                        // Guardar en archivo
                        const filepath = path.join(__dirname, filename);
                        let fileData = [];
                        if (fs.existsSync(filepath)) {
                            try { fileData = JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch(e) {}
                        }
                        fileData.push(dataObj);
                        fs.writeFileSync(filepath, JSON.stringify(fileData, null, 2));
                        console.log(`✅ Guardado ${tagOpen} en ${filename}`);
                    } catch(e) {
                        console.error(`Error parseando ${tagOpen}:`, e);
                    }
                }
            });
        };

        extractAndSave('PEDIDO_DATA', 'PEDIDO_DATA', 'pedidos.json');
        extractAndSave('RATING_DATA', 'RATING_DATA', 'ratings.json');
        extractAndSave('CLIENTE_CALIDAD_DATA', 'CLIENTE_CALIDAD_DATA', 'clientes_calidad.json');

        let remitoMatches = [...mensajeFinal.matchAll(/\[REMITO_JSON\]([\s\S]*?)\[\/REMITO_JSON\]/gi)];
        
        // Respaldo por si la IA usa bloques de código markdown
        if (remitoMatches.length === 0) {
            let altMatch = mensajeFinal.match(/```(?:json)?\s*(\{[\s\S]*?"productos"[\s\S]*?\})\s*```/i);
            if (altMatch) remitoMatches = [altMatch];
        }
        // Respaldo por si la IA solo escupe JSON crudo al final
        if (remitoMatches.length === 0) {
            let altMatch = mensajeFinal.match(/(?:json|JSON)?\s*(\{[\s\S]*?"productos"[\s\S]*?"total"[\s\S]*?\})\s*$/i);
            if (altMatch) remitoMatches = [altMatch];
        }
        
        console.log(`📊 Remitos encontrados: ${remitoMatches.length}`);

        if (remitoMatches.length > 0) {
            // Eliminar todas las etiquetas JSON del mensaje final antes de enviar
            for (const match of remitoMatches) {
                if (match && match[0]) {
                    mensajeFinal = mensajeFinal.replace(match[0], '').trim();
                }
            }
            
            if (mensajeFinal) {
                sesion.historial.push({ role: "assistant", content: mensajeFinal });
                sesion.lastBotResponse = mensajeFinal;
                await client.sendMessage(chatID, mensajeFinal);
                console.log(`🤖 Respondido a ${chatID} y generando ${remitoMatches.length} PDFs...`);
            } else {
                console.log(`🤖 Generando ${remitoMatches.length} PDFs...`);
            }

            for (const match of remitoMatches) {
                if (match && match[1]) {
                    try {
                        const remitoData = JSON.parse(match[1].trim());
                        
                        // GENERAR Y ENVIAR PDF CON PUPPETEER (HTML TEMPLATE)
                        try {
                            const htmlTemplate = fs.readFileSync(path.join(__dirname, 'plantilla.html'), 'utf8');
                            const browser = client.pupBrowser;
                            if (!browser) throw new Error("Puppeteer browser no está disponible.");
                            
                            const page = await browser.newPage();
                            await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });
                            
                            // Inyectar datos en el DOM de la plantilla
                            await page.evaluate((data) => {
                                document.getElementById('cliente').value = data.nombre || '';
                                document.getElementById('direccion').value = data.direccion || '';
                                document.getElementById('localidad').value = 'Paraná';
                                document.getElementById('fecha').value = new Date().toLocaleDateString('es-AR');
                                
                                // Limpiar filas iniciales
                                document.getElementById('rows').innerHTML = '';
                                
                                if (data.productos && data.productos.length > 0) {
                                    data.productos.forEach(p => {
                                        // Limpiar subtotal de símbolos y convertir a número (Ej: "$ 6.000,50" -> 6000.50)
                                        let subStr = String(p.subtotal).replace(/[^0-9,-]+/g, '');
                                        subStr = subStr.replace(',', '.');
                                        let sub = parseFloat(subStr) || 0;
                                        let cant = parseFloat(p.cantidad) || 1;
                                        let unit = sub / cant;
                                        
                                        window.addRow(p.descripcion, cant, unit);
                                    });
                                } else {
                                    window.addRow('Detalle gestionado por WhatsApp', 1, 0);
                                }
                                
                                window.recalc();
                            }, remitoData);
                    
                            // Generar PDF estilo "Print"
                            const pdfBuffer = await page.pdf({ 
                                format: 'A4', 
                                printBackground: true,
                                margin: { top: 0, right: 0, bottom: 0, left: 0 }
                            });
                            
                            await page.close();
                            
                            const base64Pdf = pdfBuffer.toString('base64');
                            const docName = remitoData.nombre ? `Remito_${remitoData.nombre.replace(/[^a-z0-9]/gi, '_')}.pdf` : 'Remito_AguaMarina.pdf';
                            const media = new MessageMedia('application/pdf', base64Pdf, docName);
                            
                            await client.sendMessage(chatID, media, { caption: `📄 Remito para: ${remitoData.nombre || remitoData.direccion || 'Pedido'}` });
                            console.log(`✅ PDF HTML enviado a ${chatID}`);
                        } catch(e) {
                            console.error("Error generando PDF HTML:", e);
                        }

                    } catch(e) {
                        console.error("Error parseando el JSON del remito:", e);
                        // No mandamos el error al cliente por WhatsApp en el bucle
                    }
                }
            }

            // LIMPIAR CARRITO después de emitir los remitos para que el cliente pueda hacer un pedido nuevo
            sesion.carrito = [];
            console.log(`🧹 Carrito limpiado para ${chatID}. Listo para nuevo pedido.`);
        } else {
            // Si no hay remito, comportamiento normal
            sesion.historial.push({ role: "assistant", content: mensajeFinal });
            sesion.lastBotResponse = mensajeFinal;
            await client.sendMessage(chatID, mensajeFinal);
            console.log(`🤖 Respondido a ${chatID}`);
        }

    } catch (error) {
        console.error("Error AI:", error.message);
        await client.sendMessage(chatID, "Disculpa, estoy experimentando problemas técnicos temporales.");
    }
});

client.initialize();

// --- EXPRESS API PARA DASHBOARD ---
const app = express();

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

const getJsonFile = (filename) => {
    const filepath = path.join(__dirname, filename);
    if (fs.existsSync(filepath)) {
        try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch(e) {}
    }
    return [];
};

app.get('/api/pedidos', (req, res) => res.json(getJsonFile('pedidos.json')));
app.get('/api/ratings', (req, res) => res.json(getJsonFile('ratings.json')));
app.get('/api/clientes_calidad', (req, res) => res.json(getJsonFile('clientes_calidad.json')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API interna escuchando en el puerto ${PORT}`);
});
