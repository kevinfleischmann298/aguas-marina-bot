/**
 * Generador de Remitos PDF - Agua Marina
 * Usa PDFKit nativo (sin Puppeteer/Chrome). Consumo de RAM: ~5MB vs ~300MB.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Genera un remito PDF profesional y lo guarda en disco.
 * @param {Object} remitoData - Datos del remito
 * @param {string} remitoData.nombre - Nombre del cliente
 * @param {string} remitoData.cuit - CUIT o DNI
 * @param {string} remitoData.direccion - Dirección de entrega
 * @param {string} remitoData.localidad - Localidad
 * @param {string} remitoData.pago - Forma de pago
 * @param {Array} remitoData.productos - Lista de productos [{descripcion, cantidad, subtotal}]
 * @param {number} remitoData.total - Total del pedido
 * @returns {Promise<string>} - Ruta absoluta del archivo PDF generado
 */
function generarRemitoPDF(remitoData) {
    return new Promise((resolve, reject) => {
        try {
            const nombreArchivo = remitoData.nombre 
                ? `Remito_${remitoData.nombre.replace(/[^a-z0-9]/gi, '_')}.pdf` 
                : 'Remito_AguaMarina.pdf';
            const outputPath = path.join(__dirname, nombreArchivo);

            const doc = new PDFDocument({ 
                size: 'A4', 
                margins: { top: 40, bottom: 40, left: 50, right: 50 } 
            });

            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            const pageWidth = doc.page.width - 100; // 50 left + 50 right margins

            // ========================
            // HEADER - AGUA MARINA
            // ========================
            
            // Fondo del header
            doc.save();
            doc.rect(50, 30, pageWidth, 85).fill('#1a5276');
            doc.restore();

            // Nombre de la empresa
            doc.font('Helvetica-Bold').fontSize(28).fillColor('#ffffff');
            doc.text('AGUA MARINA', 70, 45, { width: pageWidth - 40 });

            // Subtítulo
            doc.font('Helvetica').fontSize(10).fillColor('#aed6f1');
            doc.text('Distribuidora de Productos de Limpieza', 70, 78);

            // Info de contacto en el header (derecha)
            doc.font('Helvetica').fontSize(8).fillColor('#d5e8f0');
            doc.text('Paraná, Entre Ríos', 350, 50, { width: 200, align: 'right' });
            doc.text('Lunes a Sábados 8:00 a 13:00 hs', 350, 62, { width: 200, align: 'right' });
            doc.text('WhatsApp: Agua Marina Bot', 350, 74, { width: 200, align: 'right' });

            // Tipo de documento
            doc.font('Helvetica-Bold').fontSize(16).fillColor('#1a5276');
            doc.text('REMITO', 70, 130);

            // Línea decorativa
            doc.moveTo(50, 152).lineTo(50 + pageWidth, 152).strokeColor('#1a5276').lineWidth(2).stroke();

            // Fecha y número
            const fecha = new Date().toLocaleDateString('es-AR', { 
                year: 'numeric', month: 'long', day: 'numeric' 
            });
            doc.font('Helvetica').fontSize(9).fillColor('#555555');
            doc.text(`Fecha: ${fecha}`, 350, 132, { width: 200, align: 'right' });

            // ========================
            // DATOS DEL CLIENTE
            // ========================
            let yPos = 170;

            // Fondo gris suave para la sección de cliente
            doc.save();
            doc.rect(50, yPos - 5, pageWidth, 80).fill('#f4f6f7');
            doc.restore();

            doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a5276');
            doc.text('DATOS DEL CLIENTE', 65, yPos);
            yPos += 18;

            const labelStyle = () => doc.font('Helvetica-Bold').fontSize(9).fillColor('#555555');
            const valueStyle = () => doc.font('Helvetica').fontSize(9).fillColor('#111111');

            // Fila 1: Nombre y CUIT
            labelStyle(); doc.text('Cliente:', 65, yPos);
            valueStyle(); doc.text(remitoData.nombre || 'Consumidor Final', 130, yPos);
            labelStyle(); doc.text('CUIT/DNI:', 350, yPos);
            valueStyle(); doc.text(remitoData.cuit || '-', 410, yPos);
            yPos += 16;

            // Fila 2: Dirección y Localidad
            labelStyle(); doc.text('Dirección:', 65, yPos);
            valueStyle(); doc.text(remitoData.direccion || '-', 130, yPos);
            labelStyle(); doc.text('Localidad:', 350, yPos);
            valueStyle(); doc.text(remitoData.localidad || 'Paraná', 410, yPos);
            yPos += 16;

            // Fila 3: Forma de pago
            labelStyle(); doc.text('Pago:', 65, yPos);
            valueStyle(); doc.text(remitoData.pago || '-', 130, yPos);
            yPos += 25;

            // ========================
            // TABLA DE PRODUCTOS
            // ========================
            
            // Header de tabla
            const tableTop = yPos + 5;
            const colX = { desc: 55, cant: 340, precio: 400, subtotal: 470 };

            doc.save();
            doc.rect(50, tableTop - 2, pageWidth, 22).fill('#1a5276');
            doc.restore();

            doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
            doc.text('DESCRIPCIÓN', colX.desc, tableTop + 4);
            doc.text('CANT.', colX.cant, tableTop + 4);
            doc.text('P. UNIT.', colX.precio, tableTop + 4);
            doc.text('SUBTOTAL', colX.subtotal, tableTop + 4);

            yPos = tableTop + 25;

            // Filas de productos
            const productos = remitoData.productos || [];
            productos.forEach((prod, i) => {
                const cantidad = parseFloat(prod.cantidad) || 1;
                let subtotal = 0;
                
                // Parsear subtotal (puede venir como string con $ y puntos)
                if (prod.subtotal !== undefined) {
                    let subStr = String(prod.subtotal).replace(/[^0-9.,-]+/g, '').replace(',', '.');
                    subtotal = parseFloat(subStr) || 0;
                }
                
                const precioUnit = cantidad > 0 ? (subtotal / cantidad) : 0;

                // Fondo alternado
                if (i % 2 === 0) {
                    doc.save();
                    doc.rect(50, yPos - 3, pageWidth, 20).fill('#f8f9fa');
                    doc.restore();
                }

                doc.font('Helvetica').fontSize(9).fillColor('#111111');
                doc.text(prod.descripcion || prod.nombre || '-', colX.desc, yPos, { width: 275 });
                doc.text(String(cantidad), colX.cant, yPos);
                doc.text(`$${precioUnit.toLocaleString('es-AR', { minimumFractionDigits: 0 })}`, colX.precio, yPos);
                doc.font('Helvetica-Bold').fillColor('#111111');
                doc.text(`$${subtotal.toLocaleString('es-AR', { minimumFractionDigits: 0 })}`, colX.subtotal, yPos);

                yPos += 20;
            });

            // Línea separadora
            doc.moveTo(50, yPos + 2).lineTo(50 + pageWidth, yPos + 2).strokeColor('#1a5276').lineWidth(1).stroke();
            yPos += 12;

            // ========================
            // TOTAL
            // ========================
            doc.save();
            doc.rect(350, yPos - 2, pageWidth - 300, 28).fill('#1a5276');
            doc.restore();

            doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff');
            const totalNum = parseFloat(remitoData.total) || 0;
            doc.text(`TOTAL: $${totalNum.toLocaleString('es-AR', { minimumFractionDigits: 0 })}`, 360, yPos + 5, { width: pageWidth - 320, align: 'right' });

            // ========================
            // PIE DE PÁGINA
            // ========================
            yPos += 50;

            doc.font('Helvetica').fontSize(8).fillColor('#888888');
            doc.text('Este remito fue generado automáticamente por el sistema de Agua Marina.', 50, yPos, { width: pageWidth, align: 'center' });
            doc.text('Conserve este comprobante como constancia de su pedido.', 50, yPos + 12, { width: pageWidth, align: 'center' });

            // Línea final decorativa
            yPos += 30;
            doc.moveTo(50, yPos).lineTo(50 + pageWidth, yPos).strokeColor('#1a5276').lineWidth(0.5).stroke();

            doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a5276');
            doc.text('AGUA MARINA - Distribuidora de Productos de Limpieza', 50, yPos + 5, { width: pageWidth, align: 'center' });

            // Finalizar
            doc.end();

            stream.on('finish', () => resolve(outputPath));
            stream.on('error', (err) => reject(err));

        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { generarRemitoPDF };
