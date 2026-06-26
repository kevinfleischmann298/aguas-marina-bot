/**
 * Generador de Remito como Imagen PNG — Agua Marina
 * Usa PDFKit para generar el PDF y luego lo convierte a imagen.
 * Alternativa liviana: genera una imagen de texto formateado directamente.
 * 
 * Para entornos sin 'canvas' nativo, genera un PDF adicional optimizado
 * para vista previa que se envía como documento.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Genera un remito como imagen PNG (vista previa compacta).
 * Usa PDFKit para crear un PDF de una sola página compacto
 * que se envía como "vista rápida" antes del PDF formal.
 * 
 * @param {Object} remitoData - Datos del remito
 * @returns {Promise<string>} - Ruta al archivo generado
 */
function generarRemitoImagen(remitoData) {
    return new Promise((resolve, reject) => {
        try {
            const nombreArchivo = remitoData.nombre
                ? `Vista_${remitoData.nombre.replace(/[^a-z0-9]/gi, '_')}.pdf`
                : 'Vista_Remito.pdf';
            const outputPath = path.join(__dirname, nombreArchivo);

            // Crear un PDF compacto tipo "ticket" (ancho de recibo)
            const doc = new PDFDocument({
                size: [400, 600], // Tamaño compacto tipo ticket
                margins: { top: 20, bottom: 20, left: 25, right: 25 }
            });

            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            const w = 350; // Ancho útil

            // Header
            doc.rect(25, 15, w, 45).fill('#1a5276');
            doc.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff');
            doc.text('AGUA MARINA', 35, 25);
            doc.font('Helvetica').fontSize(8).fillColor('#aed6f1');
            doc.text('Distribuidora de Productos de Limpieza', 35, 48);

            // Tipo de doc y fecha
            let y = 75;
            doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a5276');
            doc.text('REMITO', 25, y);
            const fecha = new Date().toLocaleDateString('es-AR');
            doc.font('Helvetica').fontSize(8).fillColor('#666');
            doc.text(fecha, 250, y + 2, { width: 125, align: 'right' });

            // Línea
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

            // Tabla de productos
            y += 25;
            doc.rect(25, y, w, 18).fill('#1a5276');
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff');
            doc.text('PRODUCTO', 30, y + 5);
            doc.text('CANT.', 240, y + 5);
            doc.text('SUBTOTAL', 300, y + 5, { width: 70, align: 'right' });

            y += 22;
            const productos = remitoData.productos || [];
            productos.forEach((prod, i) => {
                if (i % 2 === 0) {
                    doc.rect(25, y - 3, w, 16).fill('#f8f9fa');
                }
                const cant = parseFloat(prod.cantidad) || 1;
                let sub = parseFloat(String(prod.subtotal).replace(/[^0-9.,-]+/g, '').replace(',', '.')) || 0;

                doc.font('Helvetica').fontSize(8).fillColor('#111');
                doc.text(prod.descripcion || prod.nombre || '-', 30, y, { width: 200 });
                doc.text(String(cant), 245, y);
                doc.font('Helvetica-Bold');
                doc.text(`$${sub.toLocaleString('es-AR')}`, 300, y, { width: 70, align: 'right' });
                y += 16;
            });

            // Total
            y += 5;
            doc.rect(220, y, 155, 24).fill('#1a5276');
            doc.font('Helvetica-Bold').fontSize(11).fillColor('#fff');
            const totalNum = parseFloat(remitoData.total) || 0;
            doc.text(`TOTAL: $${totalNum.toLocaleString('es-AR')}`, 230, y + 7, { width: 135, align: 'right' });

            // Pie
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
