require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const PDFDocument = require('pdfkit');
const path = require('path');

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

        // INTERCEPTAR EL REMITO SI EXISTE
        let match = aiResponse.match(/\[REMITO_JSON\]([\s\S]*?)\[\/REMITO_JSON\]/i);
        
        // Respaldo por si la IA usa bloques de código markdown
        if (!match) {
            match = aiResponse.match(/```(?:json)?\s*(\{[\s\S]*?"productos"[\s\S]*?\})\s*```/i);
        }
        // Respaldo por si la IA solo escupe JSON crudo al final
        if (!match) {
            match = aiResponse.match(/(?:json|JSON)?\s*(\{[\s\S]*?"productos"[\s\S]*?"total"[\s\S]*?\})\s*$/i);
        }
        
        let mensajeFinal = aiResponse;
        
        if (match && match[1]) {
            try {
                const remitoData = JSON.parse(match[1].trim());
                // Limpiar la etiqueta o el JSON del mensaje final
                mensajeFinal = aiResponse.replace(match[0], '').trim();
                
                sesion.historial.push({ role: "assistant", content: mensajeFinal });
                sesion.lastBotResponse = mensajeFinal;
                await client.sendMessage(chatID, mensajeFinal);
                
                console.log(`🤖 Respondido a ${chatID} y generando PDF...`);
                
                // DISEÑO DEL REMITO (Estilo Ticket Térmico pero en A5 para WhatsApp)
                const doc = new PDFDocument({ margin: 30, size: 'A5' });
                let buffers = [];
                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', async () => {
                    try {
                        const pdfData = Buffer.concat(buffers);
                        const base64Pdf = pdfData.toString('base64');
                        const media = new MessageMedia('application/pdf', base64Pdf, 'Remito_AguaMarina.pdf');
                        
                        await client.sendMessage(chatID, media, { caption: "📄 Aquí tienes el remito de tu pedido." });
                        console.log(`✅ PDF enviado a ${chatID}`);
                    } catch(e) {
                        console.error("Error enviando PDF:", e);
                    }
                });

                // CABECERA AGUA MARINA
                doc.fontSize(20).font('Helvetica-Bold').text('Agua Marina', { align: 'center' });
                doc.fontSize(10).font('Helvetica').text('La pureza de la limpieza', { align: 'center' });
                doc.moveDown(0.5);
                doc.fontSize(9).text('J.M. Zuviria 1612', { align: 'center' });
                doc.text('Tel.: 0343 434 19 21', { align: 'center' });
                doc.text('Administración 155 033 205', { align: 'center' });
                doc.text('aguamarinasrl@gmail.com', { align: 'center' });
                doc.text('IG/FB: @aguamarinasrl', { align: 'center' });
                doc.moveDown(0.5);
                doc.fontSize(8).text('Productos De Limpieza Para Empresas e Instituciones y El Hogar', { align: 'center' });
                
                doc.moveDown();
                doc.rect(30, doc.y, 360, 0).stroke(); // Línea separadora
                doc.moveDown(0.5);

                // DATOS DEL REMITO Y CLIENTE
                doc.fontSize(14).font('Helvetica-Bold').text('REMITO  [ R ]', { align: 'right' });
                doc.fontSize(10).font('Helvetica').text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`, { align: 'right' });
                
                doc.moveUp(2);
                doc.fontSize(10).font('Helvetica-Bold').text('DATOS DEL CLIENTE:');
                doc.font('Helvetica').text(`Sr.(s): ${remitoData.nombre || '-'}`);
                doc.text(`Dirección: ${remitoData.direccion || '-'}`);
                doc.text(`Localidad: PARANA`);
                doc.text(`Email: ${remitoData.email || '-'}`);
                doc.text(`Horario Entrega: ${remitoData.horario || '-'}`);
                
                doc.moveDown(0.5);
                doc.rect(30, doc.y, 360, 0).stroke(); // Línea separadora
                doc.moveDown();

                // TABLA DE PRODUCTOS
                doc.fontSize(9).font('Helvetica-Bold');
                doc.text('Cant', 30, doc.y, { continued: true, width: 30 });
                doc.text('Artículo', 70, doc.y, { continued: true, width: 170 });
                doc.text('Total', 250, doc.y, { align: 'right', width: 140 });
                doc.moveDown(0.5);
                
                doc.font('Helvetica');
                if (remitoData.productos && remitoData.productos.length > 0) {
                    remitoData.productos.forEach(p => {
                        const startY = doc.y;
                        doc.text(p.cantidad.toString(), 30, startY, { width: 30 });
                        doc.text(p.descripcion, 70, startY, { width: 170 });
                        doc.text(p.subtotal.toString(), 250, startY, { align: 'right', width: 140 });
                    });
                } else {
                    doc.text('Detalle gestionado por WhatsApp', 30, doc.y);
                }
                
                doc.moveDown();
                doc.rect(30, doc.y, 360, 0).stroke(); // Línea separadora
                doc.moveDown();
                
                // TOTAL
                doc.fontSize(14).font('Helvetica-Bold').text(`TOTAL: ${remitoData.total || '$0'}`, { align: 'right' });
                doc.moveDown(2);
                doc.fontSize(9).font('Helvetica-Oblique').text('Usted fue atendido por Agua Marina. ¡Gracias por su compra!', { align: 'center' });
                
                doc.end();

            } catch(e) {
                console.error("Error parseando el JSON del remito:", e);
                // Si falla el parseo, mandamos el mensaje original sin PDF
                sesion.historial.push({ role: "assistant", content: mensajeFinal });
                sesion.lastBotResponse = mensajeFinal;
                await client.sendMessage(chatID, mensajeFinal);
            }
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
