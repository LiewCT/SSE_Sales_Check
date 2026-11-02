// ==UserScript==
 // @name         SSE Group - Copy South City Variants as Image
 // @namespace    https://ssegroup.com.my/
 // @version      1.0.1
 // @description  Copy selected South City product variant columns as a PNG image
 // @match        https://ssegroup.com.my/dealers/orders/new*
 // @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
 // @grant        none
 // @run-at       document-idle
 // @updateURL    https://raw.githubusercontent.com/LiewCT/SSE_Sales_Check/main/sse-tampermonkey-copy-image.user.js
 // @downloadURL  https://raw.githubusercontent.com/LiewCT/SSE_Sales_Check/main/sse-tampermonkey-copy-image.user.js
 // ==/UserScript==

 (function () {
     'use strict';

     const TABLE_SELECTOR = '.create-order-v2-variants-table';
     const BUTTON_ID = 'tm-copy-south-city-image';

     // Zero-based column indexes in the original table.
     const COLUMNS = [2, 3, 4, 5, 8, 9];

     function addCopyButton() {
         if (document.getElementById(BUTTON_ID)) return;

         if (!document.querySelector(TABLE_SELECTOR)) return;

         const button = document.createElement('button');
         button.id = BUTTON_ID;
         button.type = 'button';
         button.textContent = '📋 Copy South City as Image';

         Object.assign(button.style, {
             position: 'fixed',
             top: '90px',
             right: '20px',
             zIndex: '999999',
             padding: '12px 18px',
             background: '#198754',
             color: '#fff',
             border: '0',
             borderRadius: '6px',
             boxShadow: '0 2px 8px #0003',
             fontSize: '14px',
             fontWeight: 'bold',
             cursor: 'pointer'
         });

         button.addEventListener('click', async () => {
             const originalText = button.textContent;
             button.disabled = true;
             button.textContent = 'Preparing image...';

             try {
                 await copySouthCityTable();

                 button.textContent = '✓ Image copied!';
                 setTimeout(() => {
                     button.textContent = originalText;
                     button.disabled = false;
                 }, 1800);
             } catch (error) {
                 console.error('[SSE Copy Image]', error);
                 alert('Copy failed: ' + error.message);
                 button.textContent = originalText;
                 button.disabled = false;
             }
         });

         document.body.appendChild(button);
     }

     async function copySouthCityTable() {
         const sourceTable = document.querySelector(TABLE_SELECTOR);

         if (!sourceTable) {
             throw new Error('Variants table not found.');
         }

         // Build a separate table; never change the original.
         const output = document.createElement('table');

         Object.assign(output.style, {
             borderCollapse: 'collapse',
             width: 'max-content',
             background: '#fff',
             color: '#212529',
             fontFamily: 'Arial, sans-serif',
             fontSize: '14px'
         });

         // Selected headers.
         const sourceHeaders = sourceTable.querySelectorAll('thead th');
         const thead = document.createElement('thead');
         const headerRow = document.createElement('tr');

         COLUMNS.forEach(index => {
             const sourceHeader = sourceHeaders[index];
             if (!sourceHeader) return;

             const th = document.createElement('th');
             th.textContent = sourceHeader.textContent.trim();
             headerRow.appendChild(th);
         });

         thead.appendChild(headerRow);
         output.appendChild(thead);

         // Selected South City rows only.
         const tbody = document.createElement('tbody');
         let matchedRows = 0;

         sourceTable.querySelectorAll('tbody tr').forEach(row => {
             const branch = row.cells[0]?.textContent
                 .trim()
                 .toLowerCase();
             const quantity = row.cells[5]?.textContent
                 .trim()
                 .toLowerCase();

             if (branch !== 'south city' || quantity.includes('no stock')) return;

             matchedRows++;

             const newRow = document.createElement('tr');

             COLUMNS.forEach(index => {
                 const originalCell = row.cells[index];
                 const td = document.createElement('td');

                 if (!originalCell) {
                     newRow.appendChild(td);
                     return;
                 }

                 const computed = getComputedStyle(originalCell);

                 Object.assign(td.style, {
                     border: '1px solid #adb5bd',
                     padding: '8px 10px',
                     textAlign: 'left',
                     verticalAlign: 'middle',
                     backgroundColor: computed.backgroundColor,
                     color: '#212529',
                     whiteSpace: 'normal'
                 });

                 if (index === 4) {
                     // Product image.
                     const sourceImage = originalCell.querySelector('img');

                     if (sourceImage) {
                         const img = document.createElement('img');
                         img.src = sourceImage.currentSrc || sourceImage.src;
                         img.alt = sourceImage.alt || '';
                         img.width = 60;
                         img.height = 60;

                         Object.assign(img.style, {
                             width: '60px',
                             height: '60px',
                             objectFit: 'cover',
                             display: 'block'
                         });

                         td.appendChild(img);
                     }
                 } else if (index === 2) {
                     // Preserve highlighted code differences.
                     const code = originalCell.cloneNode(true);

                     code.querySelectorAll(
                         'button, input, script, .tm-copy-btn'
                     ).forEach(el => el.remove());

                     td.innerHTML = code.innerHTML;

                     td.querySelectorAll('.tm-code-difference')
                         .forEach(el => {
                             el.style.color = '#dc3545';
                             el.style.fontWeight = 'bold';
                         });
                 } else if (index === 9) {
                     // 10% Off: green font, omit copy button
                     const discount = originalCell.querySelector(
                         '.tm-discount-value'
                     );

                     td.textContent = discount
                     ? discount.textContent.trim()
                     : originalCell.textContent.trim();

                     td.style.color = '#198754';
                     td.style.fontWeight = 'bold';
                 } else {
                     // Description, current quantity and price.
                     td.textContent = originalCell.textContent.trim();
                 }

                 newRow.appendChild(td);
             });

             tbody.appendChild(newRow);
         });

         if (!matchedRows) {
             throw new Error('No South City rows found.');
         }

         output.appendChild(tbody);

         // Style the headers.
         output.querySelectorAll('thead th').forEach(th => {
             Object.assign(th.style, {
                 border: '1px solid #adb5bd',
                 padding: '10px',
                 backgroundColor: '#ffffff',
                 color: '#000000',
                 fontWeight: 'bold',
                 textAlign: 'left',
                 whiteSpace: 'nowrap'
             });
         });

         // Render off-screen.
         const container = document.createElement('div');

         Object.assign(container.style, {
             position: 'fixed',
             left: '-100000px',
             top: '0',
             padding: '16px',
             width: 'max-content',
             backgroundColor: '#ffffff',
             zIndex: '-1'
         });

         container.appendChild(output);
         document.body.appendChild(container);

         try {
             // Wait for generated product images.
             const images = Array.from(output.querySelectorAll('img'));

             await Promise.all(images.map(img => {
                 if (img.complete && img.naturalWidth > 0) {
                     return Promise.resolve();
                 }

                 return new Promise(resolve => {
                     img.onload = resolve;
                     img.onerror = resolve;
                 });
             }));

             const canvas = await html2canvas(container, {
                 backgroundColor: '#ffffff',
                 scale: 2,
                 useCORS: true,
                 logging: false
             });

             const blob = await new Promise((resolve, reject) => {
                 canvas.toBlob(image => {
                     if (image) resolve(image);
                     else reject(new Error('Could not generate PNG.'));
                 }, 'image/png');
             });

             if (!navigator.clipboard?.write || !window.ClipboardItem) {
                 throw new Error(
                     'Image clipboard is unsupported in this browser.'
                 );
             }

             // Also prepare HTML so compatible apps can paste the table as text.
             const html = output.outerHTML;

             const clipboardItem = new ClipboardItem({
                 'image/png': blob,
                 'text/html': new Blob(
                     [html],
                     { type: 'text/html' }
                 ),
                 'text/plain': new Blob(
                     [
                         Array.from(output.querySelectorAll('tbody tr'))
                         .map(row => {
                             const cells = row.querySelectorAll('td');

                             return [
                                 cells[5]?.innerText.trim()  // 10% Off
                             ].join('\t');
                         })
                         .join('\n')
                     ],
                     { type: 'text/plain' }
                 )
             });

             await navigator.clipboard.write([clipboardItem]);

         } finally {
             container.remove();
         }
     }

     // The table may load after the initial page render.
     const observer = new MutationObserver(addCopyButton);

     function start() {
         addCopyButton();

         observer.observe(document.body, {
             childList: true,
             subtree: true
         });
     }

     if (document.body) {
         start();
     } else {
         document.addEventListener('DOMContentLoaded', start, {
             once: true
         });
     }
 })();
