/**
 * Generador de Remito como Imagen — Nano Banana (Gemini Image Gen)
 * Usa el SDK oficial de Google GenAI para generar imágenes con IA.
 * 
 * Modelo: gemini-2.5-flash (con responseModalities: ["IMAGE"])
 * Costo: GRATIS (misma API Key de Gemini)
 * 
 * Fallback: Si falla la generación con IA, usa PDFKit compacto.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

/**
 * Genera una imagen del remito usando Gemini (Nano Banana).
 * @param {Object} remitoData - Datos del remito
 * @param {string} geminiApiKey - API Key de Gemini
 * @returns {Promise<string>} - Ruta al archivo PNG generado
 */
async function generarRemitoImagen(remitoData, geminiApiKey) {
    const nombreArchivo = remitoData.nombre
        ? `Vista_${remitoData.nombre.replace(/[^a-z0-9]/gi, '_')}.png`
        : 'Vista_Remito.png';
    const outputPath = path.join(__dirname, nombreArchivo);

    // Intentar con Nano Banana (Gemini Image Generation)
    if (geminiApiKey) {
        try {
            console.log('🍌 [NANO BANANA] Generando imagen del remito con IA...');
            
            const fecha = new Date().toLocaleDateString('es-AR');
            const productosTexto = (remitoData.productos || []).map(p => {
                const cant = parseFloat(p.cantidad) || 1;
                const sub = parseFloat(String(p.subtotal).replace(/[^0-9.,-]+/g, '').replace(',', '.')) || 0;
                return `${cant}x ${p.descripcion || p.nombre || '-'} — $${sub.toLocaleString('es-AR')}`;
            }).join('\n');

            const prompt = `Generá una imagen de un remito/recibo comercial profesional y elegante con los siguientes datos. 
Estilo: Fondo blanco limpio, encabezado azul oscuro (#1a5276) con el nombre "AGUA MARINA - Distribuidora de Productos de Limpieza". 
Debe verse como un documento oficial impreso, profesional y legible.

DATOS DEL REMITO:
- Fecha: ${fecha}
- Cliente: ${remitoData.nombre || 'Consumidor Final'}
- CUIT/DNI: ${remitoData.cuit || '-'}
- Dirección: ${remitoData.direccion || '-'}
- Localidad: ${remitoData.localidad || 'Paraná'}
- Forma de Pago: ${remitoData.pago || '-'}

PRODUCTOS:
${productosTexto}

TOTAL: $${(parseFloat(remitoData.total) || 0).toLocaleString('es-AR')}

Pie de página: "Generado por Agua Marina Bot"
Hacelo en formato vertical (portrait), tamaño A5 o similar. Los textos deben ser LEGIBLES y correctos.`;

            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`,
                {
                    contents: [{
                        role: "user",
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        responseModalities: ["IMAGE", "TEXT"],
                        responseMimeType: "image/png"
                    }
                },
                { 
                    headers: { "Content-Type": "application/json" }, 
                    timeout: 60000 
                }
            );

            // Buscar la parte que contiene la imagen
            const parts = response.data.candidates[0].content.parts;
            const imagePart = parts.find(p => p.inlineData && p.inlineData.mimeType && p.inlineData.mimeType.startsWith('image'));

            if (imagePart && imagePart.inlineData && imagePart.inlineData.data) {
                const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
                fs.writeFileSync(outputPath, imageBuffer);
                console.log('🍌 [NANO BANANA] Imagen generada exitosamente con IA');
                return outputPath;
            } else {
                console.log('🍌 [NANO BANANA] No se recibió imagen, usando fallback PDFKit');
            }

        } catch (err) {
            console.error('🍌 [NANO BANANA] Error generando imagen con IA:', err.message);
            console.log('🍌 Usando fallback PDFKit...');
        }
    }

    // ============================================================
    // FALLBACK: PDFKit compacto tipo ticket (si Nano Banana falla)
    // ============================================================
    return generarTicketFallback(remitoData);
}

/**
 * Fallback: Genera un PDF compacto tipo ticket si Nano Banana no está disponible.
 */
function generarTicketFallback(remitoData) {
    return new Promise((resolve, reject) => {
        try {
            const nombreArchivo = remitoData.nombre
                ? `Vista_${remitoData.nombre.replace(/[^a-z0-9]/gi, '_')}.pdf`
                : 'Vista_Remito.pdf';
            const outputPath = path.join(__dirname, nombreArchivo);

            const doc = new PDFDocument({
                size: [400, 600],
                margins: { top: 20, bottom: 20, left: 25, right: 25 }
            });

            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            const w = 350;

            // Header
            doc.rect(25, 15, w, 45).fill('#1a5276');
            doc.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff');
            doc.text('AGUA MARINA', 35, 25);
            doc.font('Helvetica').fontSize(8).fillColor('#aed6f1');
            doc.text('Distribuidora de Productos de Limpieza', 35, 48);

            let y = 75;
            doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a5276');
            doc.text('REMITO', 25, y);
            const fecha = new Date().toLocaleDateString('es-AR');
            doc.font('Helvetica').fontSize(8).fillColor('#666');
            doc.text(fecha, 250, y + 2, { width: 125, align: 'right' });

            y += 20;
            doc.moveTo(25, y).lineTo(375, y).strokeColor('#1a5276').lineWidth(1.5).stroke();

            // Datos cliente
            y += 8;
            doc.rect(25, y, w, 50).fill('#f4f6f7');
            y += 5;
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#555');
            doc.text('Cliente:', 30, y);
            doc.font('Helvetica').fillColor('#111');
            doc.text(remitoData.nombre || 'Consumidor Final', 75, y);
            y += 13;
            doc.font('Helvetica-Bold').fillColor('#555');
            doc.text('Dirección:', 30, y);
            doc.font('Helvetica').fillColor('#111');
            doc.text(remitoData.direccion || '-', 85, y);
            y += 13;
            doc.font('Helvetica-Bold').fillColor('#555');
            doc.text('Pago:', 30, y);
            doc.font('Helvetica').fillColor('#111');
            doc.text(remitoData.pago || '-', 65, y);

            // Tabla
            y += 25;
            doc.rect(25, y, w, 18).fill('#1a5276');
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff');
            doc.text('PRODUCTO', 30, y + 5);
            doc.text('CANT.', 240, y + 5);
            doc.text('SUBTOTAL', 300, y + 5, { width: 70, align: 'right' });

            y += 22;
            const productos = remitoData.productos || [];
            productos.forEach((prod, i) => {
                if (i % 2 === 0) doc.rect(25, y - 3, w, 16).fill('#f8f9fa');
                const cant = parseFloat(prod.cantidad) || 1;
                let sub = parseFloat(String(prod.subtotal).replace(/[^0-9.,-]+/g, '').replace(',', '.')) || 0;
                doc.font('Helvetica').fontSize(8).fillColor('#111');
                doc.text(prod.descripcion || prod.nombre || '-', 30, y, { width: 200 });
                doc.text(String(cant), 245, y);
                doc.font('Helvetica-Bold');
                doc.text(`$${sub.toLocaleString('es-AR')}`, 300, y, { width: 70, align: 'right' });
                y += 16;
            });

            y += 5;
            doc.rect(220, y, 155, 24).fill('#1a5276');
            doc.font('Helvetica-Bold').fontSize(11).fillColor('#fff');
            const totalNum = parseFloat(remitoData.total) || 0;
            doc.text(`TOTAL: $${totalNum.toLocaleString('es-AR')}`, 230, y + 7, { width: 135, align: 'right' });

            y += 35;
            doc.font('Helvetica').fontSize(7).fillColor('#999');
            doc.text('Generado por Agua Marina Bot', 25, y, { width: w, align: 'center' });

            doc.end();
            stream.on('finish', () => resolve(outputPath));
            stream.on('error', (err) => reject(err));
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { generarRemitoImagen };
